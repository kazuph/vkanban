import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { TaskWithAttemptStatus } from 'shared/types';
import MarkdownRenderer from '@/components/ui/markdown-renderer';

interface TaskTitleDescriptionProps {
  task: TaskWithAttemptStatus;
}

export function TaskTitleDescription({ task }: TaskTitleDescriptionProps) {
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
  // Prefer explicit repo base via Vite env; fallback to this app's repo
  const repoUrlBase =
    (typeof import.meta !== 'undefined' &&
      (import.meta as any).env &&
      (import.meta as any).env.VITE_REPO_BASE) ||
    'https://github.com/monocorp-jp/mimamorin-web';

  const shownDescription = useMemo(() => {
    if (!task.description) return '';
    if (isDescriptionExpanded || task.description.length <= 350) {
      return task.description;
    }
    return task.description.slice(0, 350) + '…';
  }, [task.description, isDescriptionExpanded]);

  return (
    <div>
      <h2 className="text-lg font-medium mb-1 line-clamp-2">{task.title}</h2>

      <div className="mt-2">
        <div className="flex items-start gap-2 text-sm text-secondary-foreground">
          {task.description ? (
            <div className="flex-1 min-w-0">
              <MarkdownRenderer
                content={shownDescription}
                repoUrlBase={repoUrlBase}
                className={`break-words ${
                  !isDescriptionExpanded && task.description.length > 350
                    ? 'line-clamp-6'
                    : ''
                }`}
              />
              {task.description.length > 150 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setIsDescriptionExpanded(!isDescriptionExpanded)
                  }
                  className="mt-1 p-0 h-auto text-sm text-secondary-foreground hover:text-foreground"
                >
                  {isDescriptionExpanded ? (
                    <>
                      <ChevronUp className="h-3 w-3 mr-1" />
                      Show less
                    </>
                  ) : (
                    <>
                      <ChevronDown className="h-3 w-3 mr-1" />
                      Show more
                    </>
                  )}
                </Button>
              )}
            </div>
          ) : (
            <p className="italic">No description provided</p>
          )}
        </div>
      </div>
    </div>
  );
}
