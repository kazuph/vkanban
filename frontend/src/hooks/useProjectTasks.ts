import { useCallback, useEffect, useMemo, useState } from 'react';
import { useJsonPatchStream } from './useJsonPatchStream';
import type { TaskWithAttemptStatus } from 'shared/types';
import {
  TASK_CREATED_EVENT,
  TASK_DELETED_EVENT,
} from '@/lib/task-events';

type TasksState = {
  tasks: Record<string, TaskWithAttemptStatus>;
};

interface UseProjectTasksResult {
  tasks: TaskWithAttemptStatus[];
  tasksById: Record<string, TaskWithAttemptStatus>;
  isLoading: boolean;
  isConnected: boolean;
  error: string | null;
}

/**
 * Stream tasks for a project via SSE (JSON Patch) and expose as array + map.
 * Server sends initial snapshot: replace /tasks with an object keyed by id.
 * Live updates arrive at /tasks/<id> via add/replace/remove operations.
 */
export const useProjectTasks = (
  projectId: string | undefined
): UseProjectTasksResult => {
  const endpoint = projectId
    ? `/api/tasks/stream?project_id=${encodeURIComponent(projectId)}`
    : undefined;

  const initialData = useCallback((): TasksState => ({ tasks: {} }), []);

  const { data, isConnected, error } = useJsonPatchStream<TasksState>(
    endpoint,
    !!projectId,
    initialData
  );
  // Local optimistic cache for tasks we just created but haven't received via SSE yet
  const [optimisticTasks, setOptimisticTasks] = useState<
    Record<string, TaskWithAttemptStatus>
  >({});

  // Listen for create/delete events to keep UI in sync immediately
  useEffect(() => {
    const handleCreated = (e: Event) => {
      const ev = e as CustomEvent<TaskWithAttemptStatus>;
      const t = ev.detail;
      if (!t || !projectId || t.project_id !== projectId) return;
      setOptimisticTasks((prev) => ({ ...prev, [t.id]: t }));
    };

    const handleDeleted = (e: Event) => {
      const ev = e as CustomEvent<{ id: string; project_id?: string }>;
      const { id, project_id } = ev.detail || {};
      if (!id) return;
      if (projectId && project_id && project_id !== projectId) return;
      setOptimisticTasks((prev) => {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
    };

    window.addEventListener(TASK_CREATED_EVENT, handleCreated as EventListener);
    window.addEventListener(TASK_DELETED_EVENT, handleDeleted as EventListener);
    return () => {
      window.removeEventListener(
        TASK_CREATED_EVENT,
        handleCreated as EventListener
      );
      window.removeEventListener(
        TASK_DELETED_EVENT,
        handleDeleted as EventListener
      );
    };
  }, [projectId]);

  // When SSE delivers the created task, drop the optimistic copy
  useEffect(() => {
    if (!data?.tasks) return;
    setOptimisticTasks((prev) => {
      const next = { ...prev };
      for (const id of Object.keys(prev)) {
        if (id in (data.tasks as Record<string, TaskWithAttemptStatus>)) {
          delete next[id];
        }
      }
      return next;
    });
  }, [data]);

  const tasksById = useMemo(() => ({
    ...(data?.tasks ?? {}),
    ...optimisticTasks,
  }), [data?.tasks, optimisticTasks]);

  const tasks = useMemo(
    () =>
      Object.values(tasksById).sort(
        (a, b) =>
          new Date(b.created_at as unknown as string).getTime() -
          new Date(a.created_at as unknown as string).getTime()
      ),
    [tasksById]
  );
  const isLoading = !data && !error; // until first snapshot

  return { tasks, tasksById, isLoading, isConnected, error };
};
