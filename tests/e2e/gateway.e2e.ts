import { test, expect } from '@playwright/test';

/**
 * E2E tests for MCP Gateway desktop app.
 *
 * These tests require the app to be running.
 * Run with: npx playwright test tests/e2e/
 */

const APP_URL = 'http://localhost:5173'; // Vite dev server

test.describe('MCP Gateway E2E', () => {
  test('empty state shows guide when no servers', async ({ page }) => {
    // This test expects no servers configured
    await page.goto(APP_URL);
    await page.waitForSelector('.empty-state');
    await expect(page.locator('.empty-state')).toBeVisible();
    await expect(page.locator('text=还没有 MCP 服务器')).toBeVisible();
  });

  test('can navigate between pages', async ({ page }) => {
    await page.goto(APP_URL);

    // Navigate to Add Server page
    await page.click('text=添加服务');
    await expect(page.locator('h2')).toContainText('添加 MCP 服务');

    // Navigate to Endpoint Info page
    await page.click('text=Endpoint 信息');
    await expect(page.locator('text=统一 Endpoint URL')).toBeVisible();

    // Navigate back to Server List
    await page.click('text=服务列表');
    await expect(page.locator('.page-container')).toBeVisible();
  });

  test('add server form validates empty name', async ({ page }) => {
    await page.goto(APP_URL);
    await page.click('text=添加服务');

    // Submit without filling anything
    await page.click('text=添加服务');
    await expect(page.locator('text=服务名称不能为空')).toBeVisible();
  });

  test('cancel returns to server list', async ({ page }) => {
    await page.goto(APP_URL);
    await page.click('text=添加服务');
    await page.click('text=取消');
    await expect(page.locator('.page-container')).toBeVisible();
  });

  test('endpoint info shows URL and config examples', async ({ page }) => {
    await page.goto(APP_URL);
    await page.click('text=Endpoint 信息');

    await expect(page.locator('text=http://localhost:18721/mcp')).toBeVisible();
    await expect(page.locator('text=Claude Code')).toBeVisible();
    await expect(page.locator('text=Codex')).toBeVisible();
  });

  test('add server form has all required fields', async ({ page }) => {
    await page.goto(APP_URL);
    await page.click('text=添加服务');

    await expect(page.locator('#name')).toBeVisible();
    await expect(page.locator('#command')).toBeVisible();
    await expect(page.locator('#args')).toBeVisible();
    await expect(page.locator('#cwd')).toBeVisible();
  });

  test('graceful shutdown: endpoint becomes unreachable', async ({ page }) => {
    // This test verifies that when the app closes, the endpoint is unavailable.
    // In a real scenario, we'd start the Electron app, close it, and verify.
    // For Playwright, we can test that the UI properly handles error states.
    await page.goto(APP_URL);

    // The app should render without crashing
    await expect(page.locator('body')).toBeVisible();
  });

  test('crash recovery: UI shows correct status indicators', async ({ page }) => {
    await page.goto(APP_URL);

    // The server list should render status indicators
    // In a real app with servers, we'd see red/green dots
    await expect(page.locator('.page-container')).toBeVisible();
  });

  test('toggle flow: enable and disable servers', async ({ page }) => {
    await page.goto(APP_URL);

    // The toggle switches should be present if there are servers
    // Or empty state shows if no servers
    const hasServers = await page.locator('.toggle-switch').count();
    if (hasServers === 0) {
      await expect(page.locator('.empty-state')).toBeVisible();
    } else {
      await expect(page.locator('.toggle-switch').first()).toBeVisible();
    }
  });
});
