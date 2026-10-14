import { chromium, Browser, LaunchOptions } from 'playwright';
import { SanitizedLogger } from '../monitoring/logger';

export class BrowserManager {
  private static browserInstance: Browser | null = null;

  static async getBrowser(): Promise<Browser> {
    if (!this.browserInstance || !this.browserInstance.isConnected()) {
      const headless = process.env.HEADLESS !== 'false';
      SanitizedLogger.info(`Launching Playwright Chromium (Headless: ${headless})`);

      const options: LaunchOptions = {
        headless,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
          '--window-size=1280,800',
        ],
      };

      this.browserInstance = await chromium.launch(options);
    }
    return this.browserInstance;
  }

  static async closeBrowser(): Promise<void> {
    if (this.browserInstance) {
      await this.browserInstance.close().catch(() => {});
      this.browserInstance = null;
    }
  }
}
