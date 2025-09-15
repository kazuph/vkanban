// Import all necessary types from shared types

import {
  ApiResponse,
  BranchStatus,
  CheckTokenResponse,
  Config,
  CommitInfo,
  CreateFollowUpAttempt,
  CreateGitHubPrRequest,
  CreateTask,
  CreateTaskAttemptBody,
  CreateTaskTemplate,
  DeviceFlowStartResponse,
  DevicePollStatus,
  DirectoryListResponse,
  DirectoryEntry,
  EditorType,
  ExecutionProcess,
  GitBranch,
  Project,
  CreateProject,
  RebaseTaskAttemptRequest,
  RepositoryInfo,
  SearchResult,
  Task,
  TaskAttempt,
  TaskTemplate,
  TaskWithAttemptStatus,
  UpdateProject,
  UpdateTask,
  UpdateTaskTemplate,
  UserSystemInfo,
  GitHubServiceError,
  McpServerQuery,
  UpdateMcpServersBody,
  GetMcpServerResponse,
  ImageResponse,
  RestoreAttemptRequest,
  RestoreAttemptResult,
} from 'shared/types';

// Re-export types for convenience
export type { RepositoryInfo } from 'shared/types';
// Local-only API types for endpoints not currently included in shared/types
export type TaskPrStatus = {
  task_id: string;
  has_open_pr: boolean;
  open_pr_url: string | null;
  latest_pr_status?: 'open' | 'merged' | 'closed' | 'unknown' | null;
  latest_pr_url?: string | null;
  // Added server field: latest attempt branch (if any)
  branch?: string | null;
};

export class ApiError<E = unknown> extends Error {
  public status?: number;
  public error_data?: E;

  constructor(
    message: string,
    public statusCode?: number,
    public response?: Response,
    error_data?: E
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = statusCode;
    this.error_data = error_data;
  }
}

export const makeRequest = async (url: string, options: RequestInit = {}) => {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  const attempt = async () =>
    fetch(url, {
      ...options,
      headers,
    });

  // Simple resilience for dev hot-reloads where the backend briefly restarts
  // Retry a few times on network errors (e.g., ECONNREFUSED)
  const delays = [250, 500, 1000];
  for (let i = 0; i < delays.length; i++) {
    try {
      return await attempt();
    } catch (e: any) {
      // Only retry on fetch/network errors
      if (i === delays.length - 1) throw e;
      await new Promise((r) => setTimeout(r, delays[i]));
    }
  }
  // Fallback (should never hit)
  return attempt();
};

export interface FollowUpResponse {
  message: string;
  actual_attempt_id: string;
  created_new_attempt: boolean;
}

// Result type for endpoints that need typed errors
export type Result<T, E> =
  | { success: true; data: T }
  | { success: false; error: E | undefined; message?: string };

// Special handler for Result-returning endpoints
const handleApiResponseAsResult = async <T, E>(
  response: Response
): Promise<Result<T, E>> => {
  if (!response.ok) {
    // HTTP error - no structured error data
    let errorMessage = `Request failed with status ${response.status}`;

    try {
      const errorData = await response.json();
      if (errorData.message) {
        errorMessage = errorData.message;
      }
    } catch {
      errorMessage = response.statusText || errorMessage;
    }

    return {
      success: false,
      error: undefined,
      message: errorMessage,
    };
  }

  const result: ApiResponse<T, E> = await response.json();

  if (!result.success) {
    return {
      success: false,
      error: result.error_data || undefined,
      message: result.message || undefined,
    };
  }

  return { success: true, data: result.data as T };
};

const handleApiResponse = async <T, E = T>(response: Response): Promise<T> => {
  if (!response.ok) {
    let errorMessage = `Request failed with status ${response.status}`;

    try {
      const errorData = await response.json();
      if (errorData.message) {
        errorMessage = errorData.message;
      }
    } catch {
      // Fallback to status text if JSON parsing fails
      errorMessage = response.statusText || errorMessage;
    }

    console.error('[API Error]', {
      message: errorMessage,
      status: response.status,
      response,
      endpoint: response.url,
      timestamp: new Date().toISOString(),
    });
    throw new ApiError<E>(errorMessage, response.status, response);
  }

  const result: ApiResponse<T, E> = await response.json();

  if (!result.success) {
    // Check for error_data first (structured errors), then fall back to message
    if (result.error_data) {
      console.error('[API Error with data]', {
        error_data: result.error_data,
        message: result.message,
        status: response.status,
        response,
        endpoint: response.url,
        timestamp: new Date().toISOString(),
      });
      // Throw a properly typed error with the error data
      throw new ApiError<E>(
        result.message || 'API request failed',
        response.status,
        response,
        result.error_data
      );
    }

    console.error('[API Error]', {
      message: result.message || 'API request failed',
      status: response.status,
      response,
      endpoint: response.url,
      timestamp: new Date().toISOString(),
    });
    throw new ApiError<E>(
      result.message || 'API request failed',
      response.status,
      response
    );
  }

  return result.data as T;
};

// Project Management APIs
export const projectsApi = {
  getAll: async (signal?: AbortSignal): Promise<Project[]> => {
    const response = await makeRequest('/api/projects', { signal });
    return handleApiResponse<Project[]>(response);
  },

  getById: async (id: string, signal?: AbortSignal): Promise<Project> => {
    const response = await makeRequest(`/api/projects/${id}`, { signal });
    return handleApiResponse<Project>(response);
  },

  create: async (data: CreateProject): Promise<Project> => {
    const response = await makeRequest('/api/projects', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return handleApiResponse<Project>(response);
  },

  update: async (id: string, data: UpdateProject): Promise<Project> => {
    const response = await makeRequest(`/api/projects/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    return handleApiResponse<Project>(response);
  },

  delete: async (id: string): Promise<void> => {
    const response = await makeRequest(`/api/projects/${id}`, {
      method: 'DELETE',
    });
    return handleApiResponse<void>(response);
  },

  openEditor: async (id: string, editorType?: EditorType): Promise<void> => {
    const requestBody: any = {};
    if (editorType) requestBody.editor_type = editorType;

    const response = await makeRequest(`/api/projects/${id}/open-editor`, {
      method: 'POST',
      body: JSON.stringify(
        Object.keys(requestBody).length > 0 ? requestBody : null
      ),
    });
    return handleApiResponse<void>(response);
  },

  getBranches: async (id: string, signal?: AbortSignal): Promise<GitBranch[]> => {
    const response = await makeRequest(`/api/projects/${id}/branches`, { signal });
    return handleApiResponse<GitBranch[]>(response);
  },

  searchFiles: async (
    id: string,
    query: string,
    mode?: string,
    options?: RequestInit
  ): Promise<SearchResult[]> => {
    const modeParam = mode ? `&mode=${encodeURIComponent(mode)}` : '';
    const response = await makeRequest(
      `/api/projects/${id}/search?q=${encodeURIComponent(query)}${modeParam}`,
      options
    );
    return handleApiResponse<SearchResult[]>(response);
  },
};

// Task Management APIs
export const tasksApi = {
  getAll: async (
    projectId: string,
    signal?: AbortSignal
  ): Promise<TaskWithAttemptStatus[]> => {
    const response = await makeRequest(`/api/tasks?project_id=${projectId}`, {
      signal,
    });
    return handleApiResponse<TaskWithAttemptStatus[]>(response);
  },

  // PR status map per task in a project
  getPrStatus: async (
    projectId: string,
    signal?: AbortSignal
  ): Promise<TaskPrStatus[]> => {
    const response = await makeRequest(
      `/api/tasks/pr-status?project_id=${projectId}`,
      { signal }
    );
    return handleApiResponse<TaskPrStatus[]>(response);
  },

  getById: async (taskId: string): Promise<Task> => {
    const response = await makeRequest(`/api/tasks/${taskId}`);
    return handleApiResponse<Task>(response);
  },

  create: async (data: CreateTask): Promise<Task> => {
    const response = await makeRequest(`/api/tasks`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return handleApiResponse<Task>(response);
  },

  createAndStart: async (data: CreateTask): Promise<TaskWithAttemptStatus> => {
    const response = await makeRequest(`/api/tasks/create-and-start`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return handleApiResponse<TaskWithAttemptStatus>(response);
  },

  update: async (taskId: string, data: UpdateTask): Promise<Task> => {
    const response = await makeRequest(`/api/tasks/${taskId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    return handleApiResponse<Task>(response);
  },

  delete: async (taskId: string): Promise<void> => {
    const response = await makeRequest(`/api/tasks/${taskId}`, {
      method: 'DELETE',
    });
    return handleApiResponse<void>(response);
  },
};

// Task Attempts APIs
export const attemptsApi = {
  getChildren: async (attemptId: string, signal?: AbortSignal): Promise<Task[]> => {
    const response = await makeRequest(
      `/api/task-attempts/${attemptId}/children`,
      { signal }
    );
    return handleApiResponse<Task[]>(response);
  },

  getAll: async (taskId: string, signal?: AbortSignal): Promise<TaskAttempt[]> => {
    const response = await makeRequest(`/api/task-attempts?task_id=${taskId}`, { signal });
    return handleApiResponse<TaskAttempt[]>(response);
  },

  create: async (data: CreateTaskAttemptBody): Promise<TaskAttempt> => {
    const response = await makeRequest(`/api/task-attempts`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return handleApiResponse<TaskAttempt>(response);
  },

  stop: async (attemptId: string): Promise<void> => {
    const response = await makeRequest(`/api/task-attempts/${attemptId}/stop`, {
      method: 'POST',
    });
    return handleApiResponse<void>(response);
  },

  restore: async (
    attemptId: string,
    processId: string,
    opts?: { forceWhenDirty?: boolean; performGitReset?: boolean }
  ): Promise<RestoreAttemptResult> => {
    const body: RestoreAttemptRequest = {
      process_id: processId,
      force_when_dirty: opts?.forceWhenDirty ?? false,
      perform_git_reset: opts?.performGitReset ?? true,
    } as any;
    const response = await makeRequest(
      `/api/task-attempts/${attemptId}/restore`,
      {
        method: 'POST',
        body: JSON.stringify(body),
      }
    );
    return handleApiResponse<RestoreAttemptResult>(response);
  },

  followUp: async (
    attemptId: string,
    data: CreateFollowUpAttempt
  ): Promise<void> => {
    const response = await makeRequest(
      `/api/task-attempts/${attemptId}/follow-up`,
      {
        method: 'POST',
        body: JSON.stringify(data),
      }
    );
    return handleApiResponse<void>(response);
  },

  exportPlanToIssue: async (
    attemptId: string,
    data: { title: string; plan_markdown: string }
  ): Promise<{ url: string; number: number }> => {
    const response = await makeRequest(
      `/api/task-attempts/${attemptId}/plan-to-issue`,
      {
        method: 'POST',
        body: JSON.stringify(data),
      }
    );
    return handleApiResponse<{ url: string; number: number }>(response);
  },

  deleteFile: async (
    attemptId: string,
    fileToDelete: string
  ): Promise<void> => {
    const response = await makeRequest(
      `/api/task-attempts/${attemptId}/delete-file?file_path=${encodeURIComponent(
        fileToDelete
      )}`,
      {
        method: 'POST',
      }
    );
    return handleApiResponse<void>(response);
  },

  openEditor: async (
    attemptId: string,
    editorType?: EditorType,
    filePath?: string
  ): Promise<void> => {
    const requestBody: any = {};
    if (editorType) requestBody.editor_type = editorType;
    if (filePath) requestBody.file_path = filePath;

    const response = await makeRequest(
      `/api/task-attempts/${attemptId}/open-editor`,
      {
        method: 'POST',
        body: JSON.stringify(
          Object.keys(requestBody).length > 0 ? requestBody : null
        ),
      }
    );
    return handleApiResponse<void>(response);
  },

  getBranchStatus: async (attemptId: string, signal?: AbortSignal): Promise<BranchStatus> => {
    const response = await makeRequest(
      `/api/task-attempts/${attemptId}/branch-status`,
      { signal }
    );
    return handleApiResponse<BranchStatus>(response);
  },

  merge: async (attemptId: string): Promise<void> => {
    const response = await makeRequest(
      `/api/task-attempts/${attemptId}/merge`,
      {
        method: 'POST',
      }
    );
    return handleApiResponse<void>(response);
  },

  push: async (attemptId: string): Promise<void> => {
    const response = await makeRequest(`/api/task-attempts/${attemptId}/push`, {
      method: 'POST',
    });
    return handleApiResponse<void>(response);
  },

  rebase: async (
    attemptId: string,
    data: RebaseTaskAttemptRequest
  ): Promise<void> => {
    const response = await makeRequest(
      `/api/task-attempts/${attemptId}/rebase`,
      {
        method: 'POST',
        body: JSON.stringify(data),
      }
    );
    return handleApiResponse<void>(response);
  },

  createPR: async (
    attemptId: string,
    data: CreateGitHubPrRequest
  ): Promise<Result<string, GitHubServiceError>> => {
    const response = await makeRequest(`/api/task-attempts/${attemptId}/pr`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return handleApiResponseAsResult<string, GitHubServiceError>(response);
  },

  // Best-effort: if an open PR already exists for the attempt's branch,
  // link it in DB (if needed), open it in the browser, and return its URL.
  // If none exists, returns { success: false } so the caller can open the dialog.
  openExistingPRIfAny: async (
    attemptId: string
  ): Promise<Result<string, never>> => {
    const response = await makeRequest(
      `/api/task-attempts/${attemptId}/pr/open-existing`,
      { method: 'POST' }
    );
    return handleApiResponseAsResult<string, never>(response);
  },

  updateBranch: async (
    attemptId: string,
    branch: string
  ): Promise<void> => {
    const response = await makeRequest(
      `/api/task-attempts/${attemptId}/branch`,
      { method: 'POST', body: JSON.stringify({ branch }) }
    );
    return handleApiResponse<void>(response);
  },

  startDevServer: async (attemptId: string): Promise<void> => {
    const response = await makeRequest(
      `/api/task-attempts/${attemptId}/start-dev-server`,
      {
        method: 'POST',
      }
    );
    return handleApiResponse<void>(response);
  },
  
  delete: async (attemptId: string): Promise<void> => {
    const response = await makeRequest(`/api/task-attempts/${attemptId}`, {
      method: 'DELETE',
    });
    return handleApiResponse<void>(response);
  },
};

// Extra helpers
export const commitsApi = {
  getInfo: async (attemptId: string, sha: string): Promise<CommitInfo> => {
    const response = await makeRequest(
      `/api/task-attempts/${attemptId}/commit-info?sha=${encodeURIComponent(
        sha
      )}`
    );
    return handleApiResponse<CommitInfo>(response);
  },
  compareToHead: async (
    attemptId: string,
    sha: string
  ): Promise<{
    head_oid: string;
    target_oid: string;
    ahead_from_head: number;
    behind_from_head: number;
    is_linear: boolean;
  }> => {
    const response = await makeRequest(
      `/api/task-attempts/${attemptId}/commit-compare?sha=${encodeURIComponent(
        sha
      )}`
    );
    return handleApiResponse(response);
  },
};

// Execution Process APIs
export const executionProcessesApi = {
  getExecutionProcesses: async (
    attemptId: string,
    signal?: AbortSignal
  ): Promise<ExecutionProcess[]> => {
    const response = await makeRequest(
      `/api/execution-processes?task_attempt_id=${attemptId}`,
      { signal }
    );
    return handleApiResponse<ExecutionProcess[]>(response);
  },

  getDetails: async (processId: string, signal?: AbortSignal): Promise<ExecutionProcess> => {
    const response = await makeRequest(`/api/execution-processes/${processId}`, { signal });
    return handleApiResponse<ExecutionProcess>(response);
  },

  stopExecutionProcess: async (processId: string): Promise<void> => {
    const response = await makeRequest(
      `/api/execution-processes/${processId}/stop`,
      {
        method: 'POST',
      }
    );
    return handleApiResponse<void>(response);
  },
};

// File System APIs
export const fileSystemApi = {
  list: async (path?: string): Promise<DirectoryListResponse> => {
    const queryParam = path ? `?path=${encodeURIComponent(path)}` : '';
    const response = await makeRequest(
      `/api/filesystem/directory${queryParam}`
    );
    return handleApiResponse<DirectoryListResponse>(response);
  },

  listGitRepos: async (path?: string): Promise<DirectoryEntry[]> => {
    const queryParam = path ? `?path=${encodeURIComponent(path)}` : '';
    const response = await makeRequest(
      `/api/filesystem/git-repos${queryParam}`
    );
    return handleApiResponse<DirectoryEntry[]>(response);
  },
};

// Config APIs (backwards compatible)
export const configApi = {
  getConfig: async (): Promise<UserSystemInfo> => {
    const response = await makeRequest('/api/info');
    return handleApiResponse<UserSystemInfo>(response);
  },
  saveConfig: async (config: Config): Promise<Config> => {
    const response = await makeRequest('/api/config', {
      method: 'PUT',
      body: JSON.stringify(config),
    });
    return handleApiResponse<Config>(response);
  },
};

// GitHub Device Auth APIs
export const githubAuthApi = {
  checkGithubToken: async (): Promise<CheckTokenResponse> => {
    const response = await makeRequest('/api/auth/github/check');
    return handleApiResponse<CheckTokenResponse>(response);
  },
  start: async (): Promise<DeviceFlowStartResponse> => {
    const response = await makeRequest('/api/auth/github/device/start', {
      method: 'POST',
    });
    return handleApiResponse<DeviceFlowStartResponse>(response);
  },
  poll: async (): Promise<DevicePollStatus> => {
    const response = await makeRequest('/api/auth/github/device/poll', {
      method: 'POST',
    });
    return handleApiResponse<DevicePollStatus>(response);
  },
};

// GitHub APIs (only available in cloud mode)
export const githubApi = {
  listRepositories: async (page: number = 1): Promise<RepositoryInfo[]> => {
    const response = await makeRequest(`/api/github/repositories?page=${page}`);
    return handleApiResponse<RepositoryInfo[]>(response);
  },
  // createProjectFromRepository: async (
  //   data: CreateProjectFromGitHub
  // ): Promise<Project> => {
  //   const response = await makeRequest('/api/projects/from-github', {
  //     method: 'POST',
  //     body: JSON.stringify(data, (_key, value) =>
  //       typeof value === 'bigint' ? Number(value) : value
  //     ),
  //   });
  //   return handleApiResponse<Project>(response);
  // },
};

// Task Templates APIs
export const templatesApi = {
  list: async (signal?: AbortSignal): Promise<TaskTemplate[]> => {
    const response = await makeRequest('/api/templates', { signal });
    return handleApiResponse<TaskTemplate[]>(response);
  },

  listGlobal: async (signal?: AbortSignal): Promise<TaskTemplate[]> => {
    const response = await makeRequest('/api/templates?global=true', { signal });
    return handleApiResponse<TaskTemplate[]>(response);
  },

  listByProject: async (projectId: string, signal?: AbortSignal): Promise<TaskTemplate[]> => {
    const response = await makeRequest(
      `/api/templates?project_id=${projectId}`,
      { signal }
    );
    return handleApiResponse<TaskTemplate[]>(response);
  },

  get: async (templateId: string, signal?: AbortSignal): Promise<TaskTemplate> => {
    const response = await makeRequest(`/api/templates/${templateId}`, { signal });
    return handleApiResponse<TaskTemplate>(response);
  },

  create: async (data: CreateTaskTemplate): Promise<TaskTemplate> => {
    const response = await makeRequest('/api/templates', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return handleApiResponse<TaskTemplate>(response);
  },

  update: async (
    templateId: string,
    data: UpdateTaskTemplate
  ): Promise<TaskTemplate> => {
    const response = await makeRequest(`/api/templates/${templateId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    return handleApiResponse<TaskTemplate>(response);
  },

  delete: async (templateId: string): Promise<void> => {
    const response = await makeRequest(`/api/templates/${templateId}`, {
      method: 'DELETE',
    });
    return handleApiResponse<void>(response);
  },
};

// MCP Servers APIs
export const mcpServersApi = {
  load: async (query: McpServerQuery): Promise<GetMcpServerResponse> => {
    const params = new URLSearchParams(query);
    const response = await makeRequest(`/api/mcp-config?${params.toString()}`);
    return handleApiResponse<GetMcpServerResponse>(response);
  },
  save: async (
    query: McpServerQuery,
    data: UpdateMcpServersBody
  ): Promise<void> => {
    const params = new URLSearchParams(query);
    // params.set('profile', profile);
    const response = await makeRequest(`/api/mcp-config?${params.toString()}`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const errorData = await response.json();
      console.error('[API Error] Failed to save MCP servers', {
        message: errorData.message,
        status: response.status,
        response,
        timestamp: new Date().toISOString(),
      });
      throw new ApiError(
        errorData.message || 'Failed to save MCP servers',
        response.status,
        response
      );
    }
  },
};

// Profiles API
export const profilesApi = {
  load: async (): Promise<{ content: string; path: string }> => {
    const response = await makeRequest('/api/profiles');
    return handleApiResponse<{ content: string; path: string }>(response);
  },
  save: async (content: string): Promise<string> => {
    const response = await makeRequest('/api/profiles', {
      method: 'PUT',
      body: content,
      headers: {
        'Content-Type': 'application/json',
      },
    });
    return handleApiResponse<string>(response);
  },
};

// Images API
export const imagesApi = {
  upload: async (file: File): Promise<ImageResponse> => {
    const formData = new FormData();
    formData.append('image', file);

    const response = await fetch('/api/images/upload', {
      method: 'POST',
      body: formData,
      credentials: 'include',
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new ApiError(
        `Failed to upload image: ${errorText}`,
        response.status,
        response
      );
    }

    return handleApiResponse<ImageResponse>(response);
  },

  delete: async (imageId: string): Promise<void> => {
    const response = await makeRequest(`/api/images/${imageId}`, {
      method: 'DELETE',
    });
    return handleApiResponse<void>(response);
  },

  getTaskImages: async (taskId: string, signal?: AbortSignal): Promise<ImageResponse[]> => {
    const response = await makeRequest(`/api/images/task/${taskId}`, { signal });
    return handleApiResponse<ImageResponse[]>(response);
  },

  getImageUrl: (imageId: string): string => {
    return `/api/images/${imageId}/file`;
  },
};
