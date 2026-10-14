import { Browser, BrowserContext, Page } from 'playwright';
import { BrowserManager } from './browser-manager';
import { SanitizedLogger } from '../monitoring/logger';

export class ContextManager {
  static async createIsolatedContext(): Promise<{ context: BrowserContext; page: Page }> {
    const browser = await BrowserManager.getBrowser();

    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      locale: 'en-US',
      timezoneId: 'Asia/Kolkata',
      permissions: ['geolocation'],
    });

    // Default timeout: 30 seconds
    context.setDefaultTimeout(30000);
    context.setDefaultNavigationTimeout(45000);

    const page = await context.newPage();
    return { context, page };
  }

  static async cleanup(context?: BrowserContext, page?: Page): Promise<void> {
    try {
      if (page && !page.isClosed()) {
        await page.close().catch(() => {});
      }
      if (context) {
        await context.close().catch(() => {});
      }
    } catch (err) {
      SanitizedLogger.warn('Error during context cleanup:', err);
    }
  }
}
