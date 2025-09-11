import { Card } from '../ui/card';
import { Button } from '../ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.tsx';
import { History, Trash2 } from 'lucide-react';
import type { TaskAttempt, TaskWithAttemptStatus } from 'shared/types';
import { useDiffSummary } from '@/hooks/useDiffSummary';
import { useAttemptExecution } from '@/hooks/useAttemptExecution';
import { attemptsApi } from '@/lib/api';
import { useQueryClient } from '@tanstack/react-query';
import { showModal } from '@/lib/modals';

interface AttemptHeaderCardProps {
  attemptNumber: number;
  totalAttempts: number;
  selectedAttempt: TaskAttempt | null;
  attempts?: TaskAttempt[];
  setSelectedAttempt?: (attempt: TaskAttempt | null) => void;
  task?: TaskWithAttemptStatus; // unused (actions moved)
  projectId?: string; // unused (actions moved)
  // onCreateNewAttempt?: () => void;
  onJumpToDiffFullScreen?: () => void;
  onCreateNewAttempt?: () => void;
}

export function AttemptHeaderCard({
  attemptNumber,
  totalAttempts,
  selectedAttempt,
  attempts = [],
  setSelectedAttempt,
  // onCreateNewAttempt,
  onJumpToDiffFullScreen,
  onCreateNewAttempt,
  task,
}: AttemptHeaderCardProps) {
  const { fileCount, added, deleted } = useDiffSummary(
    selectedAttempt?.id ?? null
  );
  const { attemptData } = useAttemptExecution(selectedAttempt?.id ?? undefined);
  const queryClient = useQueryClient();

  const agentLabel = (() => {
    const fallback = selectedAttempt?.executor || '';
    const procs = attemptData.processes || [];
    // Find latest coding-agent process
    const cg = [...procs]
      .reverse()
      .find((p) => p.run_reason === 'codingagent' && !p.dropped);
    if (!cg) return fallback;
    const t: any = cg.executor_action?.typ || {};
    const exec: string = t?.executor_profile_id?.executor || fallback;
    let setting: string | null = null;
    if (exec === 'CODEX') {
      const m = (t.codex_model_override || '') as string;
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
    const execName = exec === 'CLAUDE_CODE' ? 'Claude Code' : exec;
    return setting ? `${execName}(${setting})` : execName;
  })();

  const handleDeleteAttempt = async () => {
    if (!selectedAttempt?.id || !task) return;
    try {
      const result = await showModal<'confirmed' | 'canceled'>(
        'confirm',
        {
          title: 'Delete this attempt?',
          message:
            'This will stop any running processes, remove its workspace, and delete its history. This action cannot be undone.',
          confirmText: 'Delete',
          cancelText: 'Cancel',
          variant: 'destructive',
        }
      );
      if (result !== 'confirmed') return;

      const deletingId = selectedAttempt.id;
      const fallback = attempts.find((a) => a.id !== deletingId) || null;

      await attemptsApi.delete(deletingId);
      queryClient.invalidateQueries({ queryKey: ['taskAttempts', task.id] });

      if (fallback) {
        setSelectedAttempt?.(fallback);
      } else {
        // No attempts left, let parent decide UI (create attempt mode, etc.)
      }
    } catch (e) {
      // Swallow errors here; TaskDetailsToolbar shows errors where relevant
      console.error('Failed to delete attempt:', e);
    }
  };

  return (
    <Card className="border-b border-dashed bg-background flex items-center text-sm">
      <div className="flex items-center gap-2 p-3 w-full">
        {/* Attempt history (left edge) */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="xs"
              className="h-6 w-6 p-0"
              disabled={attempts.length <= 1}
              title={attempts.length > 1 ? 'Switch attempt' : 'No other attempts'}
            >
              <History className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            {attempts.map((attempt) => (
              <DropdownMenuItem
                key={attempt.id}
                onClick={() => setSelectedAttempt?.(attempt)}
                className={selectedAttempt?.id === attempt.id ? 'bg-accent' : ''}
              >
                <div className="flex flex-col w-full">
                  <span className="font-medium text-sm">
                    {new Date(attempt.created_at).toLocaleDateString()}{' '}
                    {new Date(attempt.created_at).toLocaleTimeString()}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {attempt.executor || 'Base Agent'}
                  </span>
                </div>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Attempt summary */}
        <div className="flex-1 flex gap-6">
          <p>
            <span className="text-secondary-foreground">Attempt &middot; </span>
            {attemptNumber}/{totalAttempts}
          </p>
          <p>
            <span className="text-secondary-foreground">Agent &middot; </span>
            {agentLabel}
          </p>
          {selectedAttempt?.branch && (
            <p className="max-w-30">
              <span className="text-secondary-foreground">Branch &middot; </span>
              {selectedAttempt.branch}
            </p>
          )}
          {fileCount > 0 && (
            <p className="text-secondary-foreground">
              <Button
                variant="ghost"
                size="sm"
                className="h-4 p-0"
                onClick={onJumpToDiffFullScreen}
              >
                Diffs
              </Button>{' '}
              &middot; <span className="text-success">+{added}</span>{' '}
              <span className="text-destructive">-{deleted}</span>
            </p>
          )}
        </div>
      
        <div className="pr-3 flex items-center gap-2">
          {selectedAttempt && (
            <Button
              variant="destructive"
              size="xs"
              onClick={handleDeleteAttempt}
              className="gap-1"
              title="Delete current attempt"
            >
              <Trash2 className="h-3 w-3" />
              Delete
            </Button>
          )}
          {onCreateNewAttempt && (
            <Button
              variant="outline"
              size="xs"
              onClick={onCreateNewAttempt}
              className="gap-1"
            >
              New Attempt
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
