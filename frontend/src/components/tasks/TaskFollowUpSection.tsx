import {
  AlertCircle,
  Send,
  ChevronDown,
  ImageIcon,
  StopCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ImageUploadSection } from '@/components/ui/ImageUploadSection';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { FileSearchTextarea } from '@/components/ui/file-search-textarea';
import { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { attemptsApi, imagesApi } from '@/lib/api.ts';
import type { ExecutorProfileId, ImageResponse, TaskWithAttemptStatus } from 'shared/types';
import { useBranchStatus } from '@/hooks';
import { useAttemptExecution } from '@/hooks/useAttemptExecution';
import { Loader } from '@/components/ui/loader';
import { useUserSystem } from '@/components/config-provider';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useVariantCyclingShortcut } from '@/lib/keyboard-shortcuts';

interface TaskFollowUpSectionProps {
  task: TaskWithAttemptStatus;
  projectId: string;
  selectedAttemptId?: string;
}

export function TaskFollowUpSection({
  task,
  projectId,
  selectedAttemptId,
}: TaskFollowUpSectionProps) {
  const {
    attemptData,
    isAttemptRunning,
    stopExecution,
    isStopping,
    processes,
  } = useAttemptExecution(selectedAttemptId, task.id);
  const { data: branchStatus } = useBranchStatus(selectedAttemptId);
  const { profiles, system } = useUserSystem();

  const latestCodingAgentProfile = useMemo(() => {
    const codingProcesses = processes
      .filter((p) => p.run_reason === 'codingagent' && !p.dropped)
      .reverse();

    for (const process of codingProcesses) {
      const typ: any = process.executor_action?.typ;
      if (!typ?.executor_profile_id) continue;
      return typ.executor_profile_id as ExecutorProfileId;
    }

    return null;
  }, [processes]);

  const derivedBaseExecutor = useMemo(() => {
    return (
      latestCodingAgentProfile?.executor ||
      system.config?.executor_profile?.executor ||
      null
    );
  }, [latestCodingAgentProfile?.executor, system.config?.executor_profile?.executor]);

  const defaultFollowUpVariant = useMemo(() => {
    if (latestCodingAgentProfile?.variant) {
      return latestCodingAgentProfile.variant;
    }
    return null;
  }, [latestCodingAgentProfile?.variant]);

  const [followUpMessage, setFollowUpMessage] = useState('');
  const [isSendingFollowUp, setIsSendingFollowUp] = useState(false);
  const [followUpError, setFollowUpError] = useState<string | null>(null);
  const [selectedVariant, setSelectedVariant] = useState<string | null>(
    defaultFollowUpVariant
  );
  // Base executor selection for per-message switching
  const [selectedBaseExecutor, setSelectedBaseExecutor] = useState<string | null>(
    derivedBaseExecutor
  );
  const [baseExecutorManuallySet, setBaseExecutorManuallySet] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const variantButtonRef = useRef<HTMLButtonElement>(null);
  const [showImageUpload, setShowImageUpload] = useState(false);
  const [images, setImages] = useState<ImageResponse[]>([]);
  const [newlyUploadedImageIds, setNewlyUploadedImageIds] = useState<string[]>(
    []
  );
  // Codex-only: reasoning/model selector
  const [codexReasoning, setCodexReasoning] = useState<
    'default' | 'low' | 'medium' | 'high' | 'custom'
  >('high');
  const [codexCustomModel, setCodexCustomModel] = useState<string>('');
  const [claudeModel, setClaudeModel] = useState<'default' | 'sonnet' | 'opus'>('default');

  // NOTE: base executor now selected via selectedBaseExecutor

  const canSendFollowUp = useMemo(() => {
    if (
      !selectedAttemptId ||
      attemptData.processes.length === 0 ||
      isSendingFollowUp
    ) {
      return false;
    }

    // Check if PR is merged - if so, block follow-ups
    if (branchStatus?.merges) {
      const mergedPR = branchStatus.merges.find(
        (m) => m.type === 'pr' && m.pr_info.status === 'merged'
      );
      if (mergedPR) {
        return false;
      }
    }

    return true;
  }, [
    selectedAttemptId,
    attemptData.processes,
    isSendingFollowUp,
    branchStatus?.merges,
  ]);
  useEffect(() => {
    setBaseExecutorManuallySet(false);
  }, [selectedAttemptId]);

  useEffect(() => {
    if (!baseExecutorManuallySet) {
      setSelectedBaseExecutor(derivedBaseExecutor);
    }
  }, [derivedBaseExecutor, baseExecutorManuallySet]);

  const currentProfile = useMemo(() => {
    if (!selectedBaseExecutor || !profiles) return null;
    return profiles?.[selectedBaseExecutor];
  }, [selectedBaseExecutor, profiles]);

  // Derive CLAUDE_CODE default model from configuration (if present)
  useEffect(() => {
    if (selectedBaseExecutor !== 'CLAUDE_CODE' || !currentProfile) return;
    setClaudeModel((prev) => {
      if (prev !== 'default') return prev; // respect explicit user selection
      try {
        const variants = Object.keys(currentProfile);
        const key = selectedVariant || variants[0] || 'DEFAULT';
        const cfg = (currentProfile as any)?.[key]?.CLAUDE_CODE || {};
        const m = (cfg.model || '').toLowerCase();
        return m === 'sonnet' || m === 'opus' ? m : 'default';
      } catch {
        return 'default';
      }
    });
  }, [selectedBaseExecutor, currentProfile, selectedVariant]);

  // Update selectedVariant when defaultFollowUpVariant changes
  useEffect(() => {
    setSelectedVariant(defaultFollowUpVariant);
  }, [defaultFollowUpVariant]);

  const handleImageUploaded = useCallback((image: ImageResponse) => {
    const markdownText = `![${image.original_name}](${image.file_path})`;
    setFollowUpMessage((prev) => {
      if (prev.trim() === '') {
        return markdownText;
      } else {
        return prev + ' ' + markdownText;
      }
    });

    setImages((prev) => [...prev, image]);
    setNewlyUploadedImageIds((prev) => [...prev, image.id]);
  }, []);

  // Use the centralized keyboard shortcut hook for cycling through variants
  useVariantCyclingShortcut({
    currentProfile,
    selectedVariant,
    setSelectedVariant,
    setIsAnimating,
  });

  const onSendFollowUp = async () => {
    if (!task || !selectedAttemptId || !followUpMessage.trim()) return;

    try {
      setIsSendingFollowUp(true);
      setFollowUpError(null);
      // Use newly uploaded image IDs if available, otherwise use all image IDs
      const imageIds =
        newlyUploadedImageIds.length > 0
          ? newlyUploadedImageIds
          : images.length > 0
            ? images.map((img) => img.id)
            : null;

      const codex_model_override =
        selectedBaseExecutor === 'CODEX'
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
      const claude_model_override =
        selectedBaseExecutor === 'CLAUDE_CODE'
          ? (claudeModel === 'default' ? null : claudeModel)
          : null;

      await attemptsApi.followUp(selectedAttemptId, {
        prompt: followUpMessage.trim(),
        variant: selectedVariant,
        image_ids: imageIds,
        executor_profile_id: selectedBaseExecutor
          ? ({ executor: selectedBaseExecutor, variant: selectedVariant } as any)
          : undefined,
        codex_model_override: (codex_model_override as string | null),
        claude_model_override: (claude_model_override as string | null),
      });
      setFollowUpMessage('');
      // Clear images and newly uploaded IDs after successful submission
      setImages([]);
      setNewlyUploadedImageIds([]);
      setShowImageUpload(false);
      // No need to manually refetch - React Query will handle this
    } catch (error: unknown) {
      // @ts-expect-error it is type ApiError
      setFollowUpError(`Failed to start follow-up execution: ${error.message}`);
    } finally {
      setIsSendingFollowUp(false);
    }
  };

  return (
    selectedAttemptId && (
      <div className="border-t p-4 focus-within:ring ring-inset">
        <div className="space-y-2">
          {followUpError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{followUpError}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-2">
            {showImageUpload && (
              <div className="mb-2">
                <ImageUploadSection
                  images={images}
                  onImagesChange={setImages}
                  onUpload={imagesApi.upload}
                  onDelete={imagesApi.delete}
                  onImageUploaded={handleImageUploaded}
                  disabled={!canSendFollowUp}
                  collapsible={false}
                  defaultExpanded={true}
                />
              </div>
            )}
            <div className="flex flex-col gap-2">
              <div>
                <FileSearchTextarea
                  placeholder="Continue working on this task attempt... Type @ to search files."
                  value={followUpMessage}
                  onChange={(value) => {
                    setFollowUpMessage(value);
                    if (followUpError) setFollowUpError(null);
                  }}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                      e.preventDefault();
                      if (
                        canSendFollowUp &&
                        followUpMessage.trim() &&
                        !isSendingFollowUp
                      ) {
                        onSendFollowUp();
                      }
                    }
                  }}
                  className="flex-1 min-h-[40px] resize-none"
                  disabled={!canSendFollowUp}
                  projectId={projectId}
                  rows={1}
                  maxRows={6}
                />
                {followUpMessage && (
                  <div className="mt-1 text-[11px] text-muted-foreground/90 text-right">
                    {followUpMessage.length.toLocaleString()} chars, ~
                    {Math.max(1, Math.round(followUpMessage.length / 3.5)).toLocaleString()} tokens (est.)
                  </div>
                )}
              </div>
              <div className="flex flex-row">
                <div className="flex-1 flex gap-2">
                  {/* Image button */}
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setShowImageUpload(!showImageUpload)}
                    disabled={!canSendFollowUp}
                  >
                    <ImageIcon
                      className={cn(
                        'h-4 w-4',
                        (images.length > 0 || showImageUpload) && 'text-primary'
                      )}
                    />
                  </Button>

                  {/* Executor selector */}
                  {profiles && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="secondary"
                          size="sm"
                          className="w-36 px-2 flex items-center justify-between"
                          disabled={!canSendFollowUp}
                        >
                          <span className="text-xs truncate flex-1 text-left">
                            {selectedBaseExecutor || 'Select Agent'}
                          </span>
                          <ChevronDown className="h-3 w-3 ml-1 flex-shrink-0" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        {Object.keys(profiles).map((exec) => (
                          <DropdownMenuItem
                            key={exec}
                            onClick={() => {
                              setBaseExecutorManuallySet(true);
                              setSelectedBaseExecutor(exec);
                              // Default variant for new executor
                              const variants = profiles?.[exec] || {};
                              const first = Object.keys(variants)[0] || null;
                              setSelectedVariant(first || null);
                            }}
                            className={selectedBaseExecutor === exec ? 'bg-accent' : ''}
                          >
                            {exec}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}

                  {/* Variant selector */}
                  {(() => {
                    const hasVariants =
                      currentProfile && Object.keys(currentProfile).length > 0;

                    if (hasVariants) {
                      return (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              ref={variantButtonRef}
                              variant="secondary"
                              size="sm"
                              className={cn(
                                'w-24 px-2 flex items-center justify-between transition-all',
                                isAnimating && 'scale-105 bg-accent'
                              )}
                            >
                              <span className="text-xs truncate flex-1 text-left">
                                {selectedVariant || 'DEFAULT'}
                              </span>
                              <ChevronDown className="h-3 w-3 ml-1 flex-shrink-0" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            {Object.entries(currentProfile).map(
                              ([variantLabel]) => (
                                <DropdownMenuItem
                                  key={variantLabel}
                                  onClick={() =>
                                    setSelectedVariant(variantLabel)
                                  }
                                  className={
                                    selectedVariant === variantLabel
                                      ? 'bg-accent'
                                      : ''
                                  }
                                >
                                  {variantLabel}
                                </DropdownMenuItem>
                              )
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      );
                    } else if (currentProfile) {
                      // Show disabled button when profile exists but has no variants
                      return (
                        <Button
                          ref={variantButtonRef}
                          variant="outline"
                          size="sm"
                          className="h-10 w-24 px-2 flex items-center justify-between transition-all"
                          disabled
                        >
                          <span className="text-xs truncate flex-1 text-left">
                            Default
                          </span>
                        </Button>
                      );
                    }
                    return null;
                  })()}

                  {/* Codex reasoning selector (visible only when CODEX) */}
                  {selectedBaseExecutor === 'CODEX' && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="secondary"
                          size="sm"
                          className="w-32 px-2 flex items-center justify-between"
                          disabled={!canSendFollowUp}
                          title="Codex reasoning/model"
                        >
                          <span className="text-xs truncate flex-1 text-left">
                            {codexReasoning === 'custom'
                              ? codexCustomModel || 'Custom…'
                              : codexReasoning}
                          </span>
                          <ChevronDown className="h-3 w-3 ml-1 flex-shrink-0" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        {(['default', 'low', 'medium', 'high'] as const).map((lvl) => (
                          <DropdownMenuItem
                            key={lvl}
                            onClick={() => setCodexReasoning(lvl)}
                            className={codexReasoning === lvl ? 'bg-accent' : ''}
                          >
                            {lvl}
                          </DropdownMenuItem>
                        ))}
                        <DropdownMenuItem
                          onClick={() => setCodexReasoning('custom')}
                          className={codexReasoning === 'custom' ? 'bg-accent' : ''}
                        >
                          Custom…
                        </DropdownMenuItem>
                        {codexReasoning === 'custom' && (
                          <div className="px-2 py-2">
                            <input
                              className="w-48 text-xs border rounded px-2 py-1 bg-background"
                              placeholder="model id (e.g., gpt-5)"
                              value={codexCustomModel}
                              onChange={(e) => setCodexCustomModel(e.target.value)}
                            />
                          </div>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}

                  {/* Claude model selector (visible only when CLAUDE_CODE) */}
                  {selectedBaseExecutor === 'CLAUDE_CODE' && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="secondary"
                          size="sm"
                          className="w-28 px-2 flex items-center justify-between"
                          disabled={!canSendFollowUp}
                          title="Claude model"
                        >
                          <span className="text-xs truncate flex-1 text-left">
                            {claudeModel}
                          </span>
                          <ChevronDown className="h-3 w-3 ml-1 flex-shrink-0" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        {(['default', 'sonnet', 'opus'] as const).map((m) => (
                          <DropdownMenuItem
                            key={m}
                            onClick={() => setClaudeModel(m)}
                            className={claudeModel === m ? 'bg-accent' : ''}
                          >
                            {m}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
                {isAttemptRunning ? (
                  <Button
                    onClick={stopExecution}
                    disabled={isStopping}
                    size="sm"
                    variant="destructive"
                  >
                    {isStopping ? (
                      <Loader size={16} className="mr-2" />
                    ) : (
                      <>
                        <StopCircle className="h-4 w-4 mr-2" />
                        Stop
                      </>
                    )}
                  </Button>
                ) : (
                  <Button
                    onClick={onSendFollowUp}
                    disabled={
                      !canSendFollowUp ||
                      !followUpMessage.trim() ||
                      isSendingFollowUp
                    }
                    size="sm"
                  >
                    {isSendingFollowUp ? (
                      <Loader size={16} className="mr-2" />
                    ) : (
                      <>
                        <Send className="h-4 w-4 mr-2" />
                        Send
                      </>
                    )}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  );
}
