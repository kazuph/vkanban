use std::path::Path;

use async_trait::async_trait;
use command_group::AsyncGroupChild;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::{
    actions::Executable,
    executors::{ExecutorError, StandardCodingAgentExecutor, codex::ReasoningEffort},
    profile::{ExecutorConfigs, ExecutorProfileId},
};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
pub struct CodingAgentFollowUpRequest {
    pub prompt: String,
    pub session_id: String,
    /// Executor profile specification
    #[serde(alias = "profile_variant_label")]
    // Backwards compatability with ProfileVariantIds, esp stored in DB under ExecutorAction
    pub executor_profile_id: ExecutorProfileId,
    /// Optional override for Codex model (maps to --model)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub codex_model_override: Option<String>,
    /// Optional override for Codex reasoning effort (maps to --config model_reasoning_effort)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub codex_model_reasoning_effort: Option<ReasoningEffort>,
    /// Optional override for Claude model ("sonnet" | "opus")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub claude_model_override: Option<String>,
    /// If true, force a fresh session instead of attempting resume
    #[serde(skip_serializing_if = "Option::is_none")]
    pub force_new_session: Option<bool>,
}

impl CodingAgentFollowUpRequest {
    /// Get the executor profile ID
    pub fn get_executor_profile_id(&self) -> ExecutorProfileId {
        self.executor_profile_id.clone()
    }
}

#[async_trait]
impl Executable for CodingAgentFollowUpRequest {
    async fn spawn(&self, current_dir: &Path) -> Result<AsyncGroupChild, ExecutorError> {
        let executor_profile_id = self.get_executor_profile_id();
        let agent = ExecutorConfigs::get_cached()
            .get_coding_agent(&executor_profile_id)
            .ok_or(ExecutorError::UnknownExecutorType(
                executor_profile_id.to_string(),
            ))?;

        let force_new = self.force_new_session.unwrap_or(false);
        match agent {
            crate::executors::CodingAgent::Codex(mut cfg) => {
                if let Some(model) = self.codex_model_override.clone() {
                    cfg.model = Some(model);
                }
                if let Some(effort) = self.codex_model_reasoning_effort.clone() {
                    cfg.model_reasoning_effort = Some(effort);
                }
                if force_new {
                    cfg.spawn(current_dir, &self.prompt).await
                } else {
                    cfg.spawn_follow_up(current_dir, &self.prompt, &self.session_id)
                        .await
                }
            }
            crate::executors::CodingAgent::ClaudeCode(mut cfg) => {
                if let Some(model) = self.claude_model_override.clone() {
                    cfg.model = Some(model);
                }
                if force_new {
                    cfg.spawn(current_dir, &self.prompt).await
                } else {
                    cfg.spawn_follow_up(current_dir, &self.prompt, &self.session_id)
                        .await
                }
            }
            other => {
                if force_new {
                    other.spawn(current_dir, &self.prompt).await
                } else {
                    other
                        .spawn_follow_up(current_dir, &self.prompt, &self.session_id)
                        .await
                }
            }
        }
    }
}
