import { Card } from '../ui/card';
import { Button } from '../ui/button';
import type { TaskAttempt, TaskWithAttemptStatus } from 'shared/types';
import { useDiffSummary } from '@/hooks/useDiffSummary';

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

  return (
    <Card className="border-b border-dashed bg-background flex items-center text-sm">
      <div className="flex-1 flex gap-6 p-3">
        <p>
          <span className="text-secondary-foreground">Attempt &middot; </span>
          {attemptNumber}/{totalAttempts}
        </p>
        <p>
          <span className="text-secondary-foreground">Agent &middot; </span>
          {selectedAttempt?.executor}
        </p>
        {selectedAttempt?.branch && (
          <p className="max-w-30 truncate">
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
