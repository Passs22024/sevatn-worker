import { chromium, Browser, BrowserContext, Page } from 'playwright';

export class BrowserManager {
  private browser: Browser | null = null;
  private isHeadless: boolean;

  constructor(headless: boolean = true) {
    this.isHeadless = headless;
  }

  async launch(): Promise<Browser> {
    try {
      this.browser = await chromium.launch({
        headless: this.isHeadless,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
        ],
      });
      return this.browser;
    } catch (err: any) {
      console.warn(`[Browser] Native Playwright launch warning:`, err.message);
      throw err;
    }
  }

  async newContext(): Promise<{ context: BrowserContext; page: Page }> {
    if (!this.browser) {
      await this.launch();
    }

    const context = await this.browser!.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });

    const page = await context.newPage();
    return { context, page };
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}
