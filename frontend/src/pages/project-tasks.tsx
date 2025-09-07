import { useCallback, useEffect, useState, useMemo } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { AlertTriangle, Plus } from 'lucide-react';
import { Loader } from '@/components/ui/loader';
import { projectsApi, tasksApi, attemptsApi } from '@/lib/api';
import { openTaskForm } from '@/lib/openTaskForm';
import { useKeyboardShortcuts } from '@/lib/keyboard-shortcuts';
import { useSearch } from '@/contexts/search-context';
import { useQuery } from '@tanstack/react-query';

import {
  getKanbanSectionClasses,
  getMainContainerClasses,
} from '@/lib/responsive-config';

import TaskKanbanBoard from '@/components/tasks/TaskKanbanBoard';
import { TaskDetailsPanel } from '@/components/tasks/TaskDetailsPanel';
import type { TaskWithAttemptStatus, Project, TaskAttempt } from 'shared/types';
import type { DragEndEvent } from '@/components/ui/shadcn-io/kanban';
import { Breadcrumb } from '@/components/ui/breadcrumb';
import { Link } from 'react-router-dom';
import { useProjectTasks } from '@/hooks/useProjectTasks';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import NiceModal from '@ebay/nice-modal-react';

type Task = TaskWithAttemptStatus;

export function ProjectTasks() {
  const { projectId, taskId, attemptId } = useParams<{
    projectId: string;
    taskId?: string;
    attemptId?: string;
  }>();
  const navigate = useNavigate();
  const location = useLocation();

  // Projects State
  const [project, setProject] = useState<Project | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Helper functions to open task forms
  const handleCreateTask = () => {
    if (project?.id) {
      openTaskForm({ projectId: project.id });
    }
  };

  const handleEditTask = (task: Task) => {
    if (project?.id) {
      openTaskForm({ projectId: project.id, task });
    }
  };

  const handleDuplicateTask = (task: Task) => {
    if (project?.id) {
      openTaskForm({ projectId: project.id, initialTask: task });
    }
  };
  const { query: searchQuery } = useSearch();

  // Panel state
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [isPanelOpen, setIsPanelOpen] = useState(false);

  // Fullscreen state from pathname
  const isFullscreen = location.pathname.endsWith('/full');

  // Attempts fetching (only when task is selected)
  const { data: attempts = [] } = useQuery({
    queryKey: ['taskAttempts', selectedTask?.id],
    queryFn: ({ signal }) => attemptsApi.getAll(selectedTask!.id, signal),
    enabled: !!selectedTask?.id,
    refetchInterval: 5000,
  });

  // Selected attempt logic
  const selectedAttempt = useMemo(() => {
    if (!attempts.length) return null;
    if (attemptId) {
      const found = attempts.find((a) => a.id === attemptId);
      if (found) return found;
    }
    return attempts[0] || null;
  }, [attempts, attemptId]);

  const setSelectedAttempt = useCallback(
    (attempt: TaskAttempt | null) => {
      if (!attempt || !selectedTask) return;
      const baseUrl = `/projects/${projectId}/tasks/${selectedTask.id}/attempts/${attempt.id}`;
      const fullUrl = isFullscreen ? `${baseUrl}/full` : baseUrl;
      navigate(fullUrl, { replace: true });
    },
    [navigate, projectId, selectedTask, isFullscreen]
  );

  const {
    data: tasks = [],
    isLoading: tasksLoading,
    isError: tasksError,
    streamError,
    tasksById,
  } = useProjectTasks(projectId!);

  // Keyboard shortcuts
  useKeyboardShortcuts({
    'Ctrl+N': () => handleCreateNewTask(),
    'Cmd+N': () => handleCreateNewTask(),
  });

  const handleCreateNewTask = useCallback(() => {
    handleCreateTask();
  }, [handleCreateTask]);

  const fetchProject = useCallback(async () => {
    if (!projectId) return;

    try {
      setIsLoading(true);
      const projectData = await projectsApi.getById(projectId);
      setProject(projectData);
      setError(null);
    } catch (err) {
      setError('Failed to load project');
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  const handleClosePanel = useCallback(() => {
    // setIsPanelOpen(false);
    // setSelectedTask(null);
    // Remove task ID from URL when closing panel
    navigate(`/projects/${projectId}/tasks`, { replace: true });
  }, [projectId, navigate]);

  const handleDeleteTask = useCallback(
    (taskId: string) => {
      const task = tasksById[taskId];
      if (task) {
        NiceModal.show('delete-task-confirmation', {
          task,
          projectId: projectId!,
        })
          .then(() => {
            // Task was deleted, close panel if this task was selected
            if (selectedTask?.id === taskId) {
              handleClosePanel();
            }
          })
          .catch(() => {
            // Modal was cancelled - do nothing
          });
      }
    },
    [tasksById, projectId, selectedTask, handleClosePanel]
  );

  const handleEditTaskCallback = useCallback(
    (task: Task) => {
      handleEditTask(task);
    },
    [handleEditTask]
  );

  const handleDuplicateTaskCallback = useCallback(
    (task: Task) => {
      handleDuplicateTask(task);
    },
    [handleDuplicateTask]
  );

  const handleViewTaskDetails = useCallback(
    (task: Task) => {
      setSelectedTask(task);
      setIsPanelOpen(true);
    },
    []
  );

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || !active.data.current) return;

      const draggedTaskId = active.id as string;
      const newStatus = over.id as Task['status'];
      const task = tasksById[draggedTaskId];
      if (!task || task.status === newStatus) return;

      try {
        await tasksApi.update(draggedTaskId, {
          title: task.title,
          description: task.description,
          status: newStatus,
          parent_task_attempt: task.parent_task_attempt,
          image_ids: null,
        });
        // UI will update via SSE stream
      } catch (err) {
        setError('Failed to update task status');
      }
    },
    [tasksById]
  );

  // Setup keyboard shortcuts
  useKeyboardShortcuts({
    navigate,
    currentPath: window.location.pathname,
    hasOpenDialog: false,
    closeDialog: () => {},
    onC: handleCreateNewTask,
  });

  // Initialize project when projectId changes
  useEffect(() => {
    if (projectId) {
      fetchProject();
    }
  }, [fetchProject, projectId]);

  // Handle direct navigation to task details
  useEffect(() => {
    if (taskId && tasks.length > 0) {
      const task = tasks.find((t) => t.id === taskId);
      if (task) {
        setSelectedTask(task);
        setIsPanelOpen(true);
      } else {
        // Task not found, navigate back to project
        navigate(`/projects/${projectId}`, { replace: true });
      }
    } else if (!taskId && (selectedTask || isPanelOpen)) {
      // No task in URL but panel is open, close it
      setSelectedTask(null);
      setIsPanelOpen(false);
    }
  }, [taskId, tasks, projectId, navigate, selectedTask, isPanelOpen]);

  // Auto-fetch project when tasks load if not already loaded
  useEffect(() => {
    if (!project && projectId && tasks.length > 0) {
      fetchProject();
    }
  }, [project, projectId, tasks.length, fetchProject]);

  if (isLoading) {
    return <Loader message="Loading tasks..." size={32} className="py-8" />;
  }

  if (error) {
    return (
      <div className="p-4">
        <Alert>
          <AlertTitle className="flex items-center gap-2">
            <AlertTriangle size="16" />
            Error
          </AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div
      className={`min-h-full ${getMainContainerClasses(isPanelOpen, isFullscreen)}`}
    >
      {!isFullscreen && (
        <div className="w-full border-b bg-background/60 backdrop-blur supports-[backdrop-filter]:bg-background/40">
          <div className="w-full px-3 sm:px-4 py-2">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <Breadcrumb
                className="flex-1 min-w-0"
                items={[
                  { label: 'Projects', to: '/projects' },
                  project
                    ? { label: project.name, to: `/projects/${projectId}` }
                    : { label: '...' },
                  { label: 'Tasks' },
                  selectedTask ? { label: selectedTask.title } : undefined,
                ].filter(Boolean) as any}
              />
              <div className="flex items-center gap-2">
                <Button size="sm" variant="secondary" asChild>
                  <Link to={`/projects/${projectId}`}>Project Settings</Link>
                </Button>
                <Button size="sm" onClick={handleCreateNewTask}>
                  <Plus className="h-4 w-4 mr-2" /> New Task
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {streamError && (
        <Alert className="w-full z-30 xl:sticky xl:top-0">
          <AlertTitle className="flex items-center gap-2">
            <AlertTriangle size="16" />
            Reconnecting
          </AlertTitle>
          <AlertDescription>{streamError}</AlertDescription>
        </Alert>
      )}

      {/* Kanban + Panel Container - uses side-by-side layout on xl+ */}
      <div className="flex-1 min-h-0 xl:flex">
        {/* Left Column - Kanban Section */}
        <div className={getKanbanSectionClasses(isPanelOpen, isFullscreen)}>
          {tasks.length === 0 ? (
            <div className="max-w-7xl mx-auto mt-8">
              <Card>
                <CardContent className="text-center py-8">
                  <p className="text-muted-foreground">
                    No tasks found for this project.
                  </p>
                  <Button className="mt-4" onClick={handleCreateNewTask}>
                    <Plus className="h-4 w-4 mr-2" />
                    Create First Task
                  </Button>
                </CardContent>
              </Card>
            </div>
          ) : (
            <div className="w-full h-full overflow-x-auto">
              <TaskKanbanBoard
                tasks={tasks}
                searchQuery={searchQuery}
                onDragEnd={handleDragEnd}
                onEditTask={handleEditTaskCallback}
                onDeleteTask={handleDeleteTask}
                onDuplicateTask={handleDuplicateTaskCallback}
                onViewTaskDetails={handleViewTaskDetails}
                isPanelOpen={isPanelOpen}
              />
            </div>
          )}
        </div>

        {/* Right Column - Task Details Panel */}
        {isPanelOpen && (
          <TaskDetailsPanel
            task={selectedTask}
            projectHasDevScript={!!project?.dev_script}
            projectId={projectId!}
            onClose={handleClosePanel}
            onEditTask={handleEditTaskCallback}
            onDeleteTask={handleDeleteTask}
            isFullScreen={isFullscreen}
            setFullScreen={
              selectedAttempt
                ? (fullscreen) => {
                    const baseUrl = `/projects/${projectId}/tasks/${selectedTask!.id}/attempts/${selectedAttempt.id}`;
                    const fullUrl = fullscreen ? `${baseUrl}/full` : baseUrl;
                    navigate(fullUrl, { replace: true });
                  }
                : undefined
            }
            selectedAttempt={selectedAttempt}
            attempts={attempts}
            setSelectedAttempt={setSelectedAttempt}
          />
        )}
      </div>
    </div>
  );
}