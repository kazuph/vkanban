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
import { attemptsApi } from '@/lib/api';

type Props = {
  task: Task;
  branches: GitBranch[];
  taskAttempts: TaskAttempt[];
  selectedProfile: ExecutorProfileId | null;
  selectedBranch: string | null;
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
  setIsInCreateAttemptMode,
  setSelectedProfile,
  availableProfiles,
  selectedAttempt,
}: Props) {
  const { isAttemptRunning } = useAttemptExecution(selectedAttempt?.id);
  const { createAttempt, isCreating } = useAttemptCreation(task.id);
  const [initialPrompt, setInitialPrompt] = useState('');

  // Create attempt logic
  const actuallyCreateAttempt = useCallback(
    async (profile: ExecutorProfileId) => {
      // Always use the same base branch as the current (or latest) attempt.
      const latestAttempt = selectedAttempt
        ? selectedAttempt
        : taskAttempts.length > 0
          ? taskAttempts.reduce((latest, current) =>
              new Date(current.created_at) > new Date(latest.created_at)
                ? current
                : latest
            )
          : null;
      const effectiveBaseBranch = latestAttempt?.base_branch || selectedBranch ||
        // fallback to current git branch if available
        (branches.find((b) => b.is_current)?.name || branches[0]?.name || 'main');

      const newAttempt = await createAttempt({
        profile,
        baseBranch: effectiveBaseBranch,
      });

      // Send the initial prompt immediately as the first follow-up
      const prompt = initialPrompt.trim();
      if (prompt) {
        try {
          await attemptsApi.followUp(newAttempt.id, {
            prompt,
            variant: (profile as any).variant ?? null,
            image_ids: null,
          });
        } catch (e) {
          // Non-fatal: attempt is created; surface error via console
          console.error('Failed to send initial prompt follow-up:', e);
        }
      }
    },
    [createAttempt, selectedBranch, initialPrompt]
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
              message:
                'Are you sure you want to start a new attempt for this task? This will create a new session and branch.',
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
            coding agent on the same base branch as the current attempt. A
            dedicated git worktree and task branch are created automatically.
          </label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
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

          {/* Step 4: Initial Instructions (required) */}
          <div className="space-y-1 sm:col-span-2">
            <div className="flex items-center gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Initial Instructions
              </label>
              <span className="text-[10px] text-destructive">(required)</span>
            </div>
            <Textarea
              value={initialPrompt}
              onChange={(e) => setInitialPrompt(e.target.value)}
              placeholder="Describe what the agent should do first..."
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
