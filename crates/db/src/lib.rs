use std::{pin::Pin, str::FromStr, sync::Arc};

use sqlx::{
    Error, Pool, Sqlite,
    sqlite::{SqliteConnectOptions, SqliteConnection, SqlitePoolOptions},
};
use utils::assets::asset_dir;

pub mod models;

// Type alias to reduce clippy::type_complexity noise for the after_connect hook
type AfterConnectHook = Arc<
    dyn for<'a> Fn(
            &'a mut SqliteConnection,
        )
            -> Pin<Box<dyn std::future::Future<Output = Result<(), Error>> + Send + 'a>>
        + Send
        + Sync
        + 'static,
>;

#[derive(Clone)]
pub struct DBService {
    pub pool: Pool<Sqlite>,
}

impl DBService {
    pub async fn new() -> Result<DBService, Error> {
        // Always go through create_pool to ensure after-connect PRAGMAs
        let pool = Self::create_pool(None).await?;
        // Best-effort: trim any leftover WAL from previous runs
        let _ = sqlx::query("PRAGMA wal_checkpoint(TRUNCATE);")
            .execute(&pool)
            .await;
        Ok(DBService { pool })
    }

    pub async fn new_with_after_connect<F>(after_connect: F) -> Result<DBService, Error>
    where
        F: for<'a> Fn(
                &'a mut SqliteConnection,
            )
                -> Pin<Box<dyn std::future::Future<Output = Result<(), Error>> + Send + 'a>>
            + Send
            + Sync
            + 'static,
    {
        let pool = Self::create_pool(Some(Arc::new(after_connect))).await?;
        Ok(DBService { pool })
    }

    async fn create_pool(after_connect: Option<AfterConnectHook>) -> Result<Pool<Sqlite>, Error> {
        let database_url = format!(
            "sqlite://{}",
            asset_dir().join("db.sqlite").to_string_lossy()
        );
        let options = SqliteConnectOptions::from_str(&database_url)?
            .create_if_missing(true)
            .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal)
            .busy_timeout(std::time::Duration::from_secs(5))
            .foreign_keys(true);

        // Always install an after_connect hook to apply connection-level PRAGMAs
        let pool = SqlitePoolOptions::new()
            .after_connect(move |conn, _meta| {
                // Clone optional external hook for composition
                let external_hook = after_connect.clone();
                Box::pin(async move {
                    // Safety PRAGMAs applied on every new connection
                    // - Keep FK enforcement on
                    // - Ensure WAL autocheckpoint is reasonable
                    // - Cap journal file size post-checkpoint
                    // NOTE: These are best-effort; failures are logged but non-fatal
                    if let Err(e) = sqlx::query("PRAGMA foreign_keys=ON;")
                        .execute(&mut *conn)
                        .await
                    {
                        tracing::warn!(target: "db", "failed to set foreign_keys=ON: {}", e);
                    }
                    if let Err(e) = sqlx::query("PRAGMA wal_autocheckpoint=1000;")
                        .execute(&mut *conn)
                        .await
                    {
                        tracing::warn!(target: "db", "failed to set wal_autocheckpoint: {}", e);
                    }
                    // 64MB cap for WAL/journal persistent size after checkpoint
                    if let Err(e) = sqlx::query("PRAGMA journal_size_limit=67108864;")
                        .execute(&mut *conn)
                        .await
                    {
                        tracing::warn!(target: "db", "failed to set journal_size_limit: {}", e);
                    }
                    // Compose with external hook if provided (e.g., update hooks for SSE)
                    if let Some(hook) = external_hook {
                        hook(conn).await?;
                    }
                    Ok(())
                })
            })
            .connect_with(options)
            .await?;

        sqlx::migrate!("./migrations").run(&pool).await?;
        Ok(pool)
    }
}

/// Background maintenance utilities for SQLite WAL.
pub mod maintenance {
    use std::time::Duration;

    use sqlx::SqlitePool;
    use utils::assets::asset_dir;

    /// Default thresholds (can be tuned later or made configurable)
    const CHECK_INTERVAL_SECS: u64 = 60; // every 60s
    const WAL_MAX_BYTES: u64 = 128 * 1024 * 1024; // 128MB
    const VACUUM_FREELIST_MAX_BYTES: u64 = 64 * 1024 * 1024; // 64MB

    pub fn spawn(pool: SqlitePool) -> tokio::task::JoinHandle<()> {
        tokio::spawn(async move {
            let db_path = asset_dir().join("db.sqlite");
            let wal_path = db_path.with_extension("sqlite-wal");
            loop {
                tokio::time::sleep(Duration::from_secs(CHECK_INTERVAL_SECS)).await;

                // Measure WAL size
                let wal_bytes = std::fs::metadata(&wal_path).map(|m| m.len()).unwrap_or(0);

                if wal_bytes > 0 {
                    tracing::debug!(target: "db", wal_bytes, "WAL present");
                }

                // If WAL is beyond threshold, attempt a passive checkpoint first
                if wal_bytes > WAL_MAX_BYTES {
                    if let Err(e) = sqlx::query("PRAGMA wal_checkpoint(PASSIVE);")
                        .execute(&pool)
                        .await
                    {
                        tracing::warn!(target: "db", "wal_checkpoint(PASSIVE) failed: {}", e);
                    }

                    // Re-check size and try a stronger mode if still large
                    let still_large =
                        std::fs::metadata(&wal_path).map(|m| m.len()).unwrap_or(0) > WAL_MAX_BYTES;
                    if still_large
                        && let Err(e) = sqlx::query("PRAGMA wal_checkpoint(RESTART);")
                            .execute(&pool)
                            .await
                    {
                        tracing::warn!(target: "db", "wal_checkpoint(RESTART) failed: {}", e);
                    }
                } else if wal_bytes > 0 {
                    // Keep WAL small opportunistically
                    let _ = sqlx::query("PRAGMA wal_checkpoint(PASSIVE);")
                        .execute(&pool)
                        .await;
                }

                // Freelist compaction (rare): if many free pages accumulated, vacuum
                if let (Ok(page_size), Ok(freelist_pages)) = (
                    sqlx::query_scalar::<_, i64>("PRAGMA page_size;")
                        .fetch_one(&pool)
                        .await,
                    sqlx::query_scalar::<_, i64>("PRAGMA freelist_count;")
                        .fetch_one(&pool)
                        .await,
                ) {
                    let freelist_bytes =
                        (page_size.max(0) as u64).saturating_mul(freelist_pages.max(0) as u64);
                    if freelist_bytes > VACUUM_FREELIST_MAX_BYTES && wal_bytes < 1024 * 1024 {
                        // Only vacuum when WAL is small to avoid long stalls
                        tracing::info!(target: "db", freelist_bytes, "Running VACUUM due to large freelist");
                        let _ = sqlx::query("VACUUM;").execute(&pool).await;
                        // After VACUUM, opportunistically truncate WAL
                        let _ = sqlx::query("PRAGMA wal_checkpoint(TRUNCATE);")
                            .execute(&pool)
                            .await;
                    }
                }
            }
        })
    }
}
