import { Card } from '../ui/card';
import { Button } from '../ui/button';
import type { TaskAttempt, TaskWithAttemptStatus } from 'shared/types';
import { useDiffSummary } from '@/hooks/useDiffSummary';
import { useAttemptExecution } from '@/hooks/useAttemptExecution';

interface AttemptHeaderCardProps {
  attemptNumber: number;
  totalAttempts: number;
  selectedAttempt: TaskAttempt | null;
  task?: TaskWithAttemptStatus; // unused (actions moved)
  projectId?: string; // unused (actions moved)
  // onCreateNewAttempt?: () => void;
  onJumpToDiffFullScreen?: () => void;
}

export function AttemptHeaderCard({
  attemptNumber,
  totalAttempts,
  selectedAttempt,
  // onCreateNewAttempt,
  onJumpToDiffFullScreen,
}: AttemptHeaderCardProps) {
  const { fileCount, added, deleted } = useDiffSummary(
    selectedAttempt?.id ?? null
  );
  const { attemptData } = useAttemptExecution(selectedAttempt?.id ?? undefined);

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

  return (
    <Card className="border-b border-dashed bg-background flex items-center text-sm">
      <div className="flex-1 flex gap-6 p-3">
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
      {/* Actions moved to Task header; menu removed intentionally */}
    </Card>
  );
}
