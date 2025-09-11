import { Dispatch, SetStateAction, useCallback, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { ArrowDown, Settings2, X } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.tsx';
import type { BaseCodingAgent, GitBranch, Task } from 'shared/types';
import type { ExecutorConfig } from 'shared/types';
import type { ExecutorProfileId } from 'shared/types';
import type { TaskAttempt } from 'shared/types';
import { useAttemptCreation } from '@/hooks/useAttemptCreation';
import { useAttemptExecution } from '@/hooks/useAttemptExecution';
import { useKeyboardShortcuts } from '@/lib/keyboard-shortcuts.ts';
import { showModal } from '@/lib/modals';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { attemptsApi, executionProcessesApi } from '@/lib/api';

type Props = {
  task: Task;
  branches: GitBranch[];
  taskAttempts: TaskAttempt[];
  selectedProfile: ExecutorProfileId | null;
  selectedBranch: string | null;
  setSelectedBranch: Dispatch<SetStateAction<string | null>>;
  setIsInCreateAttemptMode: Dispatch<SetStateAction<boolean>>;
  setSelectedProfile: Dispatch<SetStateAction<ExecutorProfileId | null>>;
  availableProfiles: Record<string, ExecutorConfig> | null;
  selectedAttempt: TaskAttempt | null;
};

function CreateAttempt({
  task,
  branches,
  taskAttempts,
  selectedProfile,
  selectedBranch,
  setSelectedBranch,
  setIsInCreateAttemptMode,
  setSelectedProfile,
  availableProfiles,
  selectedAttempt,
}: Props) {
  const { isAttemptRunning } = useAttemptExecution(selectedAttempt?.id);
  const { createAttempt, isCreating } = useAttemptCreation(task.id);
  const [initialPrompt, setInitialPrompt] = useState('');
  const [claudeModel, setClaudeModel] = useState<'default' | 'sonnet' | 'opus'>('sonnet');
  // Codex-only model/effort selector for the first follow-up
  const [codexReasoning, setCodexReasoning] = useState<
    'default' | 'low' | 'medium' | 'high' | 'custom'
  >('high');
  const [codexCustomModel, setCodexCustomModel] = useState('');
  const [reuseBranch, setReuseBranch] = useState(false);

  // Create attempt logic
  const actuallyCreateAttempt = useCallback(
    async (profile: ExecutorProfileId) => {
      // Before creating a new attempt, ensure no other attempts for this task are running.
      // This prevents multiple attempts for the same task running concurrently.
      try {
        const runningAttemptIds: string[] = [];
        await Promise.all(
          taskAttempts.map(async (a) => {
            try {
              const processes = await executionProcessesApi.getExecutionProcesses(a.id);
              const isRunning = processes.some(
                (p) =>
                  (p.run_reason === 'codingagent' ||
                    p.run_reason === 'setupscript' ||
                    p.run_reason === 'cleanupscript') &&
                  p.status === 'running'
              );
              if (isRunning) runningAttemptIds.push(a.id);
            } catch (e) {
              // Ignore fetch errors for non-selected attempts; proceed best-effort
            }
          })
        );

        // Stop all running attempts (best-effort)
        await Promise.all(
          runningAttemptIds.map(async (id) => {
            try {
              await attemptsApi.stop(id);
            } catch (e) {
              // Ignore errors (e.g., already stopped) to avoid blocking creation
            }
          })
        );
      } catch (e) {
        // Non-fatal; continue creating the new attempt
      }

      // Default base branch should be the branch already used by this task
      const latestAttempt = selectedAttempt
        ? selectedAttempt
        : taskAttempts.length > 0
          ? taskAttempts.reduce((latest, current) =>
              new Date(current.created_at) > new Date(latest.created_at)
                ? current
                : latest
            )
          : null;

      const existingTaskBranch = latestAttempt?.branch || null;
      const currentGitBranch =
        branches.find((b) => b.is_current)?.name || branches[0]?.name || 'main';

      const effectiveBaseBranch =
        selectedBranch || existingTaskBranch || latestAttempt?.base_branch || currentGitBranch;

      const prompt = initialPrompt.trim();
      const isCodex = (profile as any).executor === 'CODEX';
      const codex_model_override = isCodex
        ? codexReasoning === 'custom'
          ? codexCustomModel.trim() || null
          : codexReasoning === 'high'
            ? 'gpt-5'
            : codexReasoning === 'medium'
              ? 'codex-mini-latest'
              : codexReasoning === 'low'
                ? 'o4-mini'
                : null
        : null;
      const isClaude = (profile as any).executor === 'CLAUDE_CODE';

      const newAttempt = await createAttempt({
        profile,
        baseBranch: effectiveBaseBranch,
        reuseBranchAttemptId:
          reuseBranch && selectedAttempt?.branch ? (selectedAttempt.id as string) : undefined,
        initialInstructions: prompt || null,
        codexModelOverride: codex_model_override as any,
        claudeModelOverride: isClaude
          ? ((claudeModel === 'default' ? null : (claudeModel as string)) as any)
          : null,
      });
    },
    [createAttempt, selectedBranch, initialPrompt, codexReasoning, codexCustomModel, claudeModel]
  );

  // Handler for Enter key or Start button
  const onCreateNewAttempt = useCallback(
    async (
      profile: ExecutorProfileId,
      isKeyTriggered?: boolean
    ) => {
      if (!initialPrompt.trim()) {
        // Require initial prompt before starting
        return;
      }
      if (task.status === 'todo' && isKeyTriggered) {
        try {
          const result = await showModal<'confirmed' | 'canceled'>(
            'create-attempt-confirm',
            {
              title: 'Start New Attempt?',
              message: reuseBranch
                ? 'Start a new attempt on the SAME branch. A new session will begin; no new branch/worktree will be created.'
                : 'Start a new attempt for this task. This will create a new session and branch/worktree.',
            }
          );

          if (result === 'confirmed') {
            await actuallyCreateAttempt(profile);
            setIsInCreateAttemptMode(false);
          }
        } catch (error) {
          // User cancelled - do nothing
        }
      } else {
        await actuallyCreateAttempt(profile);
        setIsInCreateAttemptMode(false);
      }
    },
    [task.status, actuallyCreateAttempt, setIsInCreateAttemptMode, initialPrompt]
  );

  // Keyboard shortcuts
  useKeyboardShortcuts({
    onEnter: () => {
      if (!selectedProfile) {
        return;
      }
      onCreateNewAttempt(selectedProfile, true);
    },
    hasOpenDialog: false,
    closeDialog: () => {},
  });

  const handleExitCreateAttemptMode = () => {
    setIsInCreateAttemptMode(false);
  };

  const handleCreateAttempt = () => {
    if (!selectedProfile) {
      return;
    }
    onCreateNewAttempt(selectedProfile);
  };

  return (
    <div className="">
      <Card className="bg-background p-3 text-sm border-y border-dashed">
        Create Attempt
      </Card>
      <div className="space-y-3 p-3">
        <div className="flex items-center justify-between">
          {taskAttempts.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleExitCreateAttemptMode}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
        <div className="flex items-center">
          <label className="text-xs font-medium text-muted-foreground">
            Starting a new attempt creates a fresh session with your selected
            coding agent. By default a dedicated branch/worktree is created.
          </label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
          {/* Section: Branch */}
          <div className="sm:col-span-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Branch
          </div>
          {/* Step 1: Choose Base Branch */}
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Base Branch
              </label>
            </div>
            <select
              className="w-full text-xs border rounded px-2 py-1 bg-background"
              value={
                selectedBranch ||
                branches.find((b) => b.is_current)?.name ||
                branches[0]?.name ||
                ''
              }
              onChange={(e) => {
                const val = e.target.value;
                setSelectedBranch(val || null);
              }}
              disabled={reuseBranch}
              // Render options
            >
            {(() => {
              const names = new Set<string>(branches.map((b) => b.name));
              if (selectedBranch && !names.has(selectedBranch)) {
                // Ensure the current selection is selectable even if not in list
                names.add(selectedBranch);
              }
              return Array.from(names).map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ));
            })()}
            </select>
            {selectedAttempt?.branch && (
              <label className="inline-flex items-center gap-2 mt-2 text-xs">
                <input
                  type="checkbox"
                  className="accent-primary"
                  checked={reuseBranch}
                  onChange={(e) => setReuseBranch(e.target.checked)}
                />
                Reuse current attempt's branch (no new branch/worktree)
              </label>
            )}
          </div>
          {/* Section: Agent */}
          <div className="sm:col-span-2 pt-1 border-t text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Agent
          </div>
          {/* Step 2: Choose Profile */}
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Profile
              </label>
            </div>
            {availableProfiles && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full justify-between text-xs"
                  >
                    <div className="flex items-center gap-1.5">
                      <Settings2 className="h-3 w-3" />
                      <span className="truncate">
                        {selectedProfile?.executor || 'Select profile'}
                      </span>
                    </div>
                    <ArrowDown className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-full">
                  {availableProfiles &&
                    Object.entries(availableProfiles)
                      .sort((a, b) => a[0].localeCompare(b[0]))
                      .map(([profileKey]) => (
                        <DropdownMenuItem
                          key={profileKey}
                          onClick={() => {
                            setSelectedProfile({
                              executor: profileKey as BaseCodingAgent,
                              variant: null,
                            });
                          }}
                          className={
                            selectedProfile?.executor === profileKey
                              ? 'bg-accent'
                              : ''
                          }
                        >
                          {profileKey}
                        </DropdownMenuItem>
                      ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>

          {/* Step 3: Choose Variant (if available) */}
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Variant
              </label>
            </div>
            {(() => {
              const currentProfile =
                availableProfiles?.[selectedProfile?.executor || ''];
              const hasVariants =
                currentProfile && Object.keys(currentProfile).length > 0;

              if (hasVariants && currentProfile) {
                return (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full px-2 flex items-center justify-between text-xs"
                      >
                        <span className="truncate flex-1 text-left">
                          {selectedProfile?.variant || 'DEFAULT'}
                        </span>
                        <ArrowDown className="h-3 w-3 ml-1 flex-shrink-0" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="w-full">
                      {Object.entries(currentProfile).map(([variantLabel]) => (
                        <DropdownMenuItem
                          key={variantLabel}
                          onClick={() => {
                            if (selectedProfile) {
                              setSelectedProfile({
                                ...selectedProfile,
                                variant: variantLabel,
                              });
                            }
                          }}
                          className={
                            selectedProfile?.variant === variantLabel
                              ? 'bg-accent'
                              : ''
                          }
                        >
                          {variantLabel}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                );
              }
              if (currentProfile) {
                return (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled
                    className="w-full text-xs justify-start"
                  >
                    Default
                  </Button>
                );
              }
              return (
                <Button
                  variant="outline"
                  size="sm"
                  disabled
                  className="w-full text-xs justify-start"
                >
                  Select profile first
                </Button>
              );
            })()}
          </div>

          {/* Agent-specific model selectors */}
          {(selectedProfile?.executor as any) === 'CODEX' && (
            <div className="sm:col-span-2">
              <div className="flex gap-2">
                <select
                  className="w-40 text-xs border rounded px-2 py-1 bg-background"
                  value={codexReasoning}
                  onChange={(e) => setCodexReasoning(e.target.value as any)}
                >
                  <option value="default">default</option>
                  <option value="low">low</option>
                  <option value="medium">medium</option>
                  <option value="high">high</option>
                  <option value="custom">custom…</option>
                </select>
                {codexReasoning === 'custom' && (
                  <input
                    className="flex-1 text-xs border rounded px-2 py-1 bg-background"
                    placeholder="model id (e.g., gpt-5)"
                    value={codexCustomModel}
                    onChange={(e) => setCodexCustomModel(e.target.value)}
                  />
                )}
              </div>
            </div>
          )}
          {(selectedProfile?.executor as any) === 'CLAUDE_CODE' && (
            <div className="sm:col-span-2">
              <select
                className="w-40 text-xs border rounded px-2 py-1 bg-background"
                value={claudeModel}
                onChange={(e) => setClaudeModel(e.target.value as any)}
              >
                <option value="default">default</option>
                <option value="sonnet">sonnet</option>
                <option value="opus">opus</option>
              </select>
            </div>
          )}

          {/* Step 4: Prompt */}
          <div className="space-y-1 sm:col-span-2 pt-1 border-t">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Prompt
            </div>

            <Textarea
              value={initialPrompt}
              onChange={(e) => setInitialPrompt(e.target.value)}
              placeholder="Describe the main request for the agent..."
              className="w-full text-xs px-2 py-2 border-input"
              rows={4}
            />
          </div>

          {/* Step 5: Start Attempt */}
          <div className="space-y-1">
            <Button
              onClick={handleCreateAttempt}
              disabled={
                !selectedProfile ||
                isAttemptRunning ||
                isCreating ||
                !initialPrompt.trim()
              }
              size="sm"
              className={
                'w-full text-xs gap-2 justify-center bg-black text-white hover:bg-black/90'
              }
              title={
                !selectedProfile
                    ? 'Coding agent is required'
                    : !initialPrompt.trim()
                      ? 'Initial instructions are required'
                    : undefined
              }
            >
              {isCreating ? 'Creating...' : 'Start'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default CreateAttempt;
