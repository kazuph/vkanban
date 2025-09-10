import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Play,
  Square,
  AlertCircle,
  CheckCircle,
  Clock,
  Cog,
  ArrowLeft,
} from 'lucide-react';
import { executionProcessesApi } from '@/lib/api.ts';
// import { ProfileVariantBadge } from '@/components/common/ProfileVariantBadge.tsx';
import { useAttemptExecution } from '@/hooks';
import ProcessLogsViewer from './ProcessLogsViewer';
import type { ExecutionProcessStatus, ExecutionProcess } from 'shared/types';

import { useProcessSelection } from '@/contexts/ProcessSelectionContext';

interface ProcessesTabProps {
  attemptId?: string;
}

function ProcessesTab({ attemptId }: ProcessesTabProps) {
  const { attemptData } = useAttemptExecution(attemptId);
  const { selectedProcessId, setSelectedProcessId } = useProcessSelection();
  const [loadingProcessId, setLoadingProcessId] = useState<string | null>(null);
  const [localProcessDetails, setLocalProcessDetails] = useState<
    Record<string, ExecutionProcess>
  >({});

  const getStatusIcon = (status: ExecutionProcessStatus) => {
    switch (status) {
      case 'running':
        return <Play className="h-4 w-4 text-blue-500" />;
      case 'completed':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'failed':
        return <AlertCircle className="h-4 w-4 text-destructive" />;
      case 'killed':
        return <Square className="h-4 w-4 text-gray-500" />;
      default:
        return <Clock className="h-4 w-4 text-gray-400" />;
    }
  };

  const getStatusColor = (status: ExecutionProcessStatus) => {
    switch (status) {
      case 'running':
        return 'bg-blue-50 border-blue-200 text-blue-800';
      case 'completed':
        return 'bg-green-50 border-green-200 text-green-800';
      case 'failed':
        return 'bg-red-50 border-red-200 text-red-800';
      case 'killed':
        return 'bg-gray-50 border-gray-200 text-gray-800';
      default:
        return 'bg-gray-50 border-gray-200 text-gray-800';
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString();
  };

  // Query details for the selected process when needed
  const detailsQuery = useQuery({
    queryKey: ['processDetails', selectedProcessId ?? 'none'],
    queryFn: ({ signal }) => executionProcessesApi.getDetails(selectedProcessId as string, signal),
    enabled:
      !!selectedProcessId &&
      !attemptData.runningProcessDetails[selectedProcessId] &&
      !localProcessDetails[selectedProcessId],
  });

  // Provide an explicit fetch helper for clarity where referenced below
  const fetchProcessDetails = async (_id: string) => {
    await detailsQuery.refetch();
  };
  useEffect(() => {
    if (detailsQuery.isLoading && selectedProcessId) {
      setLoadingProcessId(selectedProcessId);
    } else {
      setLoadingProcessId(null);
    }
    if (detailsQuery.data && selectedProcessId) {
      setLocalProcessDetails((prev) => ({
        ...prev,
        [selectedProcessId]: detailsQuery.data as ExecutionProcess,
      }));
    }
  }, [detailsQuery.isLoading, detailsQuery.data, selectedProcessId]);

  // Automatically fetch process details when selectedProcessId changes
  useEffect(() => {
    if (
      selectedProcessId &&
      !attemptData.runningProcessDetails[selectedProcessId] &&
      !localProcessDetails[selectedProcessId]
    ) {
      fetchProcessDetails(selectedProcessId);
    }
  }, [
    selectedProcessId,
    attemptData.runningProcessDetails,
    localProcessDetails,
  ]);

  const handleProcessClick = async (process: ExecutionProcess) => {
    setSelectedProcessId(process.id);
    // Details fetch is handled by detailsQuery via selectedProcessId
  };

  const selectedProcess = selectedProcessId
    ? attemptData.runningProcessDetails[selectedProcessId] ||
      localProcessDetails[selectedProcessId]
    : null;

  if (!attemptData.processes || attemptData.processes.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <div className="text-center">
          <Cog className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>No execution processes found for this attempt.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {!selectedProcessId ? (
        <div className="flex-1 overflow-auto px-4 pb-20 pt-4">
          <div className="space-y-3">
            {attemptData.processes.map((process) => (
              <div
                key={process.id}
                className={`border rounded-lg p-4 hover:bg-muted/30 cursor-pointer transition-colors ${
                  loadingProcessId === process.id
                    ? 'opacity-50 cursor-wait'
                    : ''
                }`}
                onClick={() => handleProcessClick(process)}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center space-x-3">
                    {getStatusIcon(process.status)}
                    <div>
                      <h3 className="font-medium text-sm">
                        {process.run_reason}
                      </h3>
                      <p className="text-sm text-muted-foreground mt-1">
                        Process ID: {process.id}
                      </p>
                      {process.dropped && (
                        <span
                          className="inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200"
                          title="Deleted by restore: timeline was restored to a checkpoint and later executions were removed"
                        >
                          Deleted
                        </span>
                      )}
                      {(() => {
                        const t = process.executor_action.typ as any;
                        if (
                          t?.type === 'CodingAgentInitialRequest' ||
                          t?.type === 'CodingAgentFollowUpRequest'
                        ) {
                          const exec = t.executor_profile_id?.executor as
                            | string
                            | undefined;
                          const variant = t.executor_profile_id?.variant as
                            | string
                            | null
                            | undefined;

                          // Derive settings label
                          let setting: string | null = null;
                          if (exec === 'CODEX') {
                            const m = (t.codex_model_override || '') as string;
                            // Map well-known models → levels; otherwise show raw
                            setting = m
                              ? m === 'gpt-5'
                                ? 'high'
                                : m === 'codex-mini-latest'
                                  ? 'medium'
                                  : m === 'o4-mini'
                                    ? 'low'
                                    : m
                              : 'default';
                          } else if (exec === 'CLAUDE_CODE') {
                            const m = (t.claude_model_override || '') as string;
                            setting = m ? m : 'default';
                          }

                          const execName = exec === 'CLAUDE_CODE' ? 'Claude Code' : exec || 'AGENT';
                          const label = `${execName}(${setting || 'default'})`;

                          return (
                            <p className="text-sm text-muted-foreground mt-1">
                              Agent: {label}
                              {variant ? (
                                <span className="ml-1 text-xs">[{variant}]</span>
                              ) : null}
                            </p>
                          );
                        }
                        return null;
                      })()}
                    </div>
                  </div>
                  <div className="text-right">
                    <span
                      className={`inline-block px-2 py-1 text-xs font-medium border rounded-full ${getStatusColor(
                        process.status
                      )}`}
                    >
                      {process.status}
                    </span>
                    {process.exit_code !== null && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Exit: {process.exit_code.toString()}
                      </p>
                    )}
                  </div>
                </div>
                <div className="mt-3 text-xs text-muted-foreground">
                  <div className="flex justify-between">
                    <span>Started: {formatDate(process.started_at)}</span>
                    {process.completed_at && (
                      <span>Completed: {formatDate(process.completed_at)}</span>
                    )}
                  </div>
                  <div className="mt-1">Process ID: {process.id}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex items-center justify-between px-4 py-2 border-b flex-shrink-0">
            <h2 className="text-lg font-semibold">Process Details</h2>
            <button
              onClick={() => setSelectedProcessId(null)}
              className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-md border border-border transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to list
            </button>
          </div>
          <div className="flex-1">
            {selectedProcess ? (
              <ProcessLogsViewer processId={selectedProcess.id} attemptId={attemptId} />
            ) : loadingProcessId === selectedProcessId ? (
              <div className="text-center text-muted-foreground">
                <p>Loading process details...</p>
              </div>
            ) : (
              <div className="text-center text-muted-foreground">
                <p>Failed to load process details. Please try again.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default ProcessesTab;
