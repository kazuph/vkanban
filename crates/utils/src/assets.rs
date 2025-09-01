use directories::ProjectDirs;
use rust_embed::RustEmbed;
use std::env;
use crate::path::expand_tilde;

const PROJECT_ROOT: &str = env!("CARGO_MANIFEST_DIR");

pub fn asset_dir() -> std::path::PathBuf {
    // 1) Hard override by absolute directory
    if let Ok(dir) = env::var("VIBE_KANBAN_ASSET_DIR") {
        let expanded = expand_tilde(&dir);
        if !expanded.exists() {
            std::fs::create_dir_all(&expanded)
                .expect("Failed to create asset directory from VIBE_KANBAN_ASSET_DIR");
        }
        return expanded;
    }

    // 2) Mode override (force system/production location even in debug)
    let force_prod = env::var("VIBE_KANBAN_ASSET_MODE")
        .map(|v| v.eq_ignore_ascii_case("prod") || v.eq_ignore_ascii_case("system"))
        .unwrap_or(false);

    let path = if force_prod || !cfg!(debug_assertions) {
        ProjectDirs::from("ai", "bloop", "vibe-kanban")
            .expect("OS didn't give us a home directory")
            .data_dir()
            .to_path_buf()
    } else {
        // Default dev location (checked into repo for easy resets)
        std::path::PathBuf::from(PROJECT_ROOT).join("../../dev_assets")
    };

    // Ensure the directory exists
    if !path.exists() {
        std::fs::create_dir_all(&path).expect("Failed to create asset directory");
    }

    path
    // ✔ macOS → ~/Library/Application Support/vibe-kanban
    // ✔ Linux → ~/.local/share/vibe-kanban   (respects XDG_DATA_HOME)
    // ✔ Windows → %APPDATA%\bloop\vibe-kanban
}

pub fn config_path() -> std::path::PathBuf {
    asset_dir().join("config.json")
}

pub fn profiles_path() -> std::path::PathBuf {
    asset_dir().join("profiles.json")
}

#[derive(RustEmbed)]
#[folder = "../../assets/sounds"]
pub struct SoundAssets;

#[derive(RustEmbed)]
#[folder = "../../assets/scripts"]
pub struct ScriptAssets;
