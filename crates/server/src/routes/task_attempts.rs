use std::path::PathBuf;

use axum::{
    BoxError, Extension, Json, Router,
    extract::{Query, State},
    http::StatusCode,
    middleware::from_fn_with_state,
    response::{
        Json as ResponseJson, Sse,
        sse::{Event, KeepAlive},
    },
    routing::{get, post},
};
use db::models::{
    execution_process::{ExecutionProcess, ExecutionProcessRunReason},
    image::TaskImage,
    merge::{Merge, MergeStatus, PrMerge, PullRequestInfo},
    project::{Project, ProjectError},
    task::{Task, TaskStatus},
    task_attempt::{CreateTaskAttempt, TaskAttempt, TaskAttemptError},
};
use deployment::Deployment;
use executors::{
    actions::{
        ExecutorAction, ExecutorActionType,
        coding_agent_follow_up::CodingAgentFollowUpRequest,
        script::{ScriptContext, ScriptRequest, ScriptRequestLanguage},
    },
    executors::codex::ReasoningEffort,
    profile::ExecutorProfileId,
};
use futures_util::TryStreamExt;
use git2::BranchType;
use serde::{Deserialize, Serialize};
use services::services::{
    container::ContainerService,
    github_service::{CreatePrRequest, GitHubService, GitHubServiceError},
    image::ImageService,
    worktree_manager::WorktreeManager,
};
use sqlx::Error as SqlxError;
use ts_rs::TS;
use utils::{browser::open_browser, response::ApiResponse};
use uuid::Uuid;

use crate::{DeploymentImpl, error::ApiError, middleware::load_task_attempt_middleware};

// Helper: Transform stored JSONL logs into a compact conversation text.
fn build_conversation_context_from_logs(
    logs: &db::models::execution_process_logs::ExecutionProcessLogs,
) -> Result<String, serde_json::Error> {
    use utils::log_msg::LogMsg;
    let mut transcript = String::new();
    let msgs = logs.parse_logs()?;
    for m in msgs {
        if let LogMsg::JsonPatch(patch) = m {
            // Represent Patch as JSON to inspect normalized entries
            let val = serde_json::to_value(&patch).unwrap_or(serde_json::json!([]));
            if let Some(arr) = val.as_array() {
                for op in arr {
                    if let Some(value) = op.get("value") {
                        // Expect { type: "NORMALIZED_ENTRY" | "STDOUT" |..., content: {...} }
                        let typ = value.get("type").and_then(|t| t.as_str()).unwrap_or("");
                        if typ == "NORMALIZED_ENTRY"
                            && let Some(content) = value.get("content")
                        {
                            let entry_type = content
                                .get("entry_type")
                                .and_then(|et| et.get("type"))
                                .and_then(|s| s.as_str())
                                .unwrap_or("");
                            let text = content
                                .get("content")
                                .and_then(|c| c.as_str())
                                .unwrap_or("")
                                .trim();
                            match entry_type {
                                "user_message" => {
                                    if !text.is_empty() {
                                        transcript.push_str("User: ");
                                        transcript.push_str(text);
                                        transcript.push('\n');
                                    }
                                }
                                "assistant_message" => {
                                    if !text.is_empty() {
                                        transcript.push_str("Assistant: ");
                                        transcript.push_str(text);
                                        transcript.push('\n');
                                    }
                                }
                                "tool_use" => {
                                    if let Some(action) = content
                                        .get("entry_type")
                                        .and_then(|et| et.get("action_type"))
                                        .and_then(|a| a.get("action"))
                                        .and_then(|s| s.as_str())
                                        && action == "plan_presentation"
                                        && let Some(plan) = content
                                            .get("entry_type")
                                            .and_then(|et| et.get("action_type"))
                                            .and_then(|a| a.get("plan"))
                                            .and_then(|p| p.as_str())
                                    {
                                        transcript.push_str("Plan:\n");
                                        transcript.push_str(plan.trim());
                                        transcript.push('\n');
                                    }
                                }
                                _ => {}
                            }
                        }
                    }
                }
            }
        }
    }
    Ok(transcript)
}

#[derive(Debug, Deserialize, Serialize, TS)]
pub struct RebaseTaskAttemptRequest {
    pub new_base_branch: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, TS)]
pub struct RestoreAttemptRequest {
    /// Process to restore to (target = its after_head_commit)
    pub process_id: Uuid,
    /// If true, allow resetting Git even when uncommitted changes exist
    pub force_when_dirty: Option<bool>,
    /// If false, skip performing the Git reset step (history drop still applies)
    pub perform_git_reset: Option<bool>,
}

#[derive(Debug, Serialize, TS)]
pub struct RestoreAttemptResult {
    pub had_later_processes: bool,
    pub git_reset_needed: bool,
    pub git_reset_applied: bool,
    pub target_after_oid: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, TS)]
pub struct CreateGitHubPrRequest {
    pub title: String,
    pub body: Option<String>,
    pub base_branch: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, TS)]
pub struct UpdateAttemptBranchRequest {
    pub branch: String,
}

#[derive(Debug, Serialize)]
pub struct FollowUpResponse {
    pub message: String,
    pub actual_attempt_id: Uuid,
    pub created_new_attempt: bool,
}

#[derive(Debug, Deserialize)]
pub struct TaskAttemptQuery {
    pub task_id: Option<Uuid>,
}

pub async fn get_task_attempts(
    State(deployment): State<DeploymentImpl>,
    Query(query): Query<TaskAttemptQuery>,
) -> Result<ResponseJson<ApiResponse<Vec<TaskAttempt>>>, ApiError> {
    let pool = &deployment.db().pool;

    let attempts = TaskAttempt::fetch_all(pool, query.task_id).await?;
    Ok(ResponseJson(ApiResponse::success(attempts)))
}

pub async fn get_task_attempt(
    Extension(task_attempt): Extension<TaskAttempt>,
    State(_deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<TaskAttempt>>, ApiError> {
    Ok(ResponseJson(ApiResponse::success(task_attempt)))
}

#[derive(Debug, Deserialize, ts_rs::TS)]
pub struct CreateTaskAttemptBody {
    pub task_id: Uuid,
    /// Executor profile specification
    pub executor_profile_id: ExecutorProfileId,
    pub base_branch: String,
    /// Optional: reuse branch and worktree from an existing attempt (same task)
    pub reuse_branch_of_attempt_id: Option<Uuid>,
    /// Optional: initial instructions to be treated as the primary request
    pub initial_instructions: Option<String>,
    /// Optional model override for Codex on initial run
    pub codex_model_override: Option<String>,
    /// Optional reasoning effort override for Codex on initial run
    pub codex_model_reasoning_effort: Option<ReasoningEffort>,
    /// Optional model override for Claude on initial run
    pub claude_model_override: Option<String>,
}

impl CreateTaskAttemptBody {
    /// Get the executor profile ID
    pub fn get_executor_profile_id(&self) -> ExecutorProfileId {
        self.executor_profile_id.clone()
    }
}

#[axum::debug_handler]
pub async fn create_task_attempt(
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<CreateTaskAttemptBody>,
) -> Result<ResponseJson<ApiResponse<TaskAttempt>>, ApiError> {
    let executor_profile_id = payload.get_executor_profile_id();

    let mut task_attempt = TaskAttempt::create(
        &deployment.db().pool,
        &CreateTaskAttempt {
            executor: executor_profile_id.executor,
            base_branch: payload.base_branch.clone(),
        },
        payload.task_id,
    )
    .await?;

    // Soft-lock: If no explicit reuse source is provided, try to reuse the latest
    // existing attempt's branch/worktree for the same task. This keeps
    // "1 task = 1 branch" as the default developer experience without a hard DB constraint.
    if payload.reuse_branch_of_attempt_id.is_none() {
        let pool = &deployment.db().pool;
        // Newest first
        let existing_attempts = TaskAttempt::fetch_all(pool, Some(payload.task_id)).await?;
        if let Some(src) = existing_attempts.into_iter().find(|a| {
            a.id != task_attempt.id
                && !a.worktree_deleted
                && a.branch.is_some()
                && a.container_ref.is_some()
        }) {
            let branch = src.branch.as_ref().expect("checked is_some");
            let container_ref = src.container_ref.as_ref().expect("checked is_some");

            // Persist the reused pointers into the new attempt
            TaskAttempt::update_branch(pool, task_attempt.id, branch).await?;
            TaskAttempt::update_container_ref(pool, task_attempt.id, container_ref).await?;
            // Keep base_branch consistent with the source (important for diffs/PR base)
            TaskAttempt::update_base_branch(pool, task_attempt.id, &src.base_branch).await?;

            // Reload for downstream operations
            task_attempt = TaskAttempt::find_by_id(pool, task_attempt.id)
                .await?
                .expect("attempt just created must exist");

            tracing::info!(
                "Soft-lock: reused branch '{}' and worktree for new attempt {} (task {})",
                branch,
                task_attempt.id,
                task_attempt.task_id
            );
        }
    }

    // If requested, reuse branch and container/worktree from an existing attempt
    if let Some(src_attempt_id) = payload.reuse_branch_of_attempt_id {
        let pool = &deployment.db().pool;
        let src =
            TaskAttempt::find_by_id(pool, src_attempt_id)
                .await?
                .ok_or(ApiError::TaskAttempt(TaskAttemptError::ValidationError(
                    "Source attempt not found".to_string(),
                )))?;
        if src.task_id != payload.task_id {
            return Err(ApiError::TaskAttempt(TaskAttemptError::ValidationError(
                "Source attempt belongs to a different task".to_string(),
            )));
        }
        let branch =
            src.branch
                .clone()
                .ok_or(ApiError::TaskAttempt(TaskAttemptError::ValidationError(
                    "Source attempt has no branch to reuse".to_string(),
                )))?;
        let container_ref = src.container_ref.clone().ok_or(ApiError::TaskAttempt(
            TaskAttemptError::ValidationError(
                "Source attempt has no worktree to reuse".to_string(),
            ),
        ))?;

        // Persist the reused pointers into the new attempt
        TaskAttempt::update_branch(pool, task_attempt.id, &branch).await?;
        TaskAttempt::update_container_ref(pool, task_attempt.id, &container_ref).await?;
        // Keep base_branch consistent with the source
        TaskAttempt::update_base_branch(pool, task_attempt.id, &src.base_branch).await?;

        // Reload the struct for downstream operations
        task_attempt = TaskAttempt::find_by_id(pool, task_attempt.id)
            .await?
            .expect("attempt just created must exist");
    }

    let execution_process = deployment
        .container()
        .start_attempt(
            &task_attempt,
            executor_profile_id.clone(),
            payload.initial_instructions.clone(),
            payload.codex_model_override.clone(),
            payload.codex_model_reasoning_effort.clone(),
            payload.claude_model_override.clone(),
        )
        .await?;

    deployment
        .track_if_analytics_allowed(
            "task_attempt_started",
            serde_json::json!({
                "task_id": task_attempt.task_id.to_string(),
                "variant": &executor_profile_id.variant,
                "executor": &executor_profile_id.executor,
                "attempt_id": task_attempt.id.to_string(),
            }),
        )
        .await;

    tracing::info!("Started execution process {}", execution_process.id);

    Ok(ResponseJson(ApiResponse::success(task_attempt)))
}

#[derive(Debug, Deserialize, TS)]
pub struct CreateFollowUpAttempt {
    pub prompt: String,
    pub variant: Option<String>,
    pub image_ids: Option<Vec<Uuid>>,
    /// Optional: fully specify the executor to use for this follow-up
    /// If provided, this takes precedence over `variant`.
    pub executor_profile_id: Option<ExecutorProfileId>,
    /// Optional Codex model override (e.g., "gpt-5", "codex-mini-latest")
    pub codex_model_override: Option<String>,
    /// Optional Codex reasoning effort override (maps to --config model_reasoning_effort)
    pub codex_model_reasoning_effort: Option<ReasoningEffort>,
    /// Optional Claude model override ("sonnet" | "opus")
    pub claude_model_override: Option<String>,
}

pub async fn follow_up(
    Extension(task_attempt): Extension<TaskAttempt>,
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<CreateFollowUpAttempt>,
) -> Result<ResponseJson<ApiResponse<ExecutionProcess>>, ApiError> {
    tracing::info!("{:?}", task_attempt);

    // Ensure worktree exists (recreate if needed for cold task support)
    deployment
        .container()
        .ensure_container_exists(&task_attempt)
        .await?;

    // Get latest session id (ignoring dropped)
    let session_id = ExecutionProcess::find_latest_session_id_by_task_attempt(
        &deployment.db().pool,
        task_attempt.id,
    )
    .await?
    .ok_or(ApiError::TaskAttempt(TaskAttemptError::ValidationError(
        "Couldn't find a prior session_id, please create a new task attempt".to_string(),
    )))?;

    // Get ExecutionProcess for profile data
    let latest_execution_process = ExecutionProcess::find_latest_by_task_attempt_and_run_reason(
        &deployment.db().pool,
        task_attempt.id,
        &ExecutionProcessRunReason::CodingAgent,
    )
    .await?
    .ok_or(ApiError::TaskAttempt(TaskAttemptError::ValidationError(
        "Couldn't find initial coding agent process, has it run yet?".to_string(),
    )))?;
    let initial_executor_profile_id = match &latest_execution_process
        .executor_action()
        .map_err(|e| ApiError::TaskAttempt(TaskAttemptError::ValidationError(e.to_string())))?
        .typ
    {
        ExecutorActionType::CodingAgentInitialRequest(request) => {
            Ok(request.executor_profile_id.clone())
        }
        ExecutorActionType::CodingAgentFollowUpRequest(request) => {
            Ok(request.executor_profile_id.clone())
        }
        _ => Err(ApiError::TaskAttempt(TaskAttemptError::ValidationError(
            "Couldn't find profile from initial request".to_string(),
        ))),
    }?;

    let executor_profile_id = if let Some(overridden) = payload.executor_profile_id.clone() {
        overridden
    } else {
        ExecutorProfileId {
            executor: initial_executor_profile_id.executor,
            variant: payload.variant,
        }
    };

    // Get parent task
    let task = task_attempt
        .parent_task(&deployment.db().pool)
        .await?
        .ok_or(SqlxError::RowNotFound)?;

    // Get parent project
    let project = task
        .parent_project(&deployment.db().pool)
        .await?
        .ok_or(SqlxError::RowNotFound)?;

    // Clone to keep the original user input accessible later (e.g.,
    // when composing compact fallback prompts) while we mutate `prompt`
    // with image path canonicalization and project-level append rules.
    let mut prompt = payload.prompt.clone();
    if let Some(image_ids) = &payload.image_ids {
        TaskImage::associate_many(&deployment.db().pool, task.id, image_ids).await?;

        // Copy new images from the image cache to the worktree
        if let Some(container_ref) = &task_attempt.container_ref {
            let worktree_path = std::path::PathBuf::from(container_ref);
            deployment
                .image()
                .copy_images_by_ids_to_worktree(&worktree_path, image_ids)
                .await?;

            // Update image paths in prompt with full worktree path
            prompt = ImageService::canonicalise_image_paths(&prompt, &worktree_path);
        }
    }

    // Append project-level default instructions if configured
    if let Some(ref ap) = project.append_prompt {
        prompt = format!("{prompt}{ap}");
    }

    let cleanup_action = project.cleanup_script.map(|script| {
        Box::new(ExecutorAction::new(
            ExecutorActionType::ScriptRequest(ScriptRequest {
                script,
                language: ScriptRequestLanguage::Bash,
                context: ScriptContext::CleanupScript,
            }),
            None,
        ))
    });

    // Determine cross-executor resume compatibility
    let is_executor_changed = initial_executor_profile_id.executor != executor_profile_id.executor;
    let mut prepared_prompt = prompt;

    // If switching executors, prepend prior conversation as context and force new session
    let mut force_new_session = false;
    if is_executor_changed {
        force_new_session = true;
        // Attempt to reconstruct a concise conversation from the latest process logs
        if let Ok(Some(prev_logs)) =
            db::models::execution_process_logs::ExecutionProcessLogs::find_by_execution_id(
                &deployment.db().pool,
                latest_execution_process.id,
            )
            .await
            && let Ok(history) = build_conversation_context_from_logs(&prev_logs)
        {
            let header = "Context from previous agent (shortened):\n";
            let sep = "\n\n---\n\n";
            let mut ctx = history;
            if ctx.len() > 8000 {
                ctx.truncate(8000);
            }
            prepared_prompt = format!("{header}{ctx}{sep}{prepared_prompt}");
        }
    }

    // Fallback for Codex: if the previous coding agent process failed with exit code 1
    // (commonly due to oversized context), start a fresh session with a compact prompt.
    // Keep only: the new instruction, task title/description, and a note to use git logs/diff.
    if !force_new_session
        && matches!(
            executor_profile_id.executor,
            executors::executors::BaseCodingAgent::Codex
        )
        && matches!(
            initial_executor_profile_id.executor,
            executors::executors::BaseCodingAgent::Codex
        )
        && latest_execution_process.status
            == db::models::execution_process::ExecutionProcessStatus::Failed
        && latest_execution_process.exit_code == Some(1)
    {
        // Compose a compact fallback prompt
        let mut fallback = String::new();
        // Use the original (unmutated) user prompt for the compact fallback
        // to avoid pulling in project-level appended text or path rewrites.
        let user_msg = payload.prompt.trim();
        if !user_msg.is_empty() {
            fallback.push_str(user_msg);
            fallback.push_str("\n\n");
        }
        // Task context kept minimal
        fallback.push_str("[Task]\n");
        fallback.push_str(&format!("Title: {}\n", task.title.trim()));
        if let Some(desc) = &task.description
            && !desc.trim().is_empty()
        {
            fallback.push_str("Description: ");
            fallback.push_str(desc.trim());
            fallback.push('\n');
        }
        // Guidance to use git history/diff for further context
        let branch_info = task_attempt
            .branch
            .as_ref()
            .map(|b| format!(" (branch: {b})"))
            .unwrap_or_default();
        fallback.push_str("\n[Guidance]\n");
        fallback.push_str(
            &format!(
                "Prior run likely failed due to an oversized context. Do not attempt to load full prior conversation/state. Use repository signals instead{branch_info}:\n- Inspect recent commits (e.g., `git log --oneline -n 20`).\n- Use `git status` and `git diff` to understand current changes.\n- Then continue with the new instruction above.\n"
            ),
        );

        prepared_prompt = fallback;
        force_new_session = true; // Avoid resuming large sessions

        tracing::warn!(
            "Applying Codex fallback for attempt {}: previous process failed with exit code 1; starting fresh session with compact prompt",
            task_attempt.id
        );
    }

    let follow_up_request = CodingAgentFollowUpRequest {
        prompt: prepared_prompt,
        session_id,
        executor_profile_id,
        codex_model_override: payload.codex_model_override,
        codex_model_reasoning_effort: payload.codex_model_reasoning_effort,
        claude_model_override: payload.claude_model_override,
        force_new_session: Some(force_new_session),
    };

    let follow_up_action = ExecutorAction::new(
        ExecutorActionType::CodingAgentFollowUpRequest(follow_up_request),
        cleanup_action,
    );

    let execution_process = deployment
        .container()
        .start_execution(
            &task_attempt,
            &follow_up_action,
            &ExecutionProcessRunReason::CodingAgent,
        )
        .await?;

    Ok(ResponseJson(ApiResponse::success(execution_process)))
}

#[derive(Debug, Deserialize, Serialize, TS)]
pub struct ExportPlanToIssueRequest {
    pub title: String,
    /// Plan content in Markdown. The server will split into issue + comments if too long.
    pub plan_markdown: String,
}

#[derive(Debug, Serialize, TS)]
pub struct ExportPlanToIssueResponse {
    pub url: String,
    pub number: i64,
}

/// Export a provided plan markdown into a GitHub issue for the task's repository
pub async fn export_plan_to_issue(
    Extension(task_attempt): Extension<TaskAttempt>,
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<ExportPlanToIssueRequest>,
) -> Result<ResponseJson<ApiResponse<ExportPlanToIssueResponse>>, ApiError> {
    let pool = &deployment.db().pool;

    // Resolve project repo for this attempt
    let task = task_attempt
        .parent_task(pool)
        .await?
        .ok_or(SqlxError::RowNotFound)?;
    let project = task
        .parent_project(pool)
        .await?
        .ok_or(SqlxError::RowNotFound)?;

    // Ensure GitHub token configured
    let github_token = {
        let cfg = deployment.config().read().await;
        cfg.github.token()
    };
    let github_token = github_token.ok_or_else(|| {
        ApiError::TaskAttempt(TaskAttemptError::ValidationError(
            "GitHub token not configured. Please authenticate with GitHub first.".to_string(),
        ))
    })?;

    // Derive owner/repo from project's git path
    let repo_info = deployment
        .git()
        .get_github_repo_info(std::path::Path::new(&project.git_repo_path))
        .map_err(services::services::github_service::GitHubServiceError::from)?;

    // Create GitHub client and create issue (with chunking if needed)
    let gh = services::services::github_service::GitHubService::new(&github_token)
        .map_err(ApiError::from)?;

    let issue = gh
        .create_issue(&repo_info, &payload.title, &payload.plan_markdown)
        .await
        .map_err(ApiError::from)?;

    deployment
        .track_if_analytics_allowed(
            "github_issue_created",
            serde_json::json!({
                "task_id": task.id.to_string(),
                "project_id": project.id.to_string(),
                "attempt_id": task_attempt.id.to_string(),
            }),
        )
        .await;

    Ok(ResponseJson(ApiResponse::success(
        ExportPlanToIssueResponse {
            url: issue.url,
            number: issue.number,
        },
    )))
}

#[axum::debug_handler]
pub async fn restore_task_attempt(
    Extension(task_attempt): Extension<TaskAttempt>,
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<RestoreAttemptRequest>,
) -> Result<ResponseJson<ApiResponse<RestoreAttemptResult>>, ApiError> {
    let pool = &deployment.db().pool;
    let proc_id = payload.process_id;
    let force_when_dirty = payload.force_when_dirty.unwrap_or(false);
    let perform_git_reset = payload.perform_git_reset.unwrap_or(true);

    // Validate process belongs to attempt
    let process =
        ExecutionProcess::find_by_id(pool, proc_id)
            .await?
            .ok_or(ApiError::TaskAttempt(TaskAttemptError::ValidationError(
                "Process not found".to_string(),
            )))?;
    if process.task_attempt_id != task_attempt.id {
        return Err(ApiError::TaskAttempt(TaskAttemptError::ValidationError(
            "Process does not belong to this attempt".to_string(),
        )));
    }

    // Determine if there are later processes
    let later = ExecutionProcess::count_later_than(pool, task_attempt.id, proc_id).await?;
    let had_later_processes = later > 0;

    // Mark later processes as dropped
    if had_later_processes {
        ExecutionProcess::set_restore_boundary(pool, task_attempt.id, proc_id).await?;
    }

    // Attempt Git reset to this process's after_head_commit if needed
    let mut git_reset_needed = false;
    let mut git_reset_applied = false;
    let target_after_oid = process.after_head_commit.clone();
    if perform_git_reset {
        if let Some(target_oid) = &target_after_oid {
            let container_ref = deployment
                .container()
                .ensure_container_exists(&task_attempt)
                .await?;
            let wt = std::path::Path::new(&container_ref);
            let head_oid = deployment.git().get_head_info(wt).ok().map(|h| h.oid);
            let is_dirty = deployment
                .container()
                .is_container_clean(&task_attempt)
                .await
                .map(|is_clean| !is_clean)
                .unwrap_or(false);
            if head_oid.as_deref() != Some(target_oid.as_str()) || is_dirty {
                git_reset_needed = true;
                if is_dirty && !force_when_dirty {
                    git_reset_applied = false; // cannot reset now
                } else if let Err(e) =
                    deployment
                        .git()
                        .reset_worktree_to_commit(wt, target_oid, force_when_dirty)
                {
                    tracing::error!("Failed to reset worktree: {}", e);
                    git_reset_applied = false;
                } else {
                    git_reset_applied = true;
                }
            }
        }
    } else {
        // Skipped git reset; still compute if it would be needed for informational result
        if let Some(target_oid) = &target_after_oid {
            let container_ref = deployment
                .container()
                .ensure_container_exists(&task_attempt)
                .await?;
            let wt = std::path::Path::new(&container_ref);
            let head_oid = deployment.git().get_head_info(wt).ok().map(|h| h.oid);
            let is_dirty = deployment
                .container()
                .is_container_clean(&task_attempt)
                .await
                .map(|is_clean| !is_clean)
                .unwrap_or(false);
            if head_oid.as_deref() != Some(target_oid.as_str()) || is_dirty {
                git_reset_needed = true;
            }
            git_reset_applied = false;
        }
    }

    Ok(ResponseJson(ApiResponse::success(RestoreAttemptResult {
        had_later_processes,
        git_reset_needed,
        git_reset_applied,
        target_after_oid,
    })))
}

pub async fn get_task_attempt_diff(
    Extension(task_attempt): Extension<TaskAttempt>,
    State(deployment): State<DeploymentImpl>,
    // ) -> Result<ResponseJson<ApiResponse<Diff>>, ApiError> {
) -> Result<Sse<impl futures_util::Stream<Item = Result<Event, BoxError>>>, ApiError> {
    let stream = deployment.container().get_diff(&task_attempt).await?;

    Ok(Sse::new(stream.map_err(|e| -> BoxError { e.into() })).keep_alive(KeepAlive::default()))
}

#[derive(Debug, Serialize, TS)]
pub struct CommitInfo {
    pub sha: String,
    pub subject: String,
}

pub async fn get_commit_info(
    Extension(task_attempt): Extension<TaskAttempt>,
    State(deployment): State<DeploymentImpl>,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> Result<ResponseJson<ApiResponse<CommitInfo>>, ApiError> {
    let Some(sha) = params.get("sha").cloned() else {
        return Err(ApiError::TaskAttempt(TaskAttemptError::ValidationError(
            "Missing sha param".to_string(),
        )));
    };
    let container_ref = deployment
        .container()
        .ensure_container_exists(&task_attempt)
        .await?;
    let wt = std::path::Path::new(&container_ref);
    let subject = deployment.git().get_commit_subject(wt, &sha)?;
    Ok(ResponseJson(ApiResponse::success(CommitInfo {
        sha,
        subject,
    })))
}

#[derive(Debug, Serialize, TS)]
pub struct CommitCompareResult {
    pub head_oid: String,
    pub target_oid: String,
    pub ahead_from_head: usize,
    pub behind_from_head: usize,
    pub is_linear: bool,
}

pub async fn compare_commit_to_head(
    Extension(task_attempt): Extension<TaskAttempt>,
    State(deployment): State<DeploymentImpl>,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> Result<ResponseJson<ApiResponse<CommitCompareResult>>, ApiError> {
    let Some(target_oid) = params.get("sha").cloned() else {
        return Err(ApiError::TaskAttempt(TaskAttemptError::ValidationError(
            "Missing sha param".to_string(),
        )));
    };
    let container_ref = deployment
        .container()
        .ensure_container_exists(&task_attempt)
        .await?;
    let wt = std::path::Path::new(&container_ref);
    let head_info = deployment.git().get_head_info(wt)?;
    let (ahead_from_head, behind_from_head) =
        deployment
            .git()
            .ahead_behind_commits_by_oid(wt, &head_info.oid, &target_oid)?;
    let is_linear = behind_from_head == 0;
    Ok(ResponseJson(ApiResponse::success(CommitCompareResult {
        head_oid: head_info.oid,
        target_oid,
        ahead_from_head,
        behind_from_head,
        is_linear,
    })))
}

#[axum::debug_handler]
pub async fn merge_task_attempt(
    Extension(task_attempt): Extension<TaskAttempt>,
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<()>>, ApiError> {
    let pool = &deployment.db().pool;

    let task = task_attempt
        .parent_task(pool)
        .await?
        .ok_or(ApiError::TaskAttempt(TaskAttemptError::TaskNotFound))?;
    let ctx = TaskAttempt::load_context(pool, task_attempt.id, task.id, task.project_id).await?;

    let container_ref = deployment
        .container()
        .ensure_container_exists(&task_attempt)
        .await?;
    let worktree_path = std::path::Path::new(&container_ref);

    let task_uuid_str = task.id.to_string();
    let first_uuid_section = task_uuid_str.split('-').next().unwrap_or(&task_uuid_str);

    // Create commit message with task title and description
    let mut commit_message = format!("{} (vibe-kanban {})", ctx.task.title, first_uuid_section);

    // Add description on next line if it exists
    if let Some(description) = &ctx.task.description
        && !description.trim().is_empty()
    {
        commit_message.push_str("\n\n");
        commit_message.push_str(description);
    }

    // Get branch name from task attempt
    let branch_name = ctx.task_attempt.branch.as_ref().ok_or_else(|| {
        ApiError::TaskAttempt(TaskAttemptError::ValidationError(
            "No branch found for task attempt".to_string(),
        ))
    })?;

    let merge_commit_id = deployment.git().merge_changes(
        &ctx.project.git_repo_path,
        worktree_path,
        branch_name,
        &ctx.task_attempt.base_branch,
        &commit_message,
    )?;

    Merge::create_direct(
        pool,
        task_attempt.id,
        &ctx.task_attempt.base_branch,
        &merge_commit_id,
    )
    .await?;
    Task::update_status(pool, ctx.task.id, TaskStatus::Done).await?;

    deployment
        .track_if_analytics_allowed(
            "task_attempt_merged",
            serde_json::json!({
                "task_id": ctx.task.id.to_string(),
                "project_id": ctx.project.id.to_string(),
                "attempt_id": task_attempt.id.to_string(),
            }),
        )
        .await;

    Ok(ResponseJson(ApiResponse::success(())))
}

pub async fn push_task_attempt_branch(
    Extension(task_attempt): Extension<TaskAttempt>,
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<()>>, ApiError> {
    let github_config = deployment.config().read().await.github.clone();
    let Some(github_token) = github_config.token() else {
        return Err(GitHubServiceError::TokenInvalid.into());
    };

    let github_service = GitHubService::new(&github_token)?;
    github_service.check_token().await?;

    let branch_name = task_attempt.branch.as_ref().ok_or_else(|| {
        ApiError::TaskAttempt(TaskAttemptError::ValidationError(
            "No branch found for task attempt".to_string(),
        ))
    })?;
    let ws_path = PathBuf::from(
        deployment
            .container()
            .ensure_container_exists(&task_attempt)
            .await?,
    );

    deployment
        .git()
        .push_to_github(&ws_path, branch_name, &github_token)?;
    Ok(ResponseJson(ApiResponse::success(())))
}

pub async fn create_github_pr(
    Extension(task_attempt): Extension<TaskAttempt>,
    State(deployment): State<DeploymentImpl>,
    Json(request): Json<CreateGitHubPrRequest>,
) -> Result<ResponseJson<ApiResponse<String, GitHubServiceError>>, ApiError> {
    let github_config = deployment.config().read().await.github.clone();
    let Some(github_token) = github_config.token() else {
        return Ok(ResponseJson(ApiResponse::error_with_data(
            GitHubServiceError::TokenInvalid,
        )));
    };
    // Create GitHub service instance
    let github_service = GitHubService::new(&github_token)?;
    if let Err(e) = github_service.check_token().await {
        if e.is_api_data() {
            return Ok(ResponseJson(ApiResponse::error_with_data(e)));
        } else {
            return Err(ApiError::GitHubService(e));
        }
    }
    // Get the task attempt to access the stored base branch
    let base_branch = request.base_branch.unwrap_or_else(|| {
        // Use the stored base branch from the task attempt as the default
        // Fall back to config default or "main" only if stored base branch is somehow invalid
        if !task_attempt.base_branch.trim().is_empty() {
            task_attempt.base_branch.clone()
        } else {
            github_config
                .default_pr_base
                .as_ref()
                .map_or_else(|| "main".to_string(), |b| b.to_string())
        }
    });

    let pool = &deployment.db().pool;
    let task = task_attempt
        .parent_task(pool)
        .await?
        .ok_or(ApiError::TaskAttempt(TaskAttemptError::TaskNotFound))?;
    let project = Project::find_by_id(pool, task.project_id)
        .await?
        .ok_or(ApiError::Project(ProjectError::ProjectNotFound))?;

    // Use GitService to get the remote URL, then create GitHubRepoInfo
    let repo_info = deployment
        .git()
        .get_github_repo_info(&project.git_repo_path)?;

    // Get branch name from task attempt
    let branch_name = task_attempt.branch.as_ref().ok_or_else(|| {
        ApiError::TaskAttempt(TaskAttemptError::ValidationError(
            "No branch found for task attempt".to_string(),
        ))
    })?;
    // 1) 既存PRリンクがDBにあればそのURLを返す（ブラウザも開く）
    if let Ok(merges) = Merge::find_by_task_attempt_id(pool, task_attempt.id).await
        && let Some(existing_open) = merges.into_iter().find_map(|m| match m {
            Merge::Pr(pr) if matches!(pr.pr_info.status, MergeStatus::Open) => Some(pr),
            _ => None,
        })
    {
        let url = existing_open.pr_info.url.clone();
        let pr_url = url.clone();
        tokio::spawn(async move {
            if let Err(e) = open_browser(&pr_url).await {
                tracing::debug!("Failed to open PR in browser (ignored): {}", e);
            }
        });
        return Ok(ResponseJson(ApiResponse::success(url)));
    }

    // 2) GitHub上に既存のオープンPRがあるかを一度スキャン。見つかればDBに登録して返す
    if let Some((pr_info, base_detected)) = github_service
        .find_open_pr_for_branch(&repo_info, branch_name, None)
        .await
        .map_err(ApiError::GitHubService)?
    {
        let target_base = if !base_detected.trim().is_empty() {
            base_detected
        } else {
            task_attempt.base_branch.clone()
        };
        if let Err(e) = Merge::create_pr(
            pool,
            task_attempt.id,
            &target_base,
            pr_info.number,
            &pr_info.url,
        )
        .await
        {
            tracing::error!("Failed to record existing PR in DB: {}", e);
        }

        deployment
            .track_if_analytics_allowed(
                "github_pr_linked_existing",
                serde_json::json!({
                    "task_id": task.id.to_string(),
                    "project_id": project.id.to_string(),
                    "attempt_id": task_attempt.id.to_string(),
                }),
            )
            .await;

        let pr_url = pr_info.url.clone();
        tokio::spawn(async move {
            if let Err(e) = open_browser(&pr_url).await {
                tracing::debug!("Failed to open PR in browser (ignored): {}", e);
            }
        });
        return Ok(ResponseJson(ApiResponse::success(pr_info.url)));
    }
    let workspace_path = PathBuf::from(
        deployment
            .container()
            .ensure_container_exists(&task_attempt)
            .await?,
    );

    // Push the branch to GitHub first
    if let Err(e) = deployment
        .git()
        .push_to_github(&workspace_path, branch_name, &github_token)
    {
        tracing::error!("Failed to push branch to GitHub: {}", e);
        let gh_e = GitHubServiceError::from(e);
        if gh_e.is_api_data() {
            return Ok(ResponseJson(ApiResponse::error_with_data(gh_e)));
        } else {
            return Ok(ResponseJson(ApiResponse::error(
                format!("Failed to push branch to GitHub: {}", gh_e).as_str(),
            )));
        }
    }

    let norm_base_branch_name = if matches!(
        deployment
            .git()
            .find_branch_type(&project.git_repo_path, &base_branch)?,
        BranchType::Remote
    ) {
        // Remote branches are formatted as {remote}/{branch} locally.
        // For PR APIs, we must provide just the branch name.
        let remote = deployment
            .git()
            .get_remote_name_from_branch_name(&workspace_path, &base_branch)?;
        let remote_prefix = format!("{}/", remote);
        base_branch
            .strip_prefix(&remote_prefix)
            .unwrap_or(&base_branch)
            .to_string()
    } else {
        base_branch
    };

    // Preflight: if there are no commits ahead of base, GitHub will 422 (Validation Failed).
    // Provide a clearer message to the user instead.
    if let Ok((commits_ahead, _behind)) = deployment.git().get_branch_status(
        &project.git_repo_path,
        branch_name,
        &norm_base_branch_name,
    ) && commits_ahead == 0
    {
        return Ok(ResponseJson(ApiResponse::error(
            "No changes between head and base; commit changes before creating a PR.",
        )));
    }
    // Create the PR using GitHub service
    let pr_request = CreatePrRequest {
        title: request.title.clone(),
        body: request.body.clone(),
        head_branch: branch_name.clone(),
        base_branch: norm_base_branch_name.clone(),
    };

    match github_service.create_pr(&repo_info, &pr_request).await {
        Ok(pr_info) => {
            // Update the task attempt with PR information
            if let Err(e) = Merge::create_pr(
                pool,
                task_attempt.id,
                &norm_base_branch_name,
                pr_info.number,
                &pr_info.url,
            )
            .await
            {
                tracing::error!("Failed to update task attempt PR status: {}", e);
            }

            deployment
                .track_if_analytics_allowed(
                    "github_pr_created",
                    serde_json::json!({
                        "task_id": task.id.to_string(),
                        "project_id": project.id.to_string(),
                        "attempt_id": task_attempt.id.to_string(),
                    }),
                )
                .await;

            // Best-effort: open the PR URL in the user's browser. Ignore any error.
            let pr_url = pr_info.url.clone();
            tokio::spawn(async move {
                if let Err(e) = open_browser(&pr_url).await {
                    tracing::debug!("Failed to open PR in browser (ignored): {}", e);
                }
            });

            Ok(ResponseJson(ApiResponse::success(pr_info.url)))
        }
        Err(e) => {
            tracing::error!(
                "Failed to create GitHub PR for attempt {}: {}",
                task_attempt.id,
                e
            );
            if e.is_api_data() {
                Ok(ResponseJson(ApiResponse::error_with_data(e)))
            } else {
                Ok(ResponseJson(ApiResponse::error(
                    format!("Failed to create PR: {}", e).as_str(),
                )))
            }
        }
    }
}

/// Open an existing GitHub PR for this attempt if one exists.
///
/// Behavior:
/// 1) If an open PR is already recorded in the DB for this attempt, open it in the browser and return its URL.
/// 2) Otherwise, best-effort scan GitHub for an open PR for the attempt branch. If found, record it in DB, open it, and return its URL.
/// 3) If none is found (or token is unavailable), return a Result-style ApiResponse with success=false and a message.
#[axum::debug_handler]
pub async fn open_existing_github_pr(
    Extension(task_attempt): Extension<TaskAttempt>,
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<String, GitHubServiceError>>, ApiError> {
    let pool = &deployment.db().pool;

    // Load context needed to resolve repo and project
    let task = task_attempt
        .parent_task(pool)
        .await?
        .ok_or(ApiError::TaskAttempt(TaskAttemptError::TaskNotFound))?;
    let project = Project::find_by_id(pool, task.project_id)
        .await?
        .ok_or(ApiError::Project(ProjectError::ProjectNotFound))?;

    // Branch name for this attempt
    let branch_name = task_attempt.branch.as_ref().ok_or_else(|| {
        ApiError::TaskAttempt(TaskAttemptError::ValidationError(
            "No branch found for task attempt".to_string(),
        ))
    })?;

    // (1) If DB already knows an open PR, open and return it immediately
    if let Ok(merges) = Merge::find_by_task_attempt_id(pool, task_attempt.id).await
        && let Some(existing_open) = merges.into_iter().find_map(|m| match m {
            Merge::Pr(pr) if matches!(pr.pr_info.status, MergeStatus::Open) => Some(pr),
            _ => None,
        })
    {
        let url = existing_open.pr_info.url.clone();
        let pr_url = url.clone();
        tokio::spawn(async move {
            if let Err(e) = open_browser(&pr_url).await {
                tracing::debug!("Failed to open PR in browser (ignored): {}", e);
            }
        });
        return Ok(ResponseJson(ApiResponse::success(url)));
    }

    // Best-effort: if we have a valid token, query GitHub for an existing open PR
    let github_config = deployment.config().read().await.github.clone();
    if let Some(github_token) = github_config.token() {
        let github_service = GitHubService::new(&github_token)?;
        if let Err(e) = github_service.check_token().await {
            // If token invalid, just fall through and return not-found semantics
            if !e.is_api_data() {
                // Non-API error (e.g., network) -> surface as server error
                return Err(ApiError::GitHubService(e));
            }
        } else {
            let repo_info = deployment
                .git()
                .get_github_repo_info(&project.git_repo_path)?;

            if let Some((pr_info, base_detected)) = github_service
                .find_open_pr_for_branch(&repo_info, branch_name, None)
                .await
                .map_err(ApiError::GitHubService)?
            {
                let target_base = if !base_detected.trim().is_empty() {
                    base_detected
                } else {
                    task_attempt.base_branch.clone()
                };
                if let Err(e) = Merge::create_pr(
                    pool,
                    task_attempt.id,
                    &target_base,
                    pr_info.number,
                    &pr_info.url,
                )
                .await
                {
                    tracing::error!("Failed to record existing PR in DB: {}", e);
                }

                deployment
                    .track_if_analytics_allowed(
                        "github_pr_linked_existing",
                        serde_json::json!({
                            "task_id": task.id.to_string(),
                            "project_id": project.id.to_string(),
                            "attempt_id": task_attempt.id.to_string(),
                        }),
                    )
                    .await;

                let pr_url = pr_info.url.clone();
                tokio::spawn(async move {
                    if let Err(e) = open_browser(&pr_url).await {
                        tracing::debug!("Failed to open PR in browser (ignored): {}", e);
                    }
                });
                return Ok(ResponseJson(ApiResponse::success(pr_info.url)));
            }
        }
    }

    // Not found or cannot check. Return a result-like error; frontend will open the dialog.
    Ok(ResponseJson(ApiResponse::error(
        "No existing PR found for this attempt",
    )))
}

#[derive(serde::Deserialize)]
pub struct OpenEditorRequest {
    editor_type: Option<String>,
    file_path: Option<String>,
}

pub async fn open_task_attempt_in_editor(
    Extension(task_attempt): Extension<TaskAttempt>,
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<Option<OpenEditorRequest>>,
) -> Result<ResponseJson<ApiResponse<()>>, ApiError> {
    // Get the task attempt to access the worktree path
    let attempt = &task_attempt;
    let base_path = attempt.container_ref.as_ref().ok_or_else(|| {
        tracing::error!(
            "No container ref found for task attempt {}",
            task_attempt.id
        );
        ApiError::TaskAttempt(TaskAttemptError::ValidationError(
            "No container ref found".to_string(),
        ))
    })?;

    // If a specific file path is provided, use it; otherwise use the base path
    let path = if let Some(file_path) = payload.as_ref().and_then(|req| req.file_path.as_ref()) {
        std::path::Path::new(base_path).join(file_path)
    } else {
        std::path::PathBuf::from(base_path)
    };

    let editor_config = {
        let config = deployment.config().read().await;
        let editor_type_str = payload.as_ref().and_then(|req| req.editor_type.as_deref());
        config.editor.with_override(editor_type_str)
    };

    match editor_config.open_file(&path.to_string_lossy()) {
        Ok(_) => {
            tracing::info!(
                "Opened editor for task attempt {} at path: {}",
                task_attempt.id,
                path.display()
            );
            Ok(ResponseJson(ApiResponse::success(())))
        }
        Err(e) => {
            tracing::error!(
                "Failed to open editor for attempt {}: {}",
                task_attempt.id,
                e
            );
            Err(ApiError::TaskAttempt(TaskAttemptError::ValidationError(
                format!("Failed to open editor: {}", e),
            )))
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct BranchStatus {
    pub commits_behind: Option<usize>,
    pub commits_ahead: Option<usize>,
    pub has_uncommitted_changes: Option<bool>,
    pub head_oid: Option<String>,
    pub uncommitted_count: Option<usize>,
    pub untracked_count: Option<usize>,
    pub base_branch_name: String,
    pub remote_commits_behind: Option<usize>,
    pub remote_commits_ahead: Option<usize>,
    pub merges: Vec<Merge>,
    /// Base GitHub repo URL like "https://github.com/owner/repo" when detectable
    pub repo_url_base: Option<String>,
}

pub async fn get_task_attempt_branch_status(
    Extension(task_attempt): Extension<TaskAttempt>,
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<BranchStatus>>, ApiError> {
    let pool = &deployment.db().pool;

    let task = task_attempt
        .parent_task(pool)
        .await?
        .ok_or(ApiError::TaskAttempt(TaskAttemptError::TaskNotFound))?;
    let ctx = TaskAttempt::load_context(pool, task_attempt.id, task.id, task.project_id).await?;
    let has_uncommitted_changes = deployment
        .container()
        .is_container_clean(&task_attempt)
        .await
        .ok()
        .map(|is_clean| !is_clean);
    let head_oid = {
        let container_ref = deployment
            .container()
            .ensure_container_exists(&task_attempt)
            .await?;
        let wt = std::path::Path::new(&container_ref);
        deployment.git().get_head_info(wt).ok().map(|h| h.oid)
    };
    let (uncommitted_count, untracked_count) = {
        let container_ref = deployment
            .container()
            .ensure_container_exists(&task_attempt)
            .await?;
        let wt = std::path::Path::new(&container_ref);
        match deployment.git().get_worktree_change_counts(wt) {
            Ok((a, b)) => (Some(a), Some(b)),
            Err(_) => (None, None),
        }
    };

    let task_branch =
        task_attempt
            .branch
            .ok_or(ApiError::TaskAttempt(TaskAttemptError::ValidationError(
                "No branch found for task attempt".to_string(),
            )))?;
    let base_branch_type = deployment
        .git()
        .find_branch_type(&ctx.project.git_repo_path, &task_attempt.base_branch)?;

    let (commits_ahead, commits_behind) = if matches!(base_branch_type, BranchType::Local) {
        let (a, b) = deployment.git().get_branch_status(
            &ctx.project.git_repo_path,
            &task_branch,
            &task_attempt.base_branch,
        )?;
        (Some(a), Some(b))
    } else {
        (None, None)
    };
    // Fetch merges for this task attempt and add to branch status
    let merges = Merge::find_by_task_attempt_id(pool, task_attempt.id).await?;
    let mut branch_status = BranchStatus {
        commits_ahead,
        commits_behind,
        has_uncommitted_changes,
        head_oid,
        uncommitted_count,
        untracked_count,
        remote_commits_ahead: None,
        remote_commits_behind: None,
        merges,
        base_branch_name: task_attempt.base_branch.clone(),
        repo_url_base: None,
    };
    // Try to derive GitHub repo base URL from git remote
    if branch_status.repo_url_base.is_none()
        && let Ok(info) = deployment
            .git()
            .get_github_repo_info(std::path::Path::new(&ctx.project.git_repo_path))
    {
        branch_status.repo_url_base = Some(format!(
            "https://github.com/{}/{}",
            info.owner, info.repo_name
        ));
    }
    let has_open_pr = branch_status.merges.first().is_some_and(|m| {
        matches!(
            m,
            Merge::Pr(PrMerge {
                pr_info: PullRequestInfo {
                    status: MergeStatus::Open,
                    ..
                },
                ..
            })
        )
    });

    // check remote status if the attempt has an open PR or the base_branch is a remote branch
    if has_open_pr || base_branch_type == BranchType::Remote {
        let github_config = deployment.config().read().await.github.clone();
        let token = github_config
            .token()
            .ok_or(ApiError::GitHubService(GitHubServiceError::TokenInvalid))?;

        // For an attempt with a remote base branch, we compare against that
        // After opening a PR, the attempt has a remote branch itself, so we use that
        let remote_base_branch = if base_branch_type == BranchType::Remote && !has_open_pr {
            Some(task_attempt.base_branch)
        } else {
            None
        };
        let (remote_commits_ahead, remote_commits_behind) =
            deployment.git().get_remote_branch_status(
                &ctx.project.git_repo_path,
                &task_branch,
                remote_base_branch.as_deref(),
                token,
            )?;
        branch_status.remote_commits_ahead = Some(remote_commits_ahead);
        branch_status.remote_commits_behind = Some(remote_commits_behind);
    }
    Ok(ResponseJson(ApiResponse::success(branch_status)))
}

#[axum::debug_handler]
pub async fn rebase_task_attempt(
    Extension(task_attempt): Extension<TaskAttempt>,
    State(deployment): State<DeploymentImpl>,
    request_body: Option<Json<RebaseTaskAttemptRequest>>,
) -> Result<ResponseJson<ApiResponse<()>>, ApiError> {
    // Extract new base branch from request body if provided
    let new_base_branch = request_body.and_then(|body| body.new_base_branch.clone());

    let github_config = deployment.config().read().await.github.clone();

    let pool = &deployment.db().pool;

    let task = task_attempt
        .parent_task(pool)
        .await?
        .ok_or(ApiError::TaskAttempt(TaskAttemptError::TaskNotFound))?;
    let ctx = TaskAttempt::load_context(pool, task_attempt.id, task.id, task.project_id).await?;

    // Use the stored base branch if no new base branch is provided
    let effective_base_branch =
        new_base_branch.or_else(|| Some(ctx.task_attempt.base_branch.clone()));

    let container_ref = deployment
        .container()
        .ensure_container_exists(&task_attempt)
        .await?;
    let worktree_path = std::path::Path::new(&container_ref);

    let _new_base_commit = deployment.git().rebase_branch(
        &ctx.project.git_repo_path,
        worktree_path,
        effective_base_branch.clone().as_deref(),
        &ctx.task_attempt.base_branch.clone(),
        github_config.token(),
    )?;

    if let Some(new_base_branch) = &effective_base_branch
        && new_base_branch != &ctx.task_attempt.base_branch
    {
        TaskAttempt::update_base_branch(&deployment.db().pool, task_attempt.id, new_base_branch)
            .await?;
    }

    Ok(ResponseJson(ApiResponse::success(())))
}

/// Update the head branch associated with a task attempt and switch the worktree accordingly.
#[axum::debug_handler]
pub async fn update_task_attempt_branch(
    Extension(task_attempt): Extension<TaskAttempt>,
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<UpdateAttemptBranchRequest>,
) -> Result<ResponseJson<ApiResponse<()>>, ApiError> {
    let new_branch = payload.branch.trim();
    if new_branch.is_empty() {
        return Err(ApiError::TaskAttempt(TaskAttemptError::ValidationError(
            "Branch name cannot be empty".to_string(),
        )));
    }

    // Load context
    let pool = &deployment.db().pool;
    let task = task_attempt
        .parent_task(pool)
        .await?
        .ok_or(ApiError::TaskAttempt(TaskAttemptError::TaskNotFound))?;
    let project = Project::find_by_id(pool, task.project_id)
        .await?
        .ok_or(ApiError::Project(ProjectError::ProjectNotFound))?;

    // Validate branch existence (local only for now)
    if let Err(_e) = deployment
        .git()
        .get_branch_oid(std::path::Path::new(&project.git_repo_path), new_branch)
    {
        return Err(ApiError::TaskAttempt(TaskAttemptError::BranchNotFound(
            new_branch.to_string(),
        )));
    }

    // Ensure we have a worktree path, then switch the worktree to the target branch safely.
    let worktree_path = deployment
        .container()
        .ensure_container_exists(&task_attempt)
        .await?;

    WorktreeManager::ensure_worktree_exists(
        std::path::Path::new(&project.git_repo_path),
        new_branch,
        std::path::Path::new(&worktree_path),
    )
    .await
    .map_err(|e| ApiError::TaskAttempt(TaskAttemptError::ValidationError(e.to_string())))?;

    // Persist new branch on the attempt
    TaskAttempt::update_branch(pool, task_attempt.id, new_branch).await?;

    Ok(ResponseJson(ApiResponse::success(())))
}

#[derive(serde::Deserialize)]
pub struct DeleteFileQuery {
    file_path: String,
}

#[axum::debug_handler]
pub async fn delete_task_attempt_file(
    Extension(task_attempt): Extension<TaskAttempt>,
    Query(query): Query<DeleteFileQuery>,
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<()>>, ApiError> {
    let container_ref = deployment
        .container()
        .ensure_container_exists(&task_attempt)
        .await?;
    let worktree_path = std::path::Path::new(&container_ref);

    // Use GitService to delete file and commit
    let _commit_id = deployment
        .git()
        .delete_file_and_commit(worktree_path, &query.file_path)
        .map_err(|e| {
            tracing::error!(
                "Failed to delete file '{}' from task attempt {}: {}",
                query.file_path,
                task_attempt.id,
                e
            );
            ApiError::GitService(e)
        })?;

    Ok(ResponseJson(ApiResponse::success(())))
}

#[axum::debug_handler]
pub async fn start_dev_server(
    Extension(task_attempt): Extension<TaskAttempt>,
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<()>>, ApiError> {
    // Get parent task
    let task = task_attempt
        .parent_task(&deployment.db().pool)
        .await?
        .ok_or(SqlxError::RowNotFound)?;

    // Get parent project
    let project = task
        .parent_project(&deployment.db().pool)
        .await?
        .ok_or(SqlxError::RowNotFound)?;

    // Allow multiple dev servers (one per workspace). Do not stop existing.

    if let Some(dev_server) = project.dev_script {
        // If workspace_dirs configured, start a dev server in each dir concurrently
        if let Some(ws_csv) = project.workspace_dirs.as_ref()
            && !ws_csv.trim().is_empty()
        {
            let dirs: Vec<&str> = ws_csv
                .split(',')
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
                .collect();

            for d in dirs {
                let script = format!("cd \"{}\" && {{ {} ; }}", d, dev_server);
                let executor_action = ExecutorAction::new(
                    ExecutorActionType::ScriptRequest(ScriptRequest {
                        script,
                        language: ScriptRequestLanguage::Bash,
                        context: ScriptContext::DevServer,
                    }),
                    None,
                );

                deployment
                    .container()
                    .start_execution(
                        &task_attempt,
                        &executor_action,
                        &ExecutionProcessRunReason::DevServer,
                    )
                    .await?;
            }
        } else {
            // Single dev server in repo root
            let executor_action = ExecutorAction::new(
                ExecutorActionType::ScriptRequest(ScriptRequest {
                    script: dev_server,
                    language: ScriptRequestLanguage::Bash,
                    context: ScriptContext::DevServer,
                }),
                None,
            );

            deployment
                .container()
                .start_execution(
                    &task_attempt,
                    &executor_action,
                    &ExecutionProcessRunReason::DevServer,
                )
                .await?;
        }
    } else {
        return Ok(ResponseJson(ApiResponse::error(
            "No dev server script configured for this project",
        )));
    };

    Ok(ResponseJson(ApiResponse::success(())))
}

pub async fn get_task_attempt_children(
    Extension(task_attempt): Extension<TaskAttempt>,
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<Vec<Task>>>, StatusCode> {
    match Task::find_related_tasks_by_attempt_id(&deployment.db().pool, task_attempt.id).await {
        Ok(related_tasks) => Ok(ResponseJson(ApiResponse::success(related_tasks))),
        Err(e) => {
            tracing::error!(
                "Failed to fetch children for task attempt {}: {}",
                task_attempt.id,
                e
            );
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

pub async fn stop_task_attempt_execution(
    Extension(task_attempt): Extension<TaskAttempt>,
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<()>>, ApiError> {
    deployment.container().try_stop(&task_attempt).await;
    Ok(ResponseJson(ApiResponse::success(())))
}

/// Delete a task attempt.
/// - Stops any running processes (best-effort)
/// - Cleans up the worktree
/// - Refuses deletion if the attempt has child tasks or associated merges/PRs
#[axum::debug_handler]
pub async fn delete_task_attempt(
    Extension(task_attempt): Extension<TaskAttempt>,
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<()>>, ApiError> {
    let pool = &deployment.db().pool;

    // Disallow deletion if this attempt has child tasks pointing to it
    let children_count = sqlx::query_scalar!(
        r#"SELECT COUNT(1) as "count!: i64" FROM tasks WHERE parent_task_attempt = $1"#,
        task_attempt.id
    )
    .fetch_one(pool)
    .await?;
    if children_count > 0 {
        return Ok(ResponseJson(ApiResponse::error(
            "Cannot delete this attempt because some tasks reference it as parent.",
        )));
    }

    // Disallow deletion if merges/PRs exist for this attempt
    let merges = Merge::find_by_task_attempt_id(pool, task_attempt.id).await?;
    if !merges.is_empty() {
        return Ok(ResponseJson(ApiResponse::error(
            "Cannot delete an attempt that has merges or a pull request.",
        )));
    }

    // Stop any running processes and cleanup worktree (best-effort)
    let _ = deployment.container().delete(&task_attempt).await;

    // Delete the attempt row (cascades will remove executions, logs, merges)
    sqlx::query!("DELETE FROM task_attempts WHERE id = $1", task_attempt.id)
        .execute(pool)
        .await?;

    deployment
        .track_if_analytics_allowed(
            "task_attempt_deleted",
            serde_json::json!({
                "attempt_id": task_attempt.id.to_string(),
                "task_id": task_attempt.task_id.to_string(),
            }),
        )
        .await;

    Ok(ResponseJson(ApiResponse::success(())))
}

pub fn router(deployment: &DeploymentImpl) -> Router<DeploymentImpl> {
    let task_attempt_id_router = Router::new()
        .route("/", get(get_task_attempt).delete(delete_task_attempt))
        .route("/branch", post(update_task_attempt_branch))
        .route("/follow-up", post(follow_up))
        .route("/plan-to-issue", post(export_plan_to_issue))
        .route("/restore", post(restore_task_attempt))
        .route("/commit-info", get(get_commit_info))
        .route("/commit-compare", get(compare_commit_to_head))
        .route("/start-dev-server", post(start_dev_server))
        .route("/branch-status", get(get_task_attempt_branch_status))
        .route("/diff", get(get_task_attempt_diff))
        .route("/merge", post(merge_task_attempt))
        .route("/push", post(push_task_attempt_branch))
        .route("/rebase", post(rebase_task_attempt))
        .route("/pr/open-existing", post(open_existing_github_pr))
        .route("/pr", post(create_github_pr))
        .route("/open-editor", post(open_task_attempt_in_editor))
        .route("/delete-file", post(delete_task_attempt_file))
        .route("/children", get(get_task_attempt_children))
        .route("/stop", post(stop_task_attempt_execution))
        .layer(from_fn_with_state(
            deployment.clone(),
            load_task_attempt_middleware,
        ));

    let task_attempts_router = Router::new()
        .route("/", get(get_task_attempts).post(create_task_attempt))
        .nest("/{id}", task_attempt_id_router);

    Router::new().nest("/task-attempts", task_attempts_router)
}
