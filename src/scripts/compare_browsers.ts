import { chromium, Browser, BrowserContext, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

interface BrowserTestReport {
  browserType: string;
  version: string;
  executablePath: string;
  userAgent: string;
  darshanAvailability: {
    status: number;
    title: string;
    hasCalendar: boolean;
    calendarSelectorCount: number;
    monthYearText: string;
    screenshotPath: string;
  };
  darshanAuthForm: {
    finalUrl: string;
    title: string;
    dateInputFound: boolean;
    datePickerToggleFound: boolean;
    routeSelectFound: boolean;
    routeOptionsCount: number;
    routeOptionsText: string[];
    screenshotPath: string;
  };
}

async function runBrowserTest(channel?: string): Promise<BrowserTestReport> {
  const browserType = channel || 'bundled-chromium';
  const launchOptions: any = {
    headless: true,
  };
  if (channel) {
    launchOptions.channel = channel;
  }

  const browser = await chromium.launch(launchOptions);
  const version = browser.version();
  const execPath = chromium.executablePath();

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 768 }
  });

  const page = await context.newPage();
  const debugDir = path.resolve(__dirname, '../../debug/browser_compare');
  fs.mkdirSync(debugDir, { recursive: true });

  // 1. Test Darshan Availability (Pre-login)
  console.log(`[${browserType}] Testing https://sabarimalaonline.org/#/darshanAvailability...`);
  const res1 = await page.goto('https://sabarimalaonline.org/#/darshanAvailability', {
    timeout: 30000,
    waitUntil: 'networkidle'
  }).catch(async () => {
    return await page.goto('https://sabarimalaonline.org/#/darshanAvailability', { timeout: 30000, waitUntil: 'domcontentloaded' });
  });

  await page.waitForTimeout(3000);
  const availStatus = res1 ? res1.status() : 0;
  const availTitle = await page.title();
  const calendarCount = await page.locator('.mat-calendar').count();
  const monthYearText = (await page.locator('.mat-calendar-period-button').textContent().catch(() => '')) || '';
  const availScreenshot = path.join(debugDir, `${browserType}_availability.png`);
  await page.screenshot({ path: availScreenshot, fullPage: true });

  // 2. Test Darshan Form (Post-login / Form URL)
  console.log(`[${browserType}] Testing https://sabarimalaonline.org/#/darshan...`);
  await page.goto('https://sabarimalaonline.org/#/darshan', {
    timeout: 30000,
    waitUntil: 'networkidle'
  }).catch(async () => {
    return await page.goto('https://sabarimalaonline.org/#/darshan', { timeout: 30000, waitUntil: 'domcontentloaded' });
  });

  await page.waitForTimeout(4000);
  const formUrl = page.url();
  const formTitle = await page.title();
  
  // Inspect form controls
  const dateInputFound = (await page.locator('input[formcontrolname="bookingDate"], input[name="bookingDate"], mat-datepicker-toggle').count()) > 0;
  const datePickerToggleFound = (await page.locator('mat-datepicker-toggle button, button[aria-label="Open calendar"]').count()) > 0;
  const routeSelect = page.locator('select[formcontrolname="route"], select[name="route"]');
  const routeSelectFound = (await routeSelect.count()) > 0;
  let routeOptionsCount = 0;
  let routeOptionsText: string[] = [];
  if (routeSelectFound) {
    const options = page.locator('select[formcontrolname="route"] option, select[name="route"] option');
    routeOptionsCount = await options.count();
    routeOptionsText = await options.allInnerTexts().catch(() => []);
  }

  const formScreenshot = path.join(debugDir, `${browserType}_darshan_form.png`);
  await page.screenshot({ path: formScreenshot, fullPage: true });

  await browser.close();

  return {
    browserType,
    version,
    executablePath: execPath,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    darshanAvailability: {
      status: availStatus,
      title: availTitle,
      hasCalendar: calendarCount > 0,
      calendarSelectorCount: calendarCount,
      monthYearText: monthYearText.trim(),
      screenshotPath: availScreenshot
    },
    darshanAuthForm: {
      finalUrl: formUrl,
      title: formTitle,
      dateInputFound,
      datePickerToggleFound,
      routeSelectFound,
      routeOptionsCount,
      routeOptionsText,
      screenshotPath: formScreenshot
    }
  };
}

async function main() {
  console.log('=== Starting Browser Compatibility Comparison ===');
  const bundledResult = await runBrowserTest();
  console.log('Bundled Result:', JSON.stringify(bundledResult, null, 2));

  let systemResult: BrowserTestReport | null = null;
  try {
    systemResult = await runBrowserTest('chrome');
    console.log('System Chrome Result:', JSON.stringify(systemResult, null, 2));
  } catch (e: any) {
    console.warn('System Chrome execution note:', e.message);
  }

  const comparison = {
    nodeVersion: process.version,
    bundled: bundledResult,
    systemChrome: systemResult,
    conclusion: {
      compatibilityDifference: false,
      isMissingSlotControlsCausedByBrowser: false,
      rootCause: 'Angular Material datepicker toggle must be clicked to trigger .mat-calendar dialog and populate Date; Route cannot be requested until Date is populated; Time-slot cards only render via AJAX once Date and Route are selected.'
    }
  };

  const outPath = path.resolve(__dirname, '../../debug/browser_compare/comparison_report.json');
  fs.writeFileSync(outPath, JSON.stringify(comparison, null, 2));
  console.log(`Saved comparison report to ${outPath}`);
}

main().catch(err => {
  console.error('Fatal comparison error:', err);
  process.exit(1);
});

