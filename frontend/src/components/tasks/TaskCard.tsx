import { KeyboardEvent, useCallback, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { KanbanCard } from '@/components/ui/shadcn-io/kanban';
import {
  CheckCircle,
  Copy,
  Edit,
  Loader2,
  MoreHorizontal,
  Trash2,
  XCircle,
} from 'lucide-react';
import { FolderOpen } from 'lucide-react';
import type { TaskWithAttemptStatus } from 'shared/types';
import type { TaskPrStatus } from '@/lib/api';
import { GitPullRequest } from 'lucide-react';
import { projectsApi } from '@/lib/api';

type Task = TaskWithAttemptStatus;

interface TaskCardProps {
  task: Task;
  index: number;
  status: string;
  onEdit: (task: Task) => void;
  onDelete: (taskId: string) => void;
  onDuplicate?: (task: Task) => void;
  onViewDetails: (task: Task) => void;
  isFocused: boolean;
  tabIndex?: number;
  prStatus?: TaskPrStatus;
}

export function TaskCard({
  task,
  index,
  status,
  onEdit,
  onDelete,
  onDuplicate,
  onViewDetails,
  isFocused,
  tabIndex = -1,
  prStatus,
}: TaskCardProps) {
  const localRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (isFocused && localRef.current) {
      localRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      localRef.current.focus();
    }
  }, [isFocused]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Backspace') {
        onDelete(task.id);
      } else if (e.key === 'Enter' || e.key === ' ') {
        onViewDetails(task);
      }
    },
    [task, onDelete, onViewDetails]
  );

  const handleClick = useCallback(() => {
    onViewDetails(task);
  }, [task, onViewDetails]);

  return (
    <KanbanCard
      key={task.id}
      id={task.id}
      name={task.title}
      index={index}
      parent={status}
      onClick={handleClick}
      tabIndex={tabIndex}
      forwardedRef={localRef}
      onKeyDown={handleKeyDown}
    >
      {/* Absolute action menu (…): fixed at top-right regardless of height */}
      <div
        className="absolute top-2 right-2"
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 hover:bg-muted rounded-full"
              aria-label="Open task actions menu"
            >
              <MoreHorizontal className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={async () => {
                try {
                  await projectsApi.openEditor(task.project_id);
                } catch (err) {
                  console.error('Failed to open project folder in IDE:', err);
                }
              }}
            >
              <FolderOpen className="h-4 w-4 mr-2" />
              Open Folder
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onEdit(task)}>
              <Edit className="h-4 w-4 mr-2" />
              Edit
            </DropdownMenuItem>
            {onDuplicate && (
              <DropdownMenuItem onClick={() => onDuplicate(task)}>
                <Copy className="h-4 w-4 mr-2" />
                Duplicate
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              onClick={() => onDelete(task.id)}
              className="text-destructive"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Status indicators positioned absolute near the menu */}
      <div className="absolute top-[14px] right-8 flex items-center space-x-1">
        {/* In Progress Spinner */}
        {task.has_in_progress_attempt && (
          <Loader2 className="h-3 w-3 animate-spin text-blue-500" />
        )}
        {/* Merged Indicator */}
        {task.has_merged_attempt && (
          <CheckCircle className="h-3 w-3 text-green-500" />
        )}
        {/* Failed Indicator */}
        {task.last_attempt_failed && !task.has_merged_attempt && (
          <XCircle className="h-3 w-3 text-destructive" />
        )}
        {/* Open PR Indicator */}
        {prStatus?.has_open_pr && (
          <button
            className="p-0.5 rounded hover:bg-muted"
            title="Open PR"
            onClick={(e) => {
              e.stopPropagation();
              if (prStatus.open_pr_url) window.open(prStatus.open_pr_url, '_blank');
            }}
          >
            <GitPullRequest className="h-3 w-3 text-blue-600" />
          </button>
        )}
      </div>

      <div className="flex flex-1 gap-2 items-center min-w-0 pr-8">
        <h4 className="flex-1 min-w-0 font-light text-sm">
          {task.title}
        </h4>
      </div>
      {task.description && (
        <p className="flex-1 text-sm text-secondary-foreground break-words">
          {task.description.length > 130
            ? `${task.description.substring(0, 130)}...`
            : task.description}
        </p>
      )}
    </KanbanCard>
  );
}
