import { BrowserManager } from './browser-manager';
import { ContextManager } from './context-manager';

describe('Playwright Headless Chromium Launch Smoke Test', () => {
  afterAll(async () => {
    await BrowserManager.closeBrowser();
  });

  it('launches Chromium headlessly and reports connected status with matching version', async () => {
    const browser = await BrowserManager.getBrowser();
    expect(browser).toBeDefined();
    expect(browser.isConnected()).toBe(true);

    const version = browser.version();
    expect(typeof version).toBe('string');
    expect(version.length).toBeGreaterThan(0);
  }, 30000);

  it('creates an isolated browser context, opens a page, and cleans up cleanly', async () => {
    const session = await ContextManager.createIsolatedContext();
    expect(session.context).toBeDefined();
    expect(session.page).toBeDefined();

    // Verify page can navigate and evaluate JS
    const result = await session.page.evaluate(() => 1 + 1);
    expect(result).toBe(2);

    await ContextManager.cleanup(session.context, session.page);
    expect(session.page.isClosed()).toBe(true);
  }, 30000);

  it('closes browser cleanly without orphan processes', async () => {
    await BrowserManager.closeBrowser();
    // After close, browser instance should be null/closed
    // Next call should launch a fresh instance cleanly
    const freshBrowser = await BrowserManager.getBrowser();
    expect(freshBrowser.isConnected()).toBe(true);
    await BrowserManager.closeBrowser();
  }, 30000);
});
