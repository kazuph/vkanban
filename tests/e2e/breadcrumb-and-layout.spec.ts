import { test, expect } from '@playwright/test';

// Minimal fixtures
const project = {
  id: 'p1',
  name: 'Demo Project',
  git_repo_path: '/tmp/repo',
  setup_script: null,
  dev_script: null,
  cleanup_script: null,
  copy_files: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const tasks = [
  {
    id: 't1',
    project_id: 'p1',
    title: 'Task 1',
    description: 'desc',
    status: 'inreview',
    parent_task_attempt: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    has_in_progress_attempt: false,
    has_merged_attempt: false,
    last_attempt_failed: false,
    profile: 'default',
  },
];

const attempts = [
  {
    id: 'a1',
    task_id: 't1',
    container_ref: null,
    branch: 'feat/test',
    base_branch: 'main',
    profile: 'codex',
    worktree_deleted: false,
    setup_completed_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

test.beforeEach(async ({ page, baseURL }) => {
  // Intercept API calls used by the tasks view
  await page.route('**/api/projects/p1', async (route) => {
    await route.fulfill({ status: 200, json: { success: true, data: project } });
  });

  await page.route('**/api/tasks?project_id=p1', async (route) => {
    await route.fulfill({ status: 200, json: { success: true, data: tasks } });
  });

  await page.route('**/api/task-attempts?task_id=t1', async (route) => {
    await route.fulfill({ status: 200, json: { success: true, data: attempts } });
  });
});

test('shows breadcrumb and does not clip board', async ({ page }) => {
  await page.goto('/projects/p1/tasks');

  // Breadcrumb shows Projects > Project > Tasks
  await expect(page.getByRole('link', { name: 'Projects' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Demo Project' })).toBeVisible();
  await expect(page.getByText('Tasks').first()).toBeVisible();

  // Board headers are visible
  await expect(page.getByText('In Review').first()).toBeVisible();

  // Ensure main board area is at least 60% of viewport height (no clipping)
  const viewportHeight = (await page.viewportSize())!.height;
  const board = page.locator('div[style*="grid-flow-col"], .inline-grid');
  const boardBox = await board.boundingBox();
  expect(boardBox?.height || 0).toBeGreaterThan(viewportHeight * 0.6);

  // Breadcrumb should hug left padding, buttons hug right
  const header = page.locator('nav[aria-label="Breadcrumb"]');
  const headerBox = await header.boundingBox();
  const rightGroup = page.getByRole('button', { name: 'New Task' }).locator('..');
  const rightBox = await rightGroup.boundingBox();
  const viewportWidth = (await page.viewportSize())!.width;
  expect(headerBox?.x || 9999).toBeLessThan(24);
  expect(((rightBox?.x || 0) + (rightBox?.width || 0))).toBeGreaterThan(
    viewportWidth - 24
  );
});

test('hides header on /full route', async ({ page }) => {
  await page.goto('/projects/p1/tasks/t1/attempts/a1/full');

  // Navbar/logo should be hidden on /full
  await expect(page.getByText('VIBE-KANBAN').first()).toHaveCount(0);
});
