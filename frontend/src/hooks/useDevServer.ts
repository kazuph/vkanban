import { useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { attemptsApi, executionProcessesApi } from '@/lib/api';
import { useAttemptExecution } from '@/hooks/useAttemptExecution';
import type { ExecutionProcess } from 'shared/types';

interface UseDevServerOptions {
  onStartSuccess?: () => void;
  onStartError?: (err: unknown) => void;
  onStopSuccess?: () => void;
  onStopError?: (err: unknown) => void;
}

export function useDevServer(
  attemptId: string | undefined,
  options?: UseDevServerOptions
) {
  const queryClient = useQueryClient();
  const { attemptData } = useAttemptExecution(attemptId);

  // Find running dev server processes (multiple workspaces)
  const runningDevServers = useMemo<ExecutionProcess[]>(() => {
    return attemptData.processes.filter(
      (process) =>
        process.run_reason === 'devserver' && process.status === 'running'
    );
  }, [attemptData.processes]);
  // Backward-compat: first running dev server (if any)
  const runningDevServer = runningDevServers[0];

  // Find latest dev server process (for logs viewing)
  const latestDevServerProcess = useMemo<ExecutionProcess | undefined>(() => {
    return [...attemptData.processes]
      .filter((process) => process.run_reason === 'devserver')
      .sort(
        (a, b) =>
          new Date(b.started_at).getTime() - new Date(a.started_at).getTime()
      )[0];
  }, [attemptData.processes]);

  // Start mutation
  const startMutation = useMutation({
    mutationKey: ['startDevServer', attemptId],
    mutationFn: async () => {
      if (!attemptId) return;
      await attemptsApi.startDevServer(attemptId);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['executionProcesses', attemptId],
      });
      options?.onStartSuccess?.();
    },
    onError: (err) => {
      console.error('Failed to start dev server:', err);
      options?.onStartError?.(err);
    },
  });

  // Stop mutation
  const stopMutation = useMutation({
    mutationKey: ['stopDevServer', runningDevServers.map((p) => p.id).join(',')],
    mutationFn: async () => {
      if (!runningDevServers.length) return;
      // Stop all running dev servers for this attempt
      for (const p of runningDevServers) {
        try {
          await executionProcessesApi.stopExecutionProcess(p.id);
        } catch (e) {
          console.error('Failed to stop dev server process', p.id, e);
        }
      }
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['executionProcesses', attemptId],
        }),
        runningDevServer
          ? queryClient.invalidateQueries({
              queryKey: ['processDetails', runningDevServer.id],
            })
          : Promise.resolve(),
      ]);
      options?.onStopSuccess?.();
    },
    onError: (err) => {
      console.error('Failed to stop dev server:', err);
      options?.onStopError?.(err);
    },
  });

  return {
    start: startMutation.mutate,
    stop: stopMutation.mutate,
    isStarting: startMutation.isPending,
    isStopping: stopMutation.isPending,
    runningDevServer,
    runningDevServers,
    latestDevServerProcess,
  };
}
