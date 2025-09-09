import { memo, useEffect, useMemo, useState } from 'react';
import {
  type DragEndEvent,
  KanbanBoard,
  KanbanCards,
  KanbanHeader,
  KanbanProvider,
} from '@/components/ui/shadcn-io/kanban';
import { TaskCard } from './TaskCard';
import type { TaskStatus, TaskWithAttemptStatus } from 'shared/types';
import { useNavigate, useParams } from 'react-router-dom';
import {
  useKeyboardShortcuts,
  useKanbanKeyboardNavigation,
} from '@/lib/keyboard-shortcuts.ts';
import { statusBoardColors, statusLabels } from '@/utils/status-labels';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { openTaskForm } from '@/lib/openTaskForm';

type Task = TaskWithAttemptStatus;

interface TaskKanbanBoardProps {
  tasks: Task[];
  searchQuery?: string;
  onDragEnd: (event: DragEndEvent) => void;
  onEditTask: (task: Task) => void;
  onDeleteTask: (taskId: string) => void;
  onDuplicateTask?: (task: Task) => void;
  onViewTaskDetails: (task: Task) => void;
  isPanelOpen: boolean;
}

const allTaskStatuses: TaskStatus[] = [
  'todo',
  'inprogress',
  'inreview',
  'done',
  'cancelled',
];

function TaskKanbanBoard({
  tasks,
  searchQuery = '',
  onDragEnd,
  onEditTask,
  onDeleteTask,
  onDuplicateTask,
  onViewTaskDetails,
  isPanelOpen,
}: TaskKanbanBoardProps) {
  const { projectId, taskId } = useParams<{
    projectId: string;
    taskId?: string;
  }>();
  const navigate = useNavigate();

  useKeyboardShortcuts({
    navigate,
    currentPath: `/projects/${projectId}/tasks${taskId ? `/${taskId}` : ''}`,
  });

  const [focusedTaskId, setFocusedTaskId] = useState<string | null>(
    taskId || null
  );
  const [focusedStatus, setFocusedStatus] = useState<TaskStatus | null>(null);

  // Memoize filtered tasks
  const filteredTasks = useMemo(() => {
    if (!searchQuery.trim()) {
      return tasks;
    }
    const query = searchQuery.toLowerCase();
    return tasks.filter(
      (task) =>
        task.title.toLowerCase().includes(query) ||
        (task.description && task.description.toLowerCase().includes(query))
    );
  }, [tasks, searchQuery]);

  // Memoize grouped tasks
  const groupedTasks = useMemo(() => {
    const groups: Record<TaskStatus, Task[]> = {} as Record<TaskStatus, Task[]>;
    allTaskStatuses.forEach((status) => {
      groups[status] = [];
    });
    filteredTasks.forEach((task) => {
      const normalizedStatus = task.status.toLowerCase() as TaskStatus;
      if (groups[normalizedStatus]) {
        groups[normalizedStatus].push(task);
      } else {
        groups['todo'].push(task);
      }
    });
    return groups;
  }, [filteredTasks]);

  // Sync focus state with taskId param
  useEffect(() => {
    if (taskId) {
      const found = filteredTasks.find((t) => t.id === taskId);
      if (found) {
        setFocusedTaskId(taskId);
        setFocusedStatus((found.status.toLowerCase() as TaskStatus) || null);
      }
    }
  }, [taskId, filteredTasks]);

  // If no taskId in params, keep last focused, or focus first available
  useEffect(() => {
    if (!taskId && !focusedTaskId) {
      for (const status of allTaskStatuses) {
        if (groupedTasks[status] && groupedTasks[status].length > 0) {
          setFocusedTaskId(groupedTasks[status][0].id);
          setFocusedStatus(status);
          break;
        }
      }
    }
  }, [taskId, focusedTaskId, groupedTasks]);

  // Keyboard navigation handler
  useKanbanKeyboardNavigation({
    focusedTaskId,
    setFocusedTaskId: (id) => {
      setFocusedTaskId(id as string | null);
      if (isPanelOpen) {
        const task = filteredTasks.find((t: any) => t.id === id);
        if (task) {
          onViewTaskDetails(task);
        }
      }
    },
    focusedStatus,
    setFocusedStatus: (status) => setFocusedStatus(status as TaskStatus | null),
    groupedTasks,
    filteredTasks,
    allTaskStatuses,
  });

  return (
    <KanbanProvider onDragEnd={onDragEnd}>
      {Object.entries(groupedTasks).map(([status, statusTasks]) => (
        <KanbanBoard key={status} id={status as TaskStatus}>
          {/* Custom header with optional create buttons for TODO/IN PROGRESS */}
          <KanbanHeader>
            <Card
              className={
                'sticky top-0 z-20 flex shrink-0 items-center gap-2 p-3 border-b border-dashed bg-background'
              }
              style={{
                backgroundImage: `linear-gradient(hsl(var(${statusBoardColors[status as TaskStatus]}) / 0.03), hsl(var(${statusBoardColors[status as TaskStatus]}) / 0.03))`,
              }}
            >
              <div className="flex w-full items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <div
                    className="h-2 w-2 rounded-full"
                    style={{
                      backgroundColor: `hsl(var(${statusBoardColors[status as TaskStatus]}))`,
                    }}
                  />
                  <p className="m-0 text-sm">{statusLabels[status as TaskStatus]}</p>
                </div>
                {(status === 'todo' || status === 'inprogress') && (
                  <div className="flex items-center">
                    {status === 'todo' ? (
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() =>
                          projectId &&
                          openTaskForm({ projectId, defaultAction: 'create' })
                        }
                        className="font-medium h-auto py-0 px-2 leading-none"
                        aria-label="Create new task in To Do"
                      >
                        <Plus className="h-4 w-4 mr-1" />
                        New Task
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() =>
                          projectId && openTaskForm({ projectId, defaultAction: 'start' })
                        }
                        className="font-medium h-auto py-0 px-2 leading-none"
                        aria-label="Create and start task in In Progress"
                      >
                        <Plus className="h-4 w-4 mr-1" />
                        Start Task
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </Card>
          </KanbanHeader>
          <KanbanCards>
            {statusTasks.map((task, index) => (
              <TaskCard
                key={task.id}
                task={task}
                index={index}
                status={status}
                onEdit={onEditTask}
                onDelete={onDeleteTask}
                onDuplicate={onDuplicateTask}
                onViewDetails={onViewTaskDetails}
                isFocused={focusedTaskId === task.id}
                tabIndex={focusedTaskId === task.id ? 0 : -1}
              />
            ))}
          </KanbanCards>
        </KanbanBoard>
      ))}
    </KanbanProvider>
  );
}

export default memo(TaskKanbanBoard);
