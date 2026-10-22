import { chromium, Browser, LaunchOptions } from 'playwright';
import { SanitizedLogger } from '../monitoring/logger';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Resolves the path to the bundled or managed Chromium executable.
 * Prioritizes the application installation directory before any developer cache.
 */
export function resolveChromiumPath(): string | undefined {
  if (process.env.CHROMIUM_EXECUTABLE_PATH && fs.existsSync(process.env.CHROMIUM_EXECUTABLE_PATH)) {
    return process.env.CHROMIUM_EXECUTABLE_PATH;
  }

  const searchCandidates: string[] = [
    // 1. Direct managed installation directory under browsers/
    path.resolve(process.cwd(), 'browsers', 'chromium-1243', 'chrome-win64', 'chrome.exe'),
    path.resolve(process.cwd(), 'browsers', 'chromium-1243', 'chrome-win', 'chrome.exe'),
    path.resolve(__dirname, '..', '..', 'browsers', 'chromium-1243', 'chrome-win64', 'chrome.exe'),
    path.resolve(__dirname, '..', '..', 'browsers', 'chromium-1243', 'chrome-win', 'chrome.exe'),
    path.resolve(__dirname, '..', '..', '..', 'browsers', 'chromium-1243', 'chrome-win64', 'chrome.exe'),
    // 2. PLAYWRIGHT_BROWSERS_PATH environment override if defined
    process.env.PLAYWRIGHT_BROWSERS_PATH
      ? path.resolve(process.env.PLAYWRIGHT_BROWSERS_PATH, 'chromium-1243', 'chrome-win64', 'chrome.exe')
      : '',
    process.env.PLAYWRIGHT_BROWSERS_PATH
      ? path.resolve(process.env.PLAYWRIGHT_BROWSERS_PATH, 'chromium-1243', 'chrome-win', 'chrome.exe')
      : '',
    // 3. Local AppData fallback for development
    process.env.LOCALAPPDATA
      ? path.resolve(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1243', 'chrome-win64', 'chrome.exe')
      : '',
  ].filter(Boolean);

  for (const candidate of searchCandidates) {
    try {
      if (candidate && fs.existsSync(candidate)) {
        return candidate;
      }
    } catch {}
  }

  return undefined;
}

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

      const resolvedExecutable = resolveChromiumPath();
      if (resolvedExecutable) {
        options.executablePath = resolvedExecutable;
        SanitizedLogger.info(`Using managed bundled Chromium: ${resolvedExecutable}`);
      }

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

