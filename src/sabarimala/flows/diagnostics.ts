import { Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { SanitizedLogger } from '../../monitoring/logger';
import { StageDiagnosticSnapshot, WorkflowStage } from './types';

export class FlowDiagnosticsManager {
  private static readonly DEBUG_DIR = path.resolve(__dirname, '../../../debug');

  /**
   * Captures deep, sanitized diagnostic evidence for any stage failure
   */
  static async captureDiagnostics(
    page: Page,
    stage: WorkflowStage,
    bookingCode: string,
    metadata?: {
      selectedDate?: string;
      selectedRoute?: string;
      additionalInfo?: Record<string, any>;
    },
  ): Promise<StageDiagnosticSnapshot> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const correlationId = `${bookingCode || 'NO-REF'}_${stage}_${timestamp}`;

    let currentUrl = 'N/A';
    let pageTitle = 'N/A';
    let slotCardCount = 0;
    let visibleFormLabels: string[] = [];
    let visibleButtons: string[] = [];
    let errorBanners: string[] = [];
    let screenshotPath: string | undefined;
    let sanitizedHtmlPath: string | undefined;

    try {
      if (page) {
        if (typeof page.url === 'function') currentUrl = page.url();
        if (typeof page.title === 'function') pageTitle = await page.title().catch(() => 'N/A');

        // Ensure debug output directory exists
        if (!fs.existsSync(this.DEBUG_DIR)) {
          await fs.promises.mkdir(this.DEBUG_DIR, { recursive: true }).catch(() => {});
        }

        // 1. Capture non-sensitive screenshot
        screenshotPath = path.join(this.DEBUG_DIR, `${correlationId}.png`);
        if (typeof page.screenshot === 'function') {
          await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {
            screenshotPath = undefined;
          });
        }

        // 2. Count visible slot cards
        slotCardCount = await page
          .locator('.slot-dar-3, .slot-dar-5, .slot-box, .slot-card, div[class*="slot-dar-"], [id^="myName_"]')
          .count()
          .catch(() => 0);

        // 3. Extract visible form labels
        const labels = await page.locator('label, mat-label, .form-label').allInnerTexts().catch(() => []);
        visibleFormLabels = labels.map((l) => l.trim()).filter((l) => l.length > 0 && l.length < 100);

        // 4. Extract visible buttons
        const buttons = await page.locator('button, a.btn, input[type="submit"]').allInnerTexts().catch(() => []);
        visibleButtons = buttons.map((b) => b.trim()).filter((b) => b.length > 0 && b.length < 50);

        // 5. Extract visible error/warning banners
        const alerts = await page
          .locator('.alert-danger, .alert-warning, .mat-error, .error-msg, .toast-error, .swal2-error')
          .allInnerTexts()
          .catch(() => []);
        errorBanners = alerts.map((a) => a.trim()).filter((a) => a.length > 0);

        // 6. Capture sanitized HTML snapshot (strips passwords, OTPs, auth tokens, input values)
        sanitizedHtmlPath = path.join(this.DEBUG_DIR, `${correlationId}_sanitized.html`);
        const rawHtml = await page.content().catch(() => '');
        if (rawHtml) {
          const sanitized = this.sanitizeHtml(rawHtml);
          await fs.promises.writeFile(sanitizedHtmlPath, sanitized, 'utf8').catch(() => {
            sanitizedHtmlPath = undefined;
          });
        }
      }
    } catch (err: any) {
      SanitizedLogger.warn(`[DIAGNOSTICS] Partial diagnostic capture failure: ${err?.message}`);
    }

    const snapshot: StageDiagnosticSnapshot = {
      correlationId,
      stage,
      timestamp: new Date().toISOString(),
      currentUrl,
      pageTitle,
      selectedDate: metadata?.selectedDate,
      selectedRoute: metadata?.selectedRoute,
      slotCardCount,
      visibleFormLabels: visibleFormLabels.slice(0, 15),
      visibleButtons: visibleButtons.slice(0, 15),
      errorBanners: errorBanners.slice(0, 5),
      screenshotPath,
      sanitizedHtmlPath,
    };

    SanitizedLogger.warn(`[DIAGNOSTICS] Stage failure captured: [${stage}] at ${currentUrl} (Slots found: ${slotCardCount})`);
    return snapshot;
  }

  /**
   * Strips all passwords, values of sensitive input fields, session tokens, and identity numbers from HTML
   */
  private static sanitizeHtml(html: string): string {
    return html
      .replace(/<input[^>]*type=["']password["'][^>]*>/gi, '<input type="password" value="[REDACTED]" />')
      .replace(/<input[^>]*formcontrolname=["'](password|otp|token|mobileNumber|username)["'][^>]*>/gi, '<input value="[REDACTED]" />')
      .replace(/([0-9]{4})\s*([0-9]{4})\s*([0-9]{4})/g, 'XXXX-XXXX-$3') // Mask Aadhaar numbers
      .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED]');
  }
}

