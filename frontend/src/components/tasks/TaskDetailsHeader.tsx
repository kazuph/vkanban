import { memo, useCallback } from 'react';
import {
  Edit,
  Trash2,
  X,
  Maximize2,
  Minimize2,
  Code2,
  Play,
  StopCircle,
  RefreshCw,
  GitPullRequest,
  GitBranch as GitBranchIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { TaskAttempt, TaskWithAttemptStatus } from 'shared/types';
import { TaskTitleDescription } from './TaskDetails/TaskTitleDescription';
import { Card } from '../ui/card';
import { statusBoardColors, statusLabels } from '@/utils/status-labels';
import { useOpenInEditor } from '@/hooks/useOpenInEditor';
import { useDevServer } from '@/hooks/useDevServer';
import { useRebase } from '@/hooks/useRebase';
import { useMerge } from '@/hooks/useMerge';
import NiceModal from '@ebay/nice-modal-react';

interface TaskDetailsHeaderProps {
  task: TaskWithAttemptStatus;
  onClose: () => void;
  onEditTask?: (task: TaskWithAttemptStatus) => void;
  onDeleteTask?: (taskId: string) => void;
  hideCloseButton?: boolean;
  isFullScreen?: boolean;
  setFullScreen?: (isFullScreen: boolean) => void;
  // New: Attempt-scoped actions
  selectedAttempt?: TaskAttempt | null;
  projectId?: string;
}

// backgroundColor: `hsl(var(${statusBoardColors[task.status]}) / 0.03)`,

function TaskDetailsHeader({
  task,
  onClose,
  onEditTask,
  onDeleteTask,
  hideCloseButton = false,
  isFullScreen,
  setFullScreen,
  selectedAttempt,
  projectId,
}: TaskDetailsHeaderProps) {
  // Attempt-scoped hooks/actions (safe no-ops when no attempt)
  const openInEditor = useOpenInEditor(selectedAttempt ?? null);
  const { start, stop, runningDevServer, isStarting } = useDevServer(
    selectedAttempt?.id
  );
  const rebaseMutation = useRebase(selectedAttempt?.id, projectId);
  const mergeMutation = useMerge(selectedAttempt?.id);

  const handleCreatePR = useCallback(() => {
    if (!selectedAttempt || !projectId) return;
    NiceModal.show('create-pr', {
      attempt: selectedAttempt,
      task,
      projectId,
    });
  }, [selectedAttempt, projectId, task]);

  return (
    <div>
      <Card
        className="flex shrink-0 items-center gap-2 border-b border-dashed bg-background"
        style={{}}
      >
        <div className="p-3 flex flex-1 items-center truncate">
          <div
            className="h-2 w-2 rounded-full inline-block"
            style={{
              backgroundColor: `hsl(var(${statusBoardColors[task.status]}))`,
            }}
          />
          <p className="ml-2 text-sm">{statusLabels[task.status]}</p>
        </div>
        <div className="mr-3">
          {setFullScreen && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setFullScreen(!isFullScreen)}
                    aria-label={
                      isFullScreen
                        ? 'Collapse to sidebar'
                        : 'Expand to fullscreen'
                    }
                  >
                    {isFullScreen ? (
                      <Minimize2 className="h-4 w-4" />
                    ) : (
                      <Maximize2 className="h-4 w-4" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>
                    {isFullScreen
                      ? 'Collapse to sidebar'
                      : 'Expand to fullscreen'}
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          {/* Attempt actions moved from Attempt menu */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => openInEditor()}
                  disabled={!selectedAttempt}
                  aria-label="Open in IDE"
                >
                  <Code2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Open in IDE</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => (runningDevServer ? stop() : start())}
                  disabled={!selectedAttempt || isStarting}
                  aria-label={runningDevServer ? 'Stop dev server' : 'Start dev server'}
                >
                  {runningDevServer ? (
                    <StopCircle className="h-4 w-4 text-destructive" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{runningDevServer ? 'Stop dev server' : 'Start dev server'}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => rebaseMutation.mutate(undefined)}
                  disabled={!selectedAttempt || rebaseMutation.isPending}
                  aria-label={rebaseMutation.isPending ? 'Rebasing...' : 'Rebase'}
                >
                  <RefreshCw
                    className={`h-4 w-4 ${rebaseMutation.isPending ? 'animate-spin' : ''}`}
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{rebaseMutation.isPending ? 'Rebasing…' : 'Rebase'}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleCreatePR}
                  disabled={!selectedAttempt}
                  aria-label="Create PR"
                >
                  <GitPullRequest className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Create PR</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => mergeMutation.mutate()}
                  disabled={!selectedAttempt || mergeMutation.isPending}
                  aria-label={mergeMutation.isPending ? 'Merging...' : 'Merge'}
                >
                  <GitBranchIcon className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{mergeMutation.isPending ? 'Merging…' : 'Merge'}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {onEditTask && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onEditTask(task)}
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Edit task</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {onDeleteTask && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onDeleteTask(task.id)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Delete task</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {!hideCloseButton && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" onClick={onClose}>
                    <X className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Close panel</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      </Card>

      {/* Title and Task Actions */}
      {!isFullScreen && (
        <div className="p-3 border-b border-dashed max-h-96 overflow-y-auto">
          <TaskTitleDescription task={task} />
        </div>
      )}
    </div>
  );
}

export default memo(TaskDetailsHeader);
