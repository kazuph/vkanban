import { KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { projectsApi } from '@/lib/api';
// (Tooltip removed for PR status; using bottom bar design instead)

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
  const [, forceTick] = useState(0);

  // Re-render periodically so the relative time stays fresh
  useEffect(() => {
    const id = setInterval(() => forceTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const formatTimeAgo = useCallback((date: Date) => {
    const locale = typeof navigator !== 'undefined' ? navigator.language : 'ja-JP';
    const diffSec = Math.round((Date.now() - date.getTime()) / 1000);
    if (diffSec < 45) {
      return locale.startsWith('ja') ? '今' : 'now';
    }
    const units: Array<{
      unit: Intl.RelativeTimeFormatUnit;
      secs: number;
    }> = [
      { unit: 'minute', secs: 60 },
      { unit: 'hour', secs: 3600 },
      { unit: 'day', secs: 86400 },
      { unit: 'week', secs: 604800 },
      { unit: 'month', secs: 2629800 }, // ~30.44 days
      { unit: 'year', secs: 31557600 }, // ~365.25 days
    ];
    let value = diffSec;
    let unit: Intl.RelativeTimeFormatUnit = 'minute';
    for (const u of units) {
      if (diffSec < u.secs) break;
      unit = u.unit;
      value = Math.round(diffSec / u.secs);
    }
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    return rtf.format(-value, unit);
  }, []);

  const formatTooltip = useCallback((date: Date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    return `${y}年${m}月${d}日 ${hh}:${mm}`;
  }, []);
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

  // Derive GitHub repo base URL from any known PR URL
  const repoUrlBase = useMemo(() => {
    const url = prStatus?.open_pr_url || prStatus?.latest_pr_url || null;
    if (!url) return undefined;
    try {
      const u = new URL(url);
      const parts = u.pathname.split('/').filter(Boolean);
      if (parts.length >= 2) return `${u.origin}/${parts[0]}/${parts[1]}`;
    } catch {}
    return undefined;
  }, [prStatus?.open_pr_url, prStatus?.latest_pr_url]);

  const encodeBranchForPath = (name: string) =>
    name
      .split('/')
      .map((seg) => encodeURIComponent(seg))
      .join('/');

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

      {/* Bottom footer: Branch (left) + PR status (left) + last updated (right) */}
      {(() => {
        const pillBase =
          'inline-flex max-w-full min-w-0 items-center px-2.5 py-0.5 rounded-full text-[11px] font-mono lowercase tracking-tight border';
        let prNode: React.ReactNode = null;
        let branchNode: React.ReactNode = null;

        const branchName = prStatus?.branch || null;
        if (branchName) {
          const cls = `${pillBase} bg-muted text-foreground border-[hsl(var(--border))] hover:bg-muted/80`;
          const content = (
            <span className="truncate max-w-[12rem]" title={branchName}>
              {branchName}
            </span>
          );
          if (repoUrlBase) {
            branchNode = (
              <button
                className={cls}
                onClick={(e) => {
                  e.stopPropagation();
                  const href = `${repoUrlBase}/tree/${encodeBranchForPath(branchName)}`;
                  window.open(href, '_blank');
                }}
                aria-label={`Open branch ${branchName} on GitHub`}
                title={`Open ${branchName} on GitHub`}
              >
                {content}
              </button>
            );
          } else {
            branchNode = <span className={cls}>{content}</span>;
          }
        }

        if (prStatus) {
          // open > merged > closed; else hide (no badge)
          if (prStatus.has_open_pr && prStatus.open_pr_url) {
            const cls = `${pillBase} bg-[hsl(var(--info)/0.15)] text-[hsl(var(--info))] border-[hsl(var(--info)/0.35)] hover:bg-[hsl(var(--info)/0.25)]`;
            prNode = (
              <button
                className={cls}
                onClick={(e) => {
                  e.stopPropagation();
                  window.open(prStatus.open_pr_url!, '_blank');
                }}
                aria-label="Open PR"
              >
                pr open
              </button>
            );
          } else if (
            prStatus.latest_pr_status === 'merged' &&
            prStatus.latest_pr_url
          ) {
            const cls = `${pillBase} bg-[hsl(var(--success)/0.15)] text-[hsl(var(--success))] border-[hsl(var(--success)/0.35)] hover:bg-[hsl(var(--success)/0.25)]`;
            prNode = (
              <button
                className={cls}
                onClick={(e) => {
                  e.stopPropagation();
                  window.open(prStatus.latest_pr_url!, '_blank');
                }}
                aria-label="Open merged PR"
              >
                pr merged
              </button>
            );
          } else if (
            prStatus.latest_pr_status === 'closed' &&
            prStatus.latest_pr_url
          ) {
            const cls = `${pillBase} bg-[hsl(var(--destructive)/0.15)] text-[hsl(var(--destructive))] border-[hsl(var(--destructive)/0.35)] hover:bg-[hsl(var(--destructive)/0.25)]`;
            prNode = (
              <button
                className={cls}
                onClick={(e) => {
                  e.stopPropagation();
                  window.open(prStatus.latest_pr_url!, '_blank');
                }}
                aria-label="Open closed PR"
              >
                pr closed
              </button>
            );
          }
        }

        const updated = new Date(task.updated_at);
        const updatedText = formatTimeAgo(updated);
        const tooltip = formatTooltip(updated);

        const hasFooterPills = branchNode || prNode;

        return (
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
            {hasFooterPills && (
              <div className="flex flex-wrap items-center gap-2 min-w-0 flex-1">
                {branchNode}
                {prNode}
              </div>
            )}
            <div
              className="ml-auto text-[11px] text-muted-foreground"
              title={tooltip}
            >
              {updatedText}
            </div>
          </div>
        );
      })()}
    </KanbanCard>
  );
}
