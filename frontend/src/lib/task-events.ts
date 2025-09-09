import type { Task, TaskWithAttemptStatus } from 'shared/types';

// Simple global CustomEvent helpers to broadcast task changes
// Namespaced to avoid collisions
export const TASK_CREATED_EVENT = 'vk:task-created';
export const TASK_UPDATED_EVENT = 'vk:task-updated';
export const TASK_DELETED_EVENT = 'vk:task-deleted';

// Normalize Task into TaskWithAttemptStatus with safe defaults
function normalizeTask(task: Task | TaskWithAttemptStatus): TaskWithAttemptStatus {
  const base = task as TaskWithAttemptStatus;
  return {
    id: base.id,
    project_id: base.project_id,
    title: base.title,
    description: base.description ?? null,
    status: base.status,
    parent_task_attempt: base.parent_task_attempt ?? null,
    created_at: base.created_at as string,
    updated_at: base.updated_at as string,
    has_in_progress_attempt: base.has_in_progress_attempt ?? false,
    has_merged_attempt: base.has_merged_attempt ?? false,
    last_attempt_failed: base.last_attempt_failed ?? false,
    executor: (base as any).executor ?? '',
  };
}

export function emitTaskCreated(task: Task | TaskWithAttemptStatus) {
  const normalized = normalizeTask(task);
  window.dispatchEvent(
    new CustomEvent<TaskWithAttemptStatus>(TASK_CREATED_EVENT, {
      detail: normalized,
    })
  );
}

export function emitTaskUpdated(task: Task | TaskWithAttemptStatus) {
  const normalized = normalizeTask(task);
  window.dispatchEvent(
    new CustomEvent<TaskWithAttemptStatus>(TASK_UPDATED_EVENT, {
      detail: normalized,
    })
  );
}

export function emitTaskDeleted(taskId: string, projectId?: string) {
  window.dispatchEvent(
    new CustomEvent<{ id: string; project_id?: string }>(TASK_DELETED_EVENT, {
      detail: { id: taskId, project_id: projectId },
    })
  );
}

