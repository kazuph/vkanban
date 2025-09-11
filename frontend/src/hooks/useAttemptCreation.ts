import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { attemptsApi } from '@/lib/api';
import type { TaskAttempt } from 'shared/types';
import type { ExecutorProfileId } from 'shared/types';

export function useAttemptCreation(taskId: string) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { projectId } = useParams<{ projectId: string }>();

  const mutation = useMutation({
    mutationFn: ({
      profile,
      baseBranch,
      reuseBranchAttemptId,
    }: {
      profile: ExecutorProfileId;
      baseBranch: string;
      reuseBranchAttemptId?: string | null;
    }) =>
      attemptsApi.create({
        task_id: taskId,
        executor_profile_id: profile,
        base_branch: baseBranch,
        reuse_branch_of_attempt_id: reuseBranchAttemptId ?? null,
      }),
    onSuccess: (newAttempt: TaskAttempt) => {
      // Optimistically add to cache to prevent UI flicker
      queryClient.setQueryData(
        ['taskAttempts', taskId],
        (old: TaskAttempt[] = []) => [newAttempt, ...old]
      );

      // Navigate to new attempt (triggers polling switch)
      if (projectId) {
        navigate(
          `/projects/${projectId}/tasks/${taskId}/attempts/${newAttempt.id}`,
          { replace: true }
        );
      }
    },
  });

  return {
    createAttempt: mutation.mutateAsync,
    isCreating: mutation.isPending,
    error: mutation.error,
  };
}
