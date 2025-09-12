import type { UnifiedLogEntry, ProcessStartPayload } from '@/types/logs';
import type { NormalizedEntry } from 'shared/types';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle } from 'lucide-react';
import ProcessStartCard from '@/components/logs/ProcessStartCard';
import LogEntryRow from '@/components/logs/LogEntryRow';

type Props = {
  header: ProcessStartPayload;
  entries: UnifiedLogEntry[];
  isCollapsed: boolean;
  onToggle: (processId: string) => void;
  hideHeader?: boolean;
  restore?: {
    onRestore: (processId: string) => void;
    restoreProcessId?: string;
    restoreDisabled?: boolean;
    restoreDisabledReason?: string;
  };
  repoUrlBase?: string;
};

export default function ProcessGroup({
  header,
  entries,
  isCollapsed,
  onToggle,
  hideHeader = false,
  restore,
  repoUrlBase,
}: Props) {
  // Derive a concise failure reason if available
  const failureReason: string | null = (() => {
    if (header.status !== 'failed') return null;
    // Prefer normalized error_message entries (from coding agent)
    const normalizedErrors = entries
      .filter((e) => e.channel === 'normalized')
      .map((e) => e.payload as NormalizedEntry)
      .filter((n) => n?.entry_type?.type === 'error_message');
    const lastError = normalizedErrors.length
      ? normalizedErrors[normalizedErrors.length - 1]
      : null;
    if (lastError && lastError.content?.trim()) {
      return lastError.content.trim();
    }

    // Fallback to last non-empty line from STDERR
    const lastStderr = [...entries]
      .reverse()
      .find((e) => e.channel === 'stderr');
    if (lastStderr && typeof lastStderr.payload === 'string') {
      const lines = (lastStderr.payload as string)
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      if (lines.length) return lines[lines.length - 1];
    }

    // Final fallback: show exit code if provided
    if (header.exitCode != null) {
      return `Process exited with code ${header.exitCode}`;
    }
    return null;
  })();

  return (
    <div className="px-4 mt-4">
      {!hideHeader && (
        <ProcessStartCard
          payload={header}
          isCollapsed={isCollapsed}
          onToggle={onToggle}
          onRestore={restore?.onRestore}
          restoreProcessId={restore?.restoreProcessId}
          restoreDisabled={restore?.restoreDisabled}
          restoreDisabledReason={restore?.restoreDisabledReason}
        />
      )}
      {failureReason && (
        <div className="mt-2">
          <Alert variant="destructive" className="py-2 px-3">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {failureReason}
            </AlertDescription>
          </Alert>
        </div>
      )}
      <div className="text-sm">
        {!isCollapsed &&
          entries.length > 0 &&
          entries.map((entry, i) => (
            <LogEntryRow key={entry.id} entry={entry} index={i} repoUrlBase={repoUrlBase} />
          ))}
      </div>
    </div>
  );
}
