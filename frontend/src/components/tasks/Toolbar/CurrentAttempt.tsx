import {
  ExternalLink,
  GitBranch as GitBranchIcon,
  GitPullRequest,
  History,
  Play,
  Plus,
  GitFork,
  RefreshCw,
  Settings,
  StopCircle,
  ScrollText,
  Trash2,
} from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip.tsx';
import { Button } from '@/components/ui/button.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.tsx';
import {
  Dispatch,
  SetStateAction,
  useCallback,
  useMemo,
  useState,
} from 'react';
import type {
  GitBranch,
  TaskAttempt,
  TaskWithAttemptStatus,
} from 'shared/types';
import { useBranchStatus, useOpenInEditor } from '@/hooks';
import { useAttemptExecution } from '@/hooks/useAttemptExecution';
import { useDevServer } from '@/hooks/useDevServer';
import { useRebase } from '@/hooks/useRebase';
import { useMerge } from '@/hooks/useMerge';
import NiceModal from '@ebay/nice-modal-react';
// import { usePush } from '@/hooks/usePush';
import { useUserSystem } from '@/components/config-provider.tsx';
import { useKeyboardShortcuts } from '@/lib/keyboard-shortcuts.ts';
import { writeClipboardViaBridge } from '@/vscode/bridge';
import { useProcessSelection } from '@/contexts/ProcessSelectionContext';
import { showModal } from '@/lib/modals';
import { openTaskForm } from '@/lib/openTaskForm';
import { attemptsApi } from '@/lib/api';
import { useQueryClient } from '@tanstack/react-query';
import { formatAgentSummary } from '@/lib/agent-display';

// Helper function to get the display name for different editor types
function getEditorDisplayName(editorType: string): string {
  switch (editorType) {
    case 'VS_CODE':
      return 'Visual Studio Code';
    case 'CURSOR':
      return 'Cursor';
    case 'WINDSURF':
      return 'Windsurf';
    case 'INTELLI_J':
      return 'IntelliJ IDEA';
    case 'ZED':
      return 'Zed';
    case 'XCODE':
      return 'Xcode';
    case 'CUSTOM':
      return 'Editor';
    default:
      return 'Editor';
  }
}

type Props = {
  task: TaskWithAttemptStatus;
  projectId: string;
  projectHasDevScript: boolean;
  setError: Dispatch<SetStateAction<string | null>>;

  selectedBranch: string | null;
  selectedAttempt: TaskAttempt;
  taskAttempts: TaskAttempt[];
  creatingPR: boolean;
  handleEnterCreateAttemptMode: () => void;
  branches: GitBranch[];
  setSelectedAttempt: (attempt: TaskAttempt | null) => void;
  showHistory?: boolean;
  showNewAttemptInCard?: boolean;
};

function CurrentAttempt({
  task,
  projectId,
  projectHasDevScript,
  setError,
  selectedBranch,
  selectedAttempt,
  taskAttempts,
  creatingPR,
  handleEnterCreateAttemptMode,
  branches,
  setSelectedAttempt,
  showHistory = true,
  showNewAttemptInCard = true,
}: Props) {
  const { config } = useUserSystem();
  const queryClient = useQueryClient();
  const {
    attemptData,
    isAttemptRunning,
    stopExecution,
    isStopping,
  } = useAttemptExecution(
    selectedAttempt?.id,
    task.id
  );
  const { data: branchStatus } = useBranchStatus(selectedAttempt?.id);
  const handleOpenInEditor = useOpenInEditor(selectedAttempt);
  const { jumpToProcess } = useProcessSelection();

  // Attempt action hooks
  const {
    start: startDevServer,
    stop: stopDevServer,
    isStarting: isStartingDevServer,
    runningDevServer,
    latestDevServerProcess,
  } = useDevServer(selectedAttempt?.id);
  const rebaseMutation = useRebase(selectedAttempt?.id, projectId);
  const mergeMutation = useMerge(selectedAttempt?.id);
  // const pushMutation = usePush(selectedAttempt?.id);

  const [merging, setMerging] = useState(false);
  // Deprecated local push state; pushing handled elsewhere if needed
  const [rebasing, setRebasing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [mergeSuccess, setMergeSuccess] = useState(false);
  // const [pushSuccess, setPushSuccess] = useState(false);
  const handleSpinoffClick = () => {
    openTaskForm({
      projectId,
      initialBaseBranch: selectedAttempt.branch || selectedAttempt.base_branch,
      parentTaskAttemptId: selectedAttempt.id,
    });
  };
  const [editingHead, setEditingHead] = useState(false);
  const [newHeadBranch, setNewHeadBranch] = useState<string>('');

  const handleViewDevServerLogs = () => {
    if (latestDevServerProcess) {
      jumpToProcess(latestDevServerProcess.id);
    }
  };

  // Use the stopExecution function from the hook

  useKeyboardShortcuts({
    stopExecution: async () => {
      try {
        const result = await showModal<'confirmed' | 'canceled'>(
          'stop-execution-confirm',
          {
            title: 'Stop Current Attempt?',
            message:
              'Are you sure you want to stop the current execution? This action cannot be undone.',
            isExecuting: isStopping,
          }
        );

        if (result === 'confirmed') {
          stopExecution();
        }
      } catch (error) {
        // User cancelled - do nothing
      }
    },
    newAttempt: !isAttemptRunning ? handleEnterCreateAttemptMode : () => {},
    hasOpenDialog: false,
    closeDialog: () => {},
    onEnter: () => {},
  });

  const handleAttemptChange = useCallback(
    (attempt: TaskAttempt) => {
      setSelectedAttempt(attempt);
      // React Query will handle refetching when attemptId changes
    },
    [setSelectedAttempt]
  );

  const latestAgentSummary = useMemo(() => {
    const processes = attemptData?.processes || [];
    const codingProcesses = processes
      .filter((p) => p.run_reason === 'codingagent' && !p.dropped)
      .reverse();

    for (const process of codingProcesses) {
      const typ: any = process.executor_action?.typ;
      if (!typ?.executor_profile_id) continue;
      const summary = formatAgentSummary({
        executor: typ.executor_profile_id.executor,
        variant: typ.executor_profile_id.variant,
        codexModelOverride: typ.codex_model_override,
        codexModelReasoningEffort: typ.codex_model_reasoning_effort,
        claudeModelOverride: typ.claude_model_override,
      });
      if (summary) {
        return summary;
      }
    }

    return null;
  }, [attemptData?.processes]);

  const handleMergeClick = async () => {
    if (!projectId || !selectedAttempt?.id || !selectedAttempt?.task_id) return;

    // Directly perform merge without checking branch status
    await performMerge();
  };

  // push handled as part of PR button when applicable

  const performMerge = async () => {
    try {
      setMerging(true);
      await mergeMutation.mutateAsync();
      setError(null); // Clear any previous errors on success
      setMergeSuccess(true);
      setTimeout(() => setMergeSuccess(false), 2000);
    } catch (error) {
      // @ts-expect-error it is type ApiError
      setError(error.message || 'Failed to merge changes');
    } finally {
      setMerging(false);
    }
  };

  const handleRebaseClick = async () => {
    try {
      setRebasing(true);
      await rebaseMutation.mutateAsync(undefined);
      setError(null); // Clear any previous errors on success
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rebase branch');
    } finally {
      setRebasing(false);
    }
  };

  const handleHeadBranchChange = useCallback(async () => {
    if (!selectedAttempt?.id || !newHeadBranch.trim()) return;
    try {
      await attemptsApi.updateBranch(selectedAttempt.id, newHeadBranch.trim());
      setError(null);
      setEditingHead(false);
      // Refresh branch status and attempt fetchers if any rely on it
      queryClient.invalidateQueries({ queryKey: ['branchStatus', selectedAttempt.id] });
      // Optimistically update selectedAttempt in UI
      setSelectedAttempt({ ...selectedAttempt, branch: newHeadBranch.trim() });
    } catch (error: any) {
      setError(error.message || 'Failed to update branch');
    }
  }, [newHeadBranch, selectedAttempt, setError, queryClient, setSelectedAttempt]);

  const handleRebaseWithNewBranch = async (newBaseBranch: string) => {
    try {
      setRebasing(true);
      await rebaseMutation.mutateAsync(newBaseBranch);
      setError(null); // Clear any previous errors on success
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rebase branch');
    } finally {
      setRebasing(false);
    }
  };

  const handleRebaseDialogOpen = async () => {
    try {
      const result = await showModal<{
        action: 'confirmed' | 'canceled';
        branchName?: string;
      }>('rebase-dialog', {
        branches,
        isRebasing: rebasing,
      });

      if (result.action === 'confirmed' && result.branchName) {
        await handleRebaseWithNewBranch(result.branchName);
      }
    } catch (error) {
      // User cancelled - do nothing
    }
  };

  const handlePRButtonClick = async () => {
    if (!projectId || !selectedAttempt?.id || !selectedAttempt?.task_id) return;
    try {
      // Prefer opening/linking an existing PR instead of always showing the dialog
      const result = await attemptsApi.openExistingPRIfAny(selectedAttempt.id);
      if (result.success) {
        queryClient.invalidateQueries({ queryKey: ['branchStatus', selectedAttempt.id] });
        if (result.data) window.open(result.data, '_blank');
        return;
      }
    } catch (e) {
      // ignore and fallback
    }

    NiceModal.show('create-pr', {
      attempt: selectedAttempt,
      task,
      projectId,
    });
  };

  const handleDeleteAttempt = async () => {
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
      // Pick a fallback attempt before deletion (next most recent)
      const fallback = taskAttempts.find((a) => a.id !== deletingId) || null;

      await attemptsApi.delete(deletingId);

      // Refresh attempts list
      queryClient.invalidateQueries({ queryKey: ['taskAttempts', task.id] });

      // Switch selection if there is a fallback attempt
      if (fallback) {
        setSelectedAttempt(fallback);
      } else {
        // No attempts left; allow parent to render create-attempt UI.
      }
    } catch (e: any) {
      // Surface server-side validation messages when present
      const msg = e?.message || 'Failed to delete attempt';
      setError(msg);
    }
  };

  // Get display name for selected branch
  const selectedBranchDisplayName = useMemo(() => {
    if (!selectedBranch) return 'current';

    // For remote branches, show just the branch name without the remote prefix
    if (selectedBranch.includes('/')) {
      const parts = selectedBranch.split('/');
      return parts[parts.length - 1];
    }
    return selectedBranch;
  }, [selectedBranch]);

  // Get display name for the configured editor
  const editorDisplayName = useMemo(() => {
    if (!config?.editor?.editor_type) return 'Editor';
    return getEditorDisplayName(config.editor.editor_type);
  }, [config?.editor?.editor_type]);

  // Memoize merge status information to avoid repeated calculations
  const mergeInfo = useMemo(() => {
    if (!branchStatus?.merges)
      return {
        hasOpenPR: false,
        openPR: null,
        hasMergedPR: false,
        mergedPR: null,
        hasMerged: false,
        latestMerge: null,
      };

    const openPR = branchStatus.merges.find(
      (m) => m.type === 'pr' && m.pr_info.status === 'open'
    );

    const mergedPR = branchStatus.merges.find(
      (m) => m.type === 'pr' && m.pr_info.status === 'merged'
    );

    const merges = branchStatus.merges.filter(
      (m) =>
        m.type === 'direct' ||
        (m.type === 'pr' && m.pr_info.status === 'merged')
    );

    return {
      hasOpenPR: !!openPR,
      openPR,
      hasMergedPR: !!mergedPR,
      mergedPR,
      hasMerged: merges.length > 0,
      latestMerge: branchStatus.merges[0] || null, // Most recent merge
    };
  }, [branchStatus?.merges]);

  const handleCopyWorktreePath = useCallback(async () => {
    try {
      await writeClipboardViaBridge(selectedAttempt.container_ref || '');
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy worktree path:', err);
    }
  }, [selectedAttempt.container_ref]);

  // Get status information for display
  type StatusInfo = {
    dotColor: string;
    textColor: string;
    text: string;
    isClickable: boolean;
    onClick?: () => void;
    prUrl?: string;
    prNumber?: number | bigint;
  };

  const getStatusInfo = useCallback((): StatusInfo => {
    if (mergeInfo.hasMergedPR && mergeInfo.mergedPR?.type === 'pr') {
      const prMerge = mergeInfo.mergedPR;
      return {
        dotColor: 'bg-green-500',
        textColor: 'text-green-700',
        text: `PR #${prMerge.pr_info.number} merged`,
        // Only the #123 part should be a link
        isClickable: false,
        prUrl: prMerge.pr_info.url,
        prNumber: prMerge.pr_info.number,
      };
    }
    if (
      mergeInfo.hasMerged &&
      mergeInfo.latestMerge?.type === 'direct' &&
      (branchStatus?.commits_ahead ?? 0) === 0
    ) {
      return {
        dotColor: 'bg-green-500',
        textColor: 'text-green-700',
        text: `Merged`,
        isClickable: false,
      };
    }

    if (mergeInfo.hasOpenPR && mergeInfo.openPR?.type === 'pr') {
      const prMerge = mergeInfo.openPR;
      return {
        dotColor: 'bg-blue-500',
        textColor: 'text-blue-700',
        text: `PR #${prMerge.pr_info.number}`,
        // Only the #123 part should be a link
        isClickable: false,
        prUrl: prMerge.pr_info.url,
        prNumber: prMerge.pr_info.number,
      };
    }

    if ((branchStatus?.commits_behind ?? 0) > 0) {
      return {
        dotColor: 'bg-orange-500',
        textColor: 'text-orange-700',
        text: `Rebase needed${branchStatus?.has_uncommitted_changes ? ' (dirty)' : ''}`,
        isClickable: false,
      };
    }

    if ((branchStatus?.commits_ahead ?? 0) > 0) {
      return {
        dotColor: 'bg-yellow-500',
        textColor: 'text-yellow-700',
        text:
          branchStatus?.commits_ahead === 1
            ? `1 commit ahead${branchStatus?.has_uncommitted_changes ? ' (dirty)' : ''}`
            : `${branchStatus?.commits_ahead} commits ahead${branchStatus?.has_uncommitted_changes ? ' (dirty)' : ''}`,
        isClickable: false,
      };
    }

    return {
      dotColor: 'bg-gray-500',
      textColor: 'text-gray-700',
      text: `Up to date${branchStatus?.has_uncommitted_changes ? ' (dirty)' : ''}`,
      isClickable: false,
    };
  }, [mergeInfo, branchStatus]);

  return (
    <div className="space-y-2 @container">
      {/* <div className="flex gap-6 items-start"> */}
      <div className="relative grid grid-cols-2 gap-3 items-start @md:flex @md:items-start">
        {/* Top-right delete icon only in fullscreen sidebar (when history is hidden) */}
        {!showHistory && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={handleDeleteAttempt}
                  className="absolute right-0 -top-2 h-6 w-6 p-0 text-destructive hover:bg-destructive/10"
                  title="Delete attempt"
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Delete attempt</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        <div className="min-w-0">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
            Latest Agent
          </div>
          <div
            className="text-sm font-medium"
            title="Derived from the most recent coding agent process in this attempt"
          >
            {latestAgentSummary ?? 'Not yet run'}
          </div>
        </div>

        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
            <span>Task Branch</span>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => {
                      setNewHeadBranch(selectedAttempt?.branch || '');
                      setEditingHead((v) => !v);
                    }}
                    className="h-4 w-4 p-0 hover:bg-muted"
                  >
                    <Settings className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Edit task branch</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          {editingHead ? (
            <div className="flex items-center gap-2">
              <select
                className="border rounded px-2 py-1 text-sm min-w-[10rem]"
                value={newHeadBranch}
                onChange={(e) => setNewHeadBranch(e.target.value)}
              >
                <option value="" disabled>
                  Select branch
                </option>
                {(branches || []).map((b) => (
                  <option key={b.name} value={b.name}>
                    {b.name}
                  </option>
                ))}
              </select>
              <Button variant="default" size="xs" className="h-7" onClick={handleHeadBranchChange}>
                Save
              </Button>
              <Button variant="ghost" size="xs" className="h-7" onClick={() => setEditingHead(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <GitBranchIcon className="h-3 w-3 text-muted-foreground" />
              <span className="text-sm font-medium">
                {selectedAttempt.branch}
              </span>
            </div>
          )}
        </div>

        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
            <span>Base Branch</span>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={handleRebaseDialogOpen}
                    disabled={rebasing || isAttemptRunning}
                    className="h-4 w-4 p-0 hover:bg-muted"
                  >
                    <Settings className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Change base branch</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <div className="flex items-center gap-1.5">
            <GitBranchIcon className="h-3 w-3 text-muted-foreground" />
            <span className="text-sm font-medium truncate">
              {branchStatus?.base_branch_name || selectedBranchDisplayName}
            </span>
          </div>
        </div>

        <div className="min-w-0">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
            Status
          </div>
          <div className="flex items-center gap-1.5">
            {(() => {
              const statusInfo = getStatusInfo();
              // If we have PR info, render only the #123 as a link
              if (statusInfo.prUrl && statusInfo.prNumber) {
                const text = statusInfo.text;
                // Split around the first occurrence of #<number>
                const match = text.match(/^(.*?)(#\d+)(.*)$/);
                const prefix = match ? match[1] : '';
                const hashPart = match ? match[2] : `#${statusInfo.prNumber}`;
                const suffix = match ? match[3] : text.replace(`PR #${statusInfo.prNumber}`, '');
                return (
                  <>
                    <div className={`h-2 w-2 ${statusInfo.dotColor} rounded-full`} />
                    <span className={`text-sm font-medium ${statusInfo.textColor}`}>
                      {prefix}
                      <a
                        href={statusInfo.prUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline text-[hsl(var(--info))] hover:opacity-90"
                        onClick={(e) => {
                          // Prevent parent click handlers from triggering
                          e.stopPropagation();
                        }}
                      >
                        {hashPart}
                      </a>
                      {suffix}
                    </span>
                  </>
                );
              }

              // Fallback: previous behavior
              return (
                <>
                  <div className={`h-2 w-2 ${statusInfo.dotColor} rounded-full`} />
                  {statusInfo.isClickable ? (
                    <button
                      onClick={statusInfo.onClick}
                      className={`text-sm font-medium ${statusInfo.textColor} hover:underline cursor-pointer`}
                    >
                      {statusInfo.text}
                    </button>
                  ) : (
                    <span className={`text-sm font-medium ${statusInfo.textColor} truncate`}>
                      {statusInfo.text}
                    </span>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      </div>

      <div>
        <div className="flex items-center gap-1.5 mb-1">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1 pt-1">
            Path
          </div>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => handleOpenInEditor()}
            className="h-6 px-2 text-xs hover:bg-muted gap-1"
          >
            <ExternalLink className="h-3 w-3" />
            Open in {editorDisplayName}
          </Button>
        </div>
        <div
          className={`text-xs font-mono px-2 py-1 break-all cursor-pointer transition-all duration-300 flex items-center gap-2 ${
            copied
              ? 'bg-green-100 text-green-800 border border-green-300'
              : 'text-muted-foreground bg-muted hover:bg-muted/80'
          }`}
          onClick={handleCopyWorktreePath}
          title={copied ? 'Copied!' : 'Click to copy worktree path'}
        >
          <span
            className={`truncate ${copied ? 'text-green-800' : ''}`}
            dir="rtl"
          >
            {selectedAttempt.container_ref}
          </span>
          {copied && (
            <span className="text-green-700 font-medium whitespace-nowrap">
              Copied!
            </span>
          )}
        </div>
      </div>

      <div>
        <div className="grid grid-cols-2 gap-3 @md:flex @md:flex-wrap @md:items-center">
          <div className="flex gap-2 @md:flex-none">
            <Button
              variant={runningDevServer ? 'destructive' : 'outline'}
              size="xs"
              onClick={() =>
                runningDevServer ? stopDevServer() : startDevServer()
              }
              disabled={isStartingDevServer || !projectHasDevScript}
              className="gap-1 flex-1"
            >
              {runningDevServer ? (
                <>
                  <StopCircle className="h-3 w-3" />
                  Stop Dev
                </>
              ) : (
                <>
                  <Play className="h-3 w-3" />
                  Dev
                </>
              )}
            </Button>

            {/* View Dev Server Logs Button */}
            {latestDevServerProcess && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={handleViewDevServerLogs}
                      className="gap-1"
                    >
                      <ScrollText className="h-3 w-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>View dev server logs</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
          {/* Git Operations */}
          {selectedAttempt && branchStatus && !mergeInfo.hasMergedPR && (
            <>
              {(branchStatus.commits_behind ?? 0) > 0 && (
                <Button
                  onClick={handleRebaseClick}
                  disabled={rebasing || isAttemptRunning}
                  variant="outline"
                  size="xs"
                  className="border-orange-300 text-orange-700 hover:bg-orange-50 gap-1"
                >
                  <RefreshCw
                    className={`h-3 w-3 ${rebasing ? 'animate-spin' : ''}`}
                  />
                  {rebasing ? 'Rebasing...' : `Rebase`}
                </Button>
              )}
              <>
                {/* Create/Push PR button */}
                <Button
                  onClick={handlePRButtonClick}
                  disabled={
                    creatingPR ||
                    Boolean((branchStatus.commits_behind ?? 0) > 0) ||
                    isAttemptRunning ||
                    ((branchStatus.commits_ahead ?? 0) === 0 &&
                      (branchStatus.remote_commits_ahead ?? 0) === 0 &&
                      !mergeSuccess)
                  }
                  variant="outline"
                  size="xs"
                  className="border-blue-300 text-blue-700 hover:bg-blue-50 gap-1 min-w-[120px]"
                >
                  <GitPullRequest className="h-3 w-3" />
                  {mergeInfo.hasOpenPR ? 'Open PR' : creatingPR ? 'Creating...' : 'Create PR'}
                </Button>
                <Button
                  onClick={handleMergeClick}
                  disabled={
                    mergeInfo.hasOpenPR ||
                    merging ||
                    Boolean((branchStatus.commits_behind ?? 0) > 0) ||
                    isAttemptRunning ||
                    ((branchStatus.commits_ahead ?? 0) === 0 && !mergeSuccess)
                  }
                  size="xs"
                  className="bg-green-600 hover:bg-green-700 disabled:bg-gray-400 gap-1 min-w-[120px]"
                >
                  <GitBranchIcon className="h-3 w-3" />
                  {mergeSuccess ? 'Merged!' : merging ? 'Merging...' : 'Merge'}
                </Button>
              </>
            </>
          )}

          <div className="flex gap-2 @md:flex-none">
            {isStopping || isAttemptRunning ? (
              <Button
                variant="destructive"
                size="xs"
                onClick={stopExecution}
                disabled={isStopping}
                className="gap-1 flex-1"
              >
                <StopCircle className="h-4 w-4" />
                {isStopping ? 'Stopping...' : 'Stop Attempt'}
              </Button>
            ) : (
              showNewAttemptInCard ? (
                <Button
                  variant="outline"
                  size="xs"
                  onClick={handleEnterCreateAttemptMode}
                  className="gap-1 flex-1"
                >
                  <Plus className="h-4 w-4" />
                  New Attempt
                </Button>
              ) : null
            )}
            <Button
              variant="outline"
              size="xs"
              onClick={handleSpinoffClick}
              className="gap-1"
              title="Create a new task from this attempt"
            >
              <GitFork className="h-3 w-3" />
              Spinoff
            </Button>
            {showHistory && taskAttempts.length > 1 && (
              <DropdownMenu>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="xs" className="gap-1">
                          <History className="h-3 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>View attempt history</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <DropdownMenuContent align="start" className="w-64">
                  {taskAttempts.map((attempt) => (
                    <DropdownMenuItem
                      key={attempt.id}
                      onClick={() => handleAttemptChange(attempt)}
                      className={
                        selectedAttempt?.id === attempt.id ? 'bg-accent' : ''
                      }
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
            )}
            {/* Delete button moved to top-right in fullscreen; removed from here */}
          </div>
        </div>
      </div>
    </div>
  );
}

export default CurrentAttempt;
