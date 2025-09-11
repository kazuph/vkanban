import type { TaskAttempt } from 'shared/types';

export function AttemptList({
  attempts,
  selectedAttempt,
  onSelect,
}: {
  attempts: TaskAttempt[];
  selectedAttempt: TaskAttempt | null;
  onSelect: (a: TaskAttempt) => void;
}) {
  if (!attempts?.length) return null;

  return (
    <div className="overflow-x-auto">
      <div className="flex gap-2 py-2">
        {attempts.map((a, idx) => {
          const num = attempts.length - idx; // newest first -> highest number
          const isActive = selectedAttempt?.id === a.id;
          const ts = new Date(a.created_at);
          const label = `#${num}`;
          return (
            <button
              key={a.id}
              title={`${label} • ${ts.toLocaleString()}`}
              onClick={() => onSelect(a)}
              className={[
                'px-2 py-1 text-xs rounded border transition-colors whitespace-nowrap',
                isActive
                  ? 'bg-accent text-accent-foreground border-accent'
                  : 'bg-background hover:bg-muted border-muted-foreground/30',
              ].join(' ')}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default AttemptList;
