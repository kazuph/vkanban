import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';

test('logo and Projects heading are left-aligned', async ({ page }) => {
  await page.goto('/');

  // Ensure the key elements are visible
  const logo = page.getByRole('img', { name: 'VKanban Logo' });
  const heading = page.getByRole('heading', { name: 'Projects', level: 1 });

  await expect(logo).toBeVisible();
  await expect(heading).toBeVisible();

  // Measure left x position of both elements
  const [logoBox, headingBox] = await Promise.all([
    logo.boundingBox(),
    heading.boundingBox(),
  ]);

  if (!logoBox || !headingBox) {
    throw new Error('Failed to measure bounding boxes for alignment check');
  }

  const diff = Math.abs(logoBox.x - headingBox.x);

  // Allow sub-pixel rendering variance
  expect(diff).toBeLessThanOrEqual(1);

  // Save a quick visual slice of the header area for manual inspection
  try {
    await fs.mkdir('test-results', { recursive: true });
    const size = page.viewportSize() ?? { width: 1024, height: 768 };
    await page.screenshot({
      path: 'test-results/projects-header.png',
      clip: { x: 0, y: 0, width: size.width, height: 180 },
    });
  } catch (e) {
    // Non-fatal in CI/local variations
    console.warn('Unable to save header screenshot:', e);
  }
});

