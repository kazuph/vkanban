// Utility helpers for presenting coding agent information in the UI.

function toTitleCase(input: string): string {
  return input
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

export function formatExecutorName(executor?: string | null): string {
  if (!executor) {
    return '';
  }

  switch (executor) {
    case 'CLAUDE_CODE':
      return 'Claude Code';
    case 'CODEX':
      return 'Codex';
    case 'QWEN_CODE':
      return 'Qwen Code';
    case 'AMP':
    case 'GEMINI':
    case 'OPENCODE':
    case 'CURSOR':
      return toTitleCase(executor);
    default:
      return toTitleCase(executor);
  }
}

export function formatCodexReasoning({
  modelOverride,
  reasoningEffort,
}: {
  modelOverride?: string | null;
  reasoningEffort?: string | null;
}): string | null {
  if (reasoningEffort) {
    return reasoningEffort;
  }

  if (!modelOverride) {
    return null;
  }

  switch (modelOverride) {
    case 'gpt-5':
      return 'high';
    case 'codex-mini-latest':
      return 'medium';
    case 'o4-mini':
      return 'low';
    default:
      return modelOverride;
  }
}

export function formatAgentSummary({
  executor,
  variant,
  codexModelOverride,
  codexModelReasoningEffort,
  claudeModelOverride,
}: {
  executor?: string | null;
  variant?: string | null;
  codexModelOverride?: string | null;
  codexModelReasoningEffort?: string | null;
  claudeModelOverride?: string | null;
}): string | null {
  if (!executor) {
    return null;
  }

  const parts: string[] = [];
  parts.push(formatExecutorName(executor));

  if (variant) {
    parts.push(variant);
  }

  const extras: string[] = [];
  if (executor === 'CODEX') {
    const reasoning = formatCodexReasoning({
      modelOverride: codexModelOverride,
      reasoningEffort: codexModelReasoningEffort,
    });
    if (reasoning) {
      extras.push(reasoning);
    }
  }

  if (executor === 'CLAUDE_CODE' && claudeModelOverride) {
    extras.push(claudeModelOverride);
  }

  let summary = parts.join(' · ');
  if (extras.length)
    summary += ` (${extras.join(', ')})`;

  return summary;
}
