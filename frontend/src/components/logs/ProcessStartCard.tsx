import { ChevronDown, History } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { ProcessStartPayload } from '@/types/logs';
import type { ExecutorAction } from 'shared/types';
import { PROCESS_RUN_REASONS } from '@/constants/processes';
import React from 'react';

interface ProcessStartCardProps {
  payload: ProcessStartPayload;
  isCollapsed: boolean;
  onToggle: (processId: string) => void;
  onRestore?: (processId: string) => void;
  restoreProcessId?: string; // explicit id if payload lacks it in future
  restoreDisabled?: boolean;
  restoreDisabledReason?: string;
}

const extractPromptFromAction = (
  action?: ExecutorAction | null
): string | null => {
  if (!action) return null;
  const t = action.typ as any;
  if (t && typeof t.prompt === 'string' && t.prompt.trim()) return t.prompt;
  return null;
};

function ProcessStartCard({
  payload,
  isCollapsed,
  onToggle,
  onRestore,
  restoreProcessId,
  restoreDisabled,
  restoreDisabledReason,
}: ProcessStartCardProps) {
  const computeAgentLabel = (p: ProcessStartPayload): string | null => {
    if (!p.action) return null;
    const t: any = p.action.typ || {};
    const exec: string | undefined = t?.executor_profile_id?.executor;
    if (!exec) return null;
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
  };
  const getProcessLabel = (p: ProcessStartPayload) => {
    if (p.runReason === PROCESS_RUN_REASONS.CODING_AGENT) {
      const prompt = extractPromptFromAction(p.action);
      return prompt || 'Coding Agent';
    }
    switch (p.runReason) {
      case PROCESS_RUN_REASONS.SETUP_SCRIPT:
        return 'Setup Script';
      case PROCESS_RUN_REASONS.CLEANUP_SCRIPT:
        return 'Cleanup Script';
      case PROCESS_RUN_REASONS.DEV_SERVER:
        return 'Dev Server';
      default:
        return p.runReason;
    }
  };

  const handleClick = (e: React.MouseEvent) => {
    // Allow anchor clicks inside the header without toggling
    const target = e.target as HTMLElement | null;
    if (target && target.closest('a')) {
      e.stopPropagation();
      return;
    }
    onToggle(payload.processId);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onToggle(payload.processId);
    }
  };

  const label = getProcessLabel(payload);

  // Debug helpers: show prompt length and rough token estimate when available
  const prompt = extractPromptFromAction(payload.action) || '';
  const promptChars = prompt.length;
  // Very rough heuristic: ~3.5 chars/token across mixed languages
  const tokenEstimate = promptChars > 0 ? Math.max(1, Math.round(promptChars / 3.5)) : null;

  const renderLabelWithLinks = (text: string) => {
    const urlRegex = /https?:\/\/[^\s<'"`]+/gi;
    const nodes: React.ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = urlRegex.exec(text)) !== null) {
      const full = match[0];
      const start = match.index;
      const end = start + full.length;

      if (start > lastIndex) nodes.push(text.slice(lastIndex, start));

      const m = /^(.*?)([)\],.;:!?]+)$/.exec(full);
      const urlStr = (m ? m[1] : full) || full;
      const trailing = m ? m[2] : '';

      nodes.push(
        <a
          key={`${start}-${end}`}
          href={urlStr}
          target="_blank"
          rel="noopener noreferrer"
          className="underline text-[hsl(var(--info))] hover:opacity-90"
          onClick={(e) => e.stopPropagation()}
        >
          {urlStr}
        </a>
      );
      if (trailing) nodes.push(trailing);
      lastIndex = end;
    }

    if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
    return nodes.length > 0 ? nodes : text;
  };
  const shouldTruncate =
    isCollapsed && payload.runReason === PROCESS_RUN_REASONS.CODING_AGENT;

  return (
    <div
      className="p-2 border cursor-pointer select-none transition-colors w-full bg-background"
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      <div className="flex items-center gap-2 text-sm font-light">
        {/* Status chip - moved to left */}
        <div
          className={cn(
            'text-xs px-2 py-1 rounded-full flex-shrink-0',
            payload.status === 'running'
              ? 'bg-blue-100 text-blue-700'
              : payload.status === 'completed'
                ? 'bg-green-100 text-green-700'
                : payload.status === 'failed'
                  ? 'bg-red-100 text-red-700'
                  : 'bg-gray-100 text-gray-700'
          )}
        >
          {payload.status}
        </div>

        {/* Main label + optional agent */}
        <div className="flex items-center gap-2 text-foreground min-w-0 flex-1">
          {payload.runReason === PROCESS_RUN_REASONS.CODING_AGENT && (
            <span className="text-xs text-muted-foreground flex-shrink-0">
              Agent · {computeAgentLabel(payload) || '—'}
            </span>
          )}
          <span
            className={cn(
              shouldTruncate ? 'truncate' : 'whitespace-normal break-words'
            )}
            title={shouldTruncate ? label : undefined}
          >
            {renderLabelWithLinks(label)}
          </span>
        </div>

        {onRestore &&
          payload.runReason === PROCESS_RUN_REASONS.CODING_AGENT && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    className={cn(
                      'ml-2 p-1 rounded transition-colors',
                      restoreDisabled
                        ? 'cursor-not-allowed text-muted-foreground/60'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
                    )}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (restoreDisabled) return;
                      onRestore(restoreProcessId || payload.processId);
                    }}
                    aria-label="Restore to this checkpoint"
                    disabled={!!restoreDisabled}
                  >
                    <History className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  {restoreDisabled
                    ? restoreDisabledReason ||
                      'Restore is currently unavailable.'
                    : 'Restore'}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

        <ChevronDown
          className={cn(
            'h-4 w-4 text-muted-foreground transition-transform',
            isCollapsed && '-rotate-90'
          )}
        />
      </div>
      {prompt && (
        <div className="mt-1 text-[11px] text-muted-foreground/90 leading-4 flex items-center gap-2">
          <div>
            <span className="uppercase">Request Size</span>: {promptChars.toLocaleString()} chars
            {tokenEstimate ? (
              <>
                , ~{tokenEstimate.toLocaleString()} tokens (est.)
              </>
            ) : null}
          </div>
          <button
            className="underline hover:no-underline"
            onClick={(e) => {
              e.stopPropagation();
              if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                navigator.clipboard.writeText(prompt);
              }
            }}
            title="Copy full request text"
          >
            Copy
          </button>
        </div>
      )}
    </div>
  );
}

export default ProcessStartCard;
