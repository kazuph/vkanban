use std::path::PathBuf;

use axum::{
    BoxError, Extension, Json, Router,
    extract::{Query, State},
    http::StatusCode,
    middleware::from_fn_with_state,
    response::{Json as ResponseJson, Sse, sse::KeepAlive},
    routing::{get, post},
};
use db::models::{
    image::TaskImage,
    merge::MergeStatus,
    project::Project,
    task::{CreateTask, Task, TaskWithAttemptStatus, UpdateTask},
    task_attempt::{CreateTaskAttempt, TaskAttempt},
};
use deployment::Deployment;
use futures_util::TryStreamExt;
use serde::{Deserialize, Serialize};
use services::services::container::{
    ContainerService, WorktreeCleanupData, cleanup_worktrees_direct,
};
use sqlx::Error as SqlxError;
use ts_rs::TS;
use utils::response::ApiResponse;
use uuid::Uuid;

use crate::{DeploymentImpl, error::ApiError, middleware::load_task_middleware};

#[derive(Debug, Deserialize)]
pub struct TaskQuery {
    pub project_id: Uuid,
}

pub async fn get_tasks(
    State(deployment): State<DeploymentImpl>,
    Query(query): Query<TaskQuery>,
) -> Result<ResponseJson<ApiResponse<Vec<TaskWithAttemptStatus>>>, ApiError> {
    let tasks =
        Task::find_by_project_id_with_attempt_status(&deployment.db().pool, query.project_id)
            .await?;

    Ok(ResponseJson(ApiResponse::success(tasks)))
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct TaskPrStatus {
    pub task_id: Uuid,
    pub has_open_pr: bool,
    pub open_pr_url: Option<String>,
    pub latest_pr_status: Option<MergeStatus>,
    pub latest_pr_url: Option<String>,
    /// Latest attempt branch name for this task (if any)
    pub branch: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct TaskPrStatusQuery {
    pub project_id: Uuid,
}

/// Return PR-open status per task in the project without loading heavy attempt details.
pub async fn get_tasks_pr_status(
    State(deployment): State<DeploymentImpl>,
    Query(query): Query<TaskPrStatusQuery>,
) -> Result<ResponseJson<ApiResponse<Vec<TaskPrStatus>>>, ApiError> {
    use sqlx::Row;
    let rows = sqlx::query(
        r#"SELECT
            t.id AS task_id,
            CASE WHEN EXISTS (
                SELECT 1
                  FROM task_attempts ta
                  JOIN merges m ON m.task_attempt_id = ta.id
                 WHERE ta.task_id = t.id
                   AND m.merge_type = 'pr'
                   AND m.pr_status = 'open'
                 LIMIT 1
            ) THEN 1 ELSE 0 END AS has_open_pr,
            (SELECT m.pr_url
               FROM task_attempts ta
               JOIN merges m ON m.task_attempt_id = ta.id
              WHERE ta.task_id = t.id
                AND m.merge_type = 'pr'
                AND m.pr_status = 'open'
              ORDER BY m.created_at DESC
              LIMIT 1
            ) as open_pr_url,
            -- Latest PR regardless of status
            (SELECT m.pr_status
               FROM task_attempts ta
               JOIN merges m ON m.task_attempt_id = ta.id
              WHERE ta.task_id = t.id
                AND m.merge_type = 'pr'
              ORDER BY m.created_at DESC
              LIMIT 1
            ) as latest_pr_status,
            (SELECT m.pr_url
               FROM task_attempts ta
               JOIN merges m ON m.task_attempt_id = ta.id
              WHERE ta.task_id = t.id
                AND m.merge_type = 'pr'
              ORDER BY m.created_at DESC
              LIMIT 1
            ) as latest_pr_url,
            -- Latest attempt branch name (if any)
            (
              SELECT ta.branch
                FROM task_attempts ta
               WHERE ta.task_id = t.id
               ORDER BY ta.created_at DESC
               LIMIT 1
            ) as latest_branch_name
          FROM tasks t
         WHERE t.project_id = ?"#,
    )
    .bind(query.project_id)
    .fetch_all(&deployment.db().pool)
    .await?;

    let mut data = Vec::with_capacity(rows.len());
    for row in rows.into_iter() {
        let task_id: Uuid = row.try_get("task_id").unwrap_or_else(|_| Uuid::nil());
        let has_open_pr_i64: i64 = row.try_get("has_open_pr").unwrap_or(0);
        let open_pr_url: Option<String> = row.try_get("open_pr_url").ok();
        let latest_pr_status_str: Option<String> = row.try_get("latest_pr_status").ok();
        let latest_pr_url: Option<String> = row.try_get("latest_pr_url").ok();
        let latest_branch_name: Option<String> = row.try_get("latest_branch_name").ok();

        // Convert string to MergeStatus (snake_case in DB)
        let latest_pr_status = latest_pr_status_str.as_deref().map(|s| match s {
            "open" => MergeStatus::Open,
            "merged" => MergeStatus::Merged,
            "closed" => MergeStatus::Closed,
            _ => MergeStatus::Unknown,
        });

        data.push(TaskPrStatus {
            task_id,
            has_open_pr: has_open_pr_i64 != 0,
            open_pr_url,
            latest_pr_status,
            latest_pr_url,
            branch: latest_branch_name,
        });
    }

    Ok(ResponseJson(ApiResponse::success(data)))
}

pub async fn stream_tasks(
    State(deployment): State<DeploymentImpl>,
    Query(query): Query<TaskQuery>,
) -> Result<
    Sse<impl futures_util::Stream<Item = Result<axum::response::sse::Event, BoxError>>>,
    axum::http::StatusCode,
> {
    let stream = deployment
        .events()
        .stream_tasks_for_project(query.project_id)
        .await
        .map_err(|_| axum::http::StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Sse::new(stream.map_err(|e| -> BoxError { e.into() })).keep_alive(KeepAlive::default()))
}

pub async fn get_task(
    Extension(task): Extension<Task>,
    State(_deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<Task>>, ApiError> {
    Ok(ResponseJson(ApiResponse::success(task)))
}

pub async fn create_task(
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<CreateTask>,
) -> Result<ResponseJson<ApiResponse<Task>>, ApiError> {
    let id = Uuid::new_v4();

    tracing::debug!(
        "Creating task '{}' in project {}",
        payload.title,
        payload.project_id
    );

    let task = Task::create(&deployment.db().pool, &payload, id).await?;

    if let Some(image_ids) = &payload.image_ids {
        TaskImage::associate_many(&deployment.db().pool, task.id, image_ids).await?;
    }

    deployment
        .track_if_analytics_allowed(
            "task_created",
            serde_json::json!({
            "task_id": task.id.to_string(),
            "project_id": payload.project_id,
            "has_description": task.description.is_some(),
            "has_images": payload.image_ids.is_some(),
            }),
        )
        .await;

    Ok(ResponseJson(ApiResponse::success(task)))
}

pub async fn create_task_and_start(
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<CreateTask>,
) -> Result<ResponseJson<ApiResponse<TaskWithAttemptStatus>>, ApiError> {
    let task_id = Uuid::new_v4();
    let task = Task::create(&deployment.db().pool, &payload, task_id).await?;

    if let Some(image_ids) = &payload.image_ids {
        TaskImage::associate_many(&deployment.db().pool, task.id, image_ids).await?;
    }

    deployment
        .track_if_analytics_allowed(
            "task_created",
            serde_json::json!({
                "task_id": task.id.to_string(),
                "project_id": task.project_id,
                "has_description": task.description.is_some(),
                "has_images": payload.image_ids.is_some(),
            }),
        )
        .await;

    // use the default executor profile and the current branch for the task attempt
    let executor_profile_id = deployment.config().read().await.executor_profile.clone();
    let project = Project::find_by_id(&deployment.db().pool, payload.project_id)
        .await?
        .ok_or(ApiError::Database(SqlxError::RowNotFound))?;
    let branch = deployment
        .git()
        .get_current_branch(&project.git_repo_path)?;

    let task_attempt = TaskAttempt::create(
        &deployment.db().pool,
        &CreateTaskAttempt {
            executor: executor_profile_id.executor,
            base_branch: branch,
        },
        task.id,
    )
    .await?;
    let execution_process = deployment
        .container()
        .start_attempt(&task_attempt, executor_profile_id.clone(), None, None, None)
        .await?;
    deployment
        .track_if_analytics_allowed(
            "task_attempt_started",
            serde_json::json!({
                "task_id": task.id.to_string(),
                "executor": &executor_profile_id.executor,
                "variant": &executor_profile_id.variant,
                "attempt_id": task_attempt.id.to_string(),
            }),
        )
        .await;

    let task = Task::find_by_id(&deployment.db().pool, task.id)
        .await?
        .ok_or(ApiError::Database(SqlxError::RowNotFound))?;

    tracing::info!("Started execution process {}", execution_process.id);
    Ok(ResponseJson(ApiResponse::success(TaskWithAttemptStatus {
        id: task.id,
        title: task.title,
        description: task.description,
        project_id: task.project_id,
        status: task.status,
        parent_task_attempt: task.parent_task_attempt,
        created_at: task.created_at,
        updated_at: task.updated_at,
        has_in_progress_attempt: true,
        has_merged_attempt: false,
        has_open_pr: false,
        open_pr_url: None,
        last_attempt_failed: false,
        executor: task_attempt.executor,
    })))
}

pub async fn update_task(
    Extension(existing_task): Extension<Task>,
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<UpdateTask>,
) -> Result<ResponseJson<ApiResponse<Task>>, ApiError> {
    // Use existing values if not provided in update
    let title = payload.title.unwrap_or(existing_task.title);
    let description = payload.description.or(existing_task.description);
    let status = payload.status.unwrap_or(existing_task.status);
    let parent_task_attempt = payload
        .parent_task_attempt
        .or(existing_task.parent_task_attempt);

    let task = Task::update(
        &deployment.db().pool,
        existing_task.id,
        existing_task.project_id,
        title,
        description,
        status,
        parent_task_attempt,
    )
    .await?;

    if let Some(image_ids) = &payload.image_ids {
        TaskImage::delete_by_task_id(&deployment.db().pool, task.id).await?;
        TaskImage::associate_many(&deployment.db().pool, task.id, image_ids).await?;
    }

    Ok(ResponseJson(ApiResponse::success(task)))
}

pub async fn delete_task(
    Extension(task): Extension<Task>,
    State(deployment): State<DeploymentImpl>,
) -> Result<(StatusCode, ResponseJson<ApiResponse<()>>), ApiError> {
    // Validate no running execution processes
    if deployment
        .container()
        .has_running_processes(task.id)
        .await?
    {
        return Err(ApiError::Conflict("Task has running execution processes. Please wait for them to complete or stop them first.".to_string()));
    }

    // Gather task attempts data needed for background cleanup
    let attempts = TaskAttempt::fetch_all(&deployment.db().pool, Some(task.id))
        .await
        .map_err(|e| {
            tracing::error!("Failed to fetch task attempts for task {}: {}", task.id, e);
            ApiError::TaskAttempt(e)
        })?;

    // Gather cleanup data before deletion
    let project = task
        .parent_project(&deployment.db().pool)
        .await?
        .ok_or_else(|| ApiError::Database(SqlxError::RowNotFound))?;

    let cleanup_data: Vec<WorktreeCleanupData> = attempts
        .iter()
        .filter_map(|attempt| {
            attempt
                .container_ref
                .as_ref()
                .map(|worktree_path| WorktreeCleanupData {
                    attempt_id: attempt.id,
                    worktree_path: PathBuf::from(worktree_path),
                    git_repo_path: Some(project.git_repo_path.clone()),
                })
        })
        .collect();

    // Delete task from database (FK CASCADE will handle task_attempts)
    let rows_affected = Task::delete(&deployment.db().pool, task.id).await?;

    if rows_affected == 0 {
        return Err(ApiError::Database(SqlxError::RowNotFound));
    }

    // Spawn background worktree cleanup task
    let task_id = task.id;
    tokio::spawn(async move {
        let span = tracing::info_span!("background_worktree_cleanup", task_id = %task_id);
        let _enter = span.enter();

        tracing::info!(
            "Starting background cleanup for task {} ({} worktrees)",
            task_id,
            cleanup_data.len()
        );

        if let Err(e) = cleanup_worktrees_direct(&cleanup_data).await {
            tracing::error!(
                "Background worktree cleanup failed for task {}: {}",
                task_id,
                e
            );
        } else {
            tracing::info!("Background cleanup completed for task {}", task_id);
        }
    });

    // Return 202 Accepted to indicate deletion was scheduled
    Ok((StatusCode::ACCEPTED, ResponseJson(ApiResponse::success(()))))
}

pub fn router(deployment: &DeploymentImpl) -> Router<DeploymentImpl> {
    let task_id_router = Router::new()
        .route("/", get(get_task).put(update_task).delete(delete_task))
        .layer(from_fn_with_state(deployment.clone(), load_task_middleware));

    let inner = Router::new()
        .route("/", get(get_tasks).post(create_task))
        .route("/pr-status", get(get_tasks_pr_status))
        .route("/stream", get(stream_tasks))
        .route("/create-and-start", post(create_task_and_start))
        .nest("/{task_id}", task_id_router);

    // mount under /projects/:project_id/tasks
    Router::new().nest("/tasks", inner)
}
