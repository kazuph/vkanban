import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { MoreHorizontal } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import type { TaskAttempt, TaskWithAttemptStatus } from 'shared/types';
import { useDevServer } from '@/hooks/useDevServer';
import { useRebase } from '@/hooks/useRebase';
import { useMerge } from '@/hooks/useMerge';
import { useOpenInEditor } from '@/hooks/useOpenInEditor';
import { useDiffSummary } from '@/hooks/useDiffSummary';
import { useCreatePRDialog } from '@/contexts/create-pr-dialog-context';
import { useBranchStatus } from '@/hooks';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { useState } from 'react';

interface AttemptHeaderCardProps {
  attemptNumber: number;
  totalAttempts: number;
  selectedAttempt: TaskAttempt | null;
  task: TaskWithAttemptStatus;
  projectId: string;
  // onCreateNewAttempt?: () => void;
  onJumpToDiffFullScreen?: () => void;
}

export function AttemptHeaderCard({
  attemptNumber,
  totalAttempts,
  selectedAttempt,
  task,
  projectId,
  // onCreateNewAttempt,
  onJumpToDiffFullScreen,
}: AttemptHeaderCardProps) {
  const {
    start: startDevServer,
    stop: stopDevServer,
    runningDevServer,
  } = useDevServer(selectedAttempt?.id);
  const rebaseMutation = useRebase(selectedAttempt?.id, projectId);
  const mergeMutation = useMerge(selectedAttempt?.id);
  const openInEditor = useOpenInEditor(selectedAttempt);
  const { fileCount, added, deleted } = useDiffSummary(
    selectedAttempt?.id ?? null
  );
  const { showCreatePRDialog } = useCreatePRDialog();
  const { data: branchStatus } = useBranchStatus(selectedAttempt?.id);

  const [showMergeConfirmation, setShowMergeConfirmation] = useState(false);
  const [merging, setMerging] = useState(false);
  const [showRebaseConfirmation, setShowRebaseConfirmation] = useState(false);
  const [rebasing, setRebasing] = useState(false);

  const handleCreatePR = () => {
    if (selectedAttempt) {
      showCreatePRDialog({
        attempt: selectedAttempt,
        task,
        projectId,
      });
    }
  };
  // If a PR exists (open/merged/closed), prefer showing "Open PR" to view it.
  // Prefer an open PR if available, otherwise fall back to the most recent PR.
  const prMerges = (branchStatus?.merges || []).filter((m) => m.type === 'pr');
  const preferredPR =
    prMerges.find((m) => m.pr_info.status === 'open') ||
    prMerges
      .slice()
      .sort((a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )[0];
  const openPRUrl = preferredPR?.pr_info.url;

  return (
    <Card className="border-b border-dashed bg-background flex items-center text-sm">
      <div className="flex-1 flex gap-6 p-3">
        <p>
          <span className="text-secondary-foreground">Attempt &middot; </span>
          {attemptNumber}/{totalAttempts}
        </p>
        <p>
          <span className="text-secondary-foreground">Profile &middot; </span>
          {selectedAttempt?.profile}
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
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-10 w-10 p-0 mr-3">
            <MoreHorizontal className="h-4 w-4" />
            <span className="sr-only">Open menu</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onClick={() => openInEditor()}
            disabled={!selectedAttempt}
          >
            Open in IDE
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={runningDevServer ? stopDevServer : startDevServer}
            disabled={!selectedAttempt}
            className={runningDevServer ? 'text-destructive' : ''}
          >
            {runningDevServer ? 'Stop dev server' : 'Start dev server'}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => setShowRebaseConfirmation(true)}
            disabled={!selectedAttempt}
          >
            Rebase
          </DropdownMenuItem>
          {openPRUrl ? (
            <DropdownMenuItem
              onClick={() => window.open(openPRUrl, '_blank')}
              disabled={!selectedAttempt}
            >
              Open PR
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              onClick={handleCreatePR}
              disabled={!selectedAttempt}
            >
              Create PR
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onClick={() => setShowMergeConfirmation(true)}
            disabled={!selectedAttempt}
          >
            Merge
          </DropdownMenuItem>
          {/* <DropdownMenuItem
            onClick={onCreateNewAttempt}
            disabled={!onCreateNewAttempt}
          >
            Create new attempt
          </DropdownMenuItem> */}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Merge Confirmation Dialog */}
      <Dialog open={showMergeConfirmation} onOpenChange={setShowMergeConfirmation}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Merge Changes?</DialogTitle>
            <DialogDescription>
              Squash-merge turns all commits from the attempt branch
              {selectedAttempt?.branch ? ` (${selectedAttempt.branch})` : ''}
              {branchStatus?.base_branch_name ? ` into ${branchStatus.base_branch_name}` : ''}
              into a single commit on the base branch to keep history linear.
              No changes are pushed to remote automatically. You can push after
              it succeeds. This action cannot be undone from the app.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowMergeConfirmation(false)}
              disabled={merging}
            >
              Cancel
            </Button>
            <Button
              className="bg-green-600 hover:bg-green-700"
              onClick={async () => {
                try {
                  setMerging(true);
                  setShowMergeConfirmation(false);
                  await mergeMutation.mutateAsync();
                } catch (err) {
                  console.error('Failed to merge:', err);
                } finally {
                  setMerging(false);
                }
              }}
              disabled={merging}
            >
              {merging ? 'Merging...' : 'Merge'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rebase Confirmation Dialog */}
      <Dialog
        open={showRebaseConfirmation}
        onOpenChange={setShowRebaseConfirmation}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rebase Branch?</DialogTitle>
            <DialogDescription>
              Rebase will replay the attempt branch’s commits on top of the
              latest base branch
              {branchStatus?.base_branch_name ? ` (${branchStatus.base_branch_name})` : ''},
              rewriting history (commit SHAs change). You may need to resolve
              conflicts. No changes are pushed to remote automatically; if this
              branch was pushed before, you’ll likely need to push with
              force-with-lease after rebasing. This action cannot be undone from
              the app.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowRebaseConfirmation(false)}
              disabled={rebasing}
            >
              Cancel
            </Button>
            <Button
              onClick={async () => {
                try {
                  setRebasing(true);
                  setShowRebaseConfirmation(false);
                  await rebaseMutation.mutateAsync(undefined);
                } catch (err) {
                  console.error('Failed to rebase:', err);
                } finally {
                  setRebasing(false);
                }
              }}
              disabled={rebasing}
            >
              {rebasing ? 'Rebasing...' : 'Rebase'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
