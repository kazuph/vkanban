use std::path::Path;

use async_trait::async_trait;
use command_group::AsyncGroupChild;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::{
    actions::Executable,
    executors::{ExecutorError, StandardCodingAgentExecutor},
    profile::{ExecutorConfigs, ExecutorProfileId},
};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
pub struct CodingAgentInitialRequest {
    pub prompt: String,
    /// Executor profile specification
    #[serde(alias = "profile_variant_label")]
    // Backwards compatability with ProfileVariantIds, esp stored in DB under ExecutorAction
    pub executor_profile_id: ExecutorProfileId,
    /// Optional override for Codex model (maps to --model) during initial run
    #[serde(skip_serializing_if = "Option::is_none")]
    pub codex_model_override: Option<String>,
    /// Optional override for Claude model ("sonnet" | "opus") during initial run
    #[serde(skip_serializing_if = "Option::is_none")]
    pub claude_model_override: Option<String>,
}

#[async_trait]
impl Executable for CodingAgentInitialRequest {
    async fn spawn(&self, current_dir: &Path) -> Result<AsyncGroupChild, ExecutorError> {
        let executor_profile_id = self.executor_profile_id.clone();
        let agent = ExecutorConfigs::get_cached()
            .get_coding_agent(&executor_profile_id)
            .ok_or(ExecutorError::UnknownExecutorType(
                executor_profile_id.to_string(),
            ))?;
        match agent {
            crate::executors::CodingAgent::Codex(mut cfg) => {
                if let Some(model) = self.codex_model_override.clone() {
                    cfg.model = Some(model);
                }
                cfg.spawn(current_dir, &self.prompt).await
            }
            crate::executors::CodingAgent::ClaudeCode(mut cfg) => {
                if let Some(model) = self.claude_model_override.clone() {
                    cfg.model = Some(model);
                }
                cfg.spawn(current_dir, &self.prompt).await
            }
            other => other.spawn(current_dir, &self.prompt).await,
        }
    }
}
