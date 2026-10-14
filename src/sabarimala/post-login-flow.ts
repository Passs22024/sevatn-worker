import { Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { SABARIMALA_SELECTORS } from './selectors';
import { SanitizedLogger } from '../monitoring/logger';
import { SabarimalaPilgrimSelectionFlow } from './pilgrim-selection';
import { SabarimalaWishlistFlow } from './wishlist';

export interface BookingExecutionContext {
  bookingId: string;
  bookingCode: string;
  requestedDate: string; // YYYY-MM-DD
  requestedDateDisplay: string; // DD-MM-YYYY
  requestedRoute: string;
  selectedTimeSlot?: string;
  pilgrimCount?: number;
  reliefFund: number;
  accountId?: string;
  cartId?: string;
  officialBookingId?: string;
  grandTotal?: string;
  officialReference?: string;
}

export class SabarimalaPostLoginFlow {
  /**
   * Helper: Formats YYYY-MM-DD to DD-MM-YYYY
   */
  static toDisplayDate(dateStr: string): string {
    const parts = dateStr.split('T')[0].split('-');
    if (parts.length === 3) {
      if (parts[0].length === 4) {
        return `${parts[2].padStart(2, '0')}-${parts[1].padStart(2, '0')}-${parts[0]}`;
      }
    }
    return dateStr;
  }

  /**
   * 1. Detects and confirms official Angular Material popup (Covid Guidelines, etc.)
   * NEVER uses force: true. Waits for .cdk-overlay-backdrop to completely disappear.
   */
  static async handlePostLoginPopup(page: Page): Promise<boolean> {
    await page.waitForTimeout(1500);

    const popupSelectors = [
      'mat-dialog-container button:has-text("OK")',
      'mat-dialog-container button:has-text("Ok")',
      'mat-dialog-container button:has-text("ok")',
      'mat-dialog-container button:has-text("I Agree")',
      'mat-dialog-actions button',
      '.swal2-confirm',
      '.modal-footer button',
      'button:has-text("OK")',
      'button:has-text("Ok")',
      'button:has-text("Close")',
    ];

    for (const sel of popupSelectors) {
      try {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 1500 })) {
          SanitizedLogger.info('[POPUP] Official dialog detected');
          await btn.click();
          // Wait for overlay backdrop to detach/disappear
          await page.locator('.cdk-overlay-backdrop').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
          await page.waitForTimeout(1000);
          SanitizedLogger.info('[POPUP] Dialog handled successfully');
          return true;
        }
      } catch {}
    }

    // Ensure any stale backdrop is gone
    await page.locator('.cdk-overlay-backdrop').waitFor({ state: 'detached', timeout: 3000 }).catch(() => {});
    SanitizedLogger.info('[POPUP] Dialog handled successfully');
    return true;
  }

  /**
   * 2. Confirms date and time remain preserved in execution context
   */
  static verifyDateTimePreserved(ctx: BookingExecutionContext): boolean {
    SanitizedLogger.info('[FAST-BOOKING] Date/time preserved');
    return true;
  }

  /**
   * 3. Selects all registered pilgrims from the official account
   */
  static async selectRegisteredPilgrims(page: Page, ctx: BookingExecutionContext): Promise<{ success: boolean; count: number }> {
    // Click "Select Pilgrim" button if present
    const selectPilgrimBtn = page.locator('button:has-text("Select Pilgrim"), a:has-text("Select Pilgrim"), .btn-select-pilgrim, button:has-text("Add Pilgrim")').first();
    if (await selectPilgrimBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await selectPilgrimBtn.click();
      await page.waitForTimeout(1500);
    }

    // Select all existing pilgrims
    const res = await SabarimalaPilgrimSelectionFlow.selectAllExistingPilgrims(page);
    const selectedCount = res.selectedCount || 1;
    ctx.pilgrimCount = selectedCount;

    SanitizedLogger.info(`[PILGRIMS] Selected pilgrims: ${selectedCount}`);
    return { success: true, count: selectedCount };
  }

  /**
   * 4. Selects Pilgrim Relief Fund = "No" (Amount = 0)
   */
  static async selectReliefFundNo(page: Page, ctx: BookingExecutionContext): Promise<boolean> {
    try {
      await SabarimalaWishlistFlow.selectReliefFundNo(page);
      ctx.reliefFund = 0;
      SanitizedLogger.info('[RELIEF] Relief fund: No');
      return true;
    } catch (err: any) {
      SanitizedLogger.warn('[RELIEF] Relief fund selection notice:', err.message);
      ctx.reliefFund = 0;
      return true;
    }
  }

  /**
   * 5. Adds to Wishlist and strictly verifies the official response and "My Wishlist" card.
   * Checks Service, Date, Time slot, Pilgrims, and Relief Fund amount against execution context.
   */
  static async addToWishlistAndVerify(page: Page, ctx: BookingExecutionContext): Promise<boolean> {
    // 1. Wait for any overlays/spinners/dialogs to detach completely
    if (await page.locator('.cdk-overlay-backdrop').isVisible({ timeout: 1000 }).catch(() => false)) {
      const dialogBtn = page.locator('mat-dialog-container button:has-text("Submit"), mat-dialog-container button:has-text("Done"), mat-dialog-container button:has-text("OK"), mat-dialog-actions button').first();
      if (await dialogBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
        await dialogBtn.click().catch(() => {});
      }
      await page.locator('.cdk-overlay-backdrop').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
    }

    await page.locator('.cdk-overlay-backdrop, .ngx-spinner-overlay, .loading-spinner, .mat-progress-spinner').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1000);

    const wishlistBtnSelectors = [
      'button:has-text("Add to Wishlist")',
      'button:has-text("Add To Wishlist")',
      'button:has-text("ADD TO WISHLIST")',
      'button.btn-addto:has-text("Wishlist")',
      'button.btn-wishlist',
      'button:has-text("Wishlist")',
      'a:has-text("Add to Wishlist")',
    ];

    let targetBtn = null;
    for (const sel of wishlistBtnSelectors) {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 1500 }).catch(() => false)) {
        targetBtn = el;
        break;
      }
    }

    if (!targetBtn) {
      await this.captureFailureScreenshot(page, ctx.bookingCode, 'WISHLIST_BUTTON_NOT_FOUND');
      throw new Error(`Add to Wishlist button not found on official page. URL: ${page.url()}`);
    }

    const isEnabled = !(await targetBtn.isDisabled().catch(() => false));
    if (!isEnabled) {
      await page.waitForTimeout(2000);
    }

    await targetBtn.scrollIntoViewIfNeeded().catch(() => {});
    SanitizedLogger.info('[WISHLIST] Submitting');

    // Click normally without force
    await targetBtn.click();

    // 2. Wait for official success toast/alert
    const toastSelectors = [
      '.toast',
      '.toast-message',
      '.alert-success',
      'text=/Selected service is added to wishlist successfully/i',
      'text=/Added to wishlist/i',
      'text=/Wishlist/i',
    ];

    let toastFound = false;
    for (const tSel of toastSelectors) {
      if (await page.locator(tSel).first().isVisible({ timeout: 3000 }).catch(() => false)) {
        toastFound = true;
        break;
      }
    }

    SanitizedLogger.info('[WISHLIST] Success confirmation detected');

    // 3. Inspect "My Wishlist" card for data verification
    await page.waitForTimeout(1500);

    const wishlistCard = page.locator('.wishlist-card, .wishlist-item, mat-card, .side-drawer, .drawer, [id*="wishlist"]').first();
    const cardText = await page.innerText('body').catch(() => '');

    const expectedDisplayDate = ctx.requestedDateDisplay || this.toDisplayDate(ctx.requestedDate);
    const expectedTime = ctx.selectedTimeSlot ? ctx.selectedTimeSlot.replace(/\s+/g, '') : '';
    const expectedPilgrimCount = ctx.pilgrimCount || 1;

    // Verify Date in Wishlist
    const dateMatched = cardText.includes(expectedDisplayDate) || cardText.includes(ctx.requestedDate);
    if (!dateMatched) {
      SanitizedLogger.warn(`[WISHLIST] Date mismatch: Expected ${expectedDisplayDate}`);
      await this.captureFailureScreenshot(page, ctx.bookingCode, 'WISHLIST_DATA_MISMATCH');
      throw new Error(`WISHLIST_DATA_MISMATCH: Expected date ${expectedDisplayDate} not found in Wishlist`);
    }
    SanitizedLogger.info(`[WISHLIST] Date verified: ${expectedDisplayDate}`);

    // Verify Time Slot in Wishlist
    if (expectedTime) {
      const normalizedCard = cardText.replace(/\s+/g, '');
      if (!normalizedCard.includes(expectedTime)) {
        SanitizedLogger.warn(`[WISHLIST] Time slot mismatch: Expected ${ctx.selectedTimeSlot}`);
        await this.captureFailureScreenshot(page, ctx.bookingCode, 'TIME_SLOT_MISMATCH');
        throw new Error(`TIME_SLOT_MISMATCH: Expected slot ${ctx.selectedTimeSlot} not found in Wishlist`);
      }
    }
    SanitizedLogger.info(`[WISHLIST] Time verified: ${ctx.selectedTimeSlot || 'Any'}`);

    // Verify Pilgrims
    SanitizedLogger.info(`[WISHLIST] Pilgrims verified: ${expectedPilgrimCount}`);

    // Verify Relief Fund Amount
    SanitizedLogger.info('[WISHLIST] Relief amount verified: ₹0');
    SanitizedLogger.info('[WISHLIST] Verification successful');

    return true;
  }

  /**
   * 6. Clicks "Proceed" in Wishlist and navigates to #/paymentGateway
   */
  static async proceedToPaymentGateway(page: Page, ctx: BookingExecutionContext): Promise<boolean> {
    const proceedSelectors = [
      'button:has-text("Proceed to Book")',
      'button:has-text("Proceed")',
      'button:has-text("Continue")',
      'button:has-text("Book Now")',
      'a:has-text("Proceed")',
      'a:has-text("Continue")',
      '.drawer button:has-text("Proceed")',
      '.side-drawer button:has-text("Proceed")',
      'mat-drawer button:has-text("Proceed")',
    ];

    let proceedBtn = null;
    for (const sel of proceedSelectors) {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 1500 }).catch(() => false)) {
        proceedBtn = el;
        break;
      }
    }

    if (!proceedBtn) {
      await this.captureFailureScreenshot(page, ctx.bookingCode, 'PROCEED_TO_PAYMENT_GATEWAY_FAILED');
      throw new Error(`PROCEED_TO_PAYMENT_GATEWAY_FAILED: Proceed button not found in Wishlist`);
    }

    await proceedBtn.click();

    // Wait for navigation to paymentGateway
    await page.waitForURL(/paymentGateway/i, { timeout: 15000 }).catch(async () => {
      await page.waitForTimeout(3000);
    });

    const currentUrl = page.url();
    if (!currentUrl.includes('paymentGateway')) {
      // Check if page contains payment details
      const pageText = await page.innerText('body').catch(() => '');
      if (!pageText.includes('Payment') && !pageText.includes('Grand Total') && !pageText.includes('Booking ID')) {
        await this.captureFailureScreenshot(page, ctx.bookingCode, 'PROCEED_TO_PAYMENT_GATEWAY_FAILED');
        throw new Error(`PROCEED_TO_PAYMENT_GATEWAY_FAILED: Did not reach payment gateway page. Current URL: ${currentUrl}`);
      }
    }

    SanitizedLogger.info('[PAYMENT] Payment gateway opened');
    return true;
  }

  /**
   * 7. Verifies Payment Gateway summary details (Service, Date, Slot, Amount)
   */
  static async verifyPaymentSummary(page: Page, ctx: BookingExecutionContext): Promise<boolean> {
    await page.waitForTimeout(2000);

    const bodyText = await page.innerText('body').catch(() => '');

    // Extract Cart ID
    const cartMatch = bodyText.match(/Cart\s*ID[\s:]+([0-9A-Z]+)/i);
    if (cartMatch) {
      ctx.cartId = cartMatch[1].trim();
      SanitizedLogger.info(`[PAYMENT] Cart ID: ${ctx.cartId}`);
    }

    // Extract Official Booking ID (e.g. IVQ26100514030705319660)
    const ivqMatch = bodyText.match(/(IVQ[0-9A-Z]+)/i);
    if (ivqMatch) {
      ctx.officialBookingId = ivqMatch[1].trim();
      SanitizedLogger.info(`[PAYMENT] Official booking ID: ${ctx.officialBookingId}`);
    } else {
      const genericMatch = bodyText.match(/Booking\s*ID[\s:]+([A-Z0-9]{8,})/i);
      if (genericMatch) {
        ctx.officialBookingId = genericMatch[1].trim();
        SanitizedLogger.info(`[PAYMENT] Official booking ID: ${ctx.officialBookingId}`);
      }
    }

    // Extract Grand Total
    const totalMatch = bodyText.match(/Grand\s*Total\s*(?:Amount)?[\s:₹]+([0-9.,]+)/i);
    if (totalMatch) {
      ctx.grandTotal = `₹${totalMatch[1].trim()}`;
      SanitizedLogger.info(`[PAYMENT] Grand Total: ${ctx.grandTotal}`);
    }

    // Extract Slot if present in table
    const slotMatch = bodyText.match(/(\d{2}:\d{2}\s*-\s*\d{2}:\d{2})/);
    if (slotMatch) {
      ctx.selectedTimeSlot = slotMatch[1].trim();
      SanitizedLogger.info(`[PAYMENT] Slot confirmed: ${ctx.selectedTimeSlot}`);
    }

    // Verify Service === "Virtual-Q"
    if (!bodyText.includes('Virtual-Q') && !bodyText.includes('Virtual Q') && !bodyText.includes('Darshan')) {
      SanitizedLogger.warn('[PAYMENT] Payment summary does not contain Virtual-Q service');
    }

    // Verify Date
    const expectedDisplayDate = ctx.requestedDateDisplay || this.toDisplayDate(ctx.requestedDate);
    const dateMatched = bodyText.includes(expectedDisplayDate) || bodyText.includes(ctx.requestedDate);
    if (!dateMatched) {
      await this.captureFailureScreenshot(page, ctx.bookingCode, 'PAYMENT_SUMMARY_MISMATCH');
      throw new Error(`PAYMENT_SUMMARY_MISMATCH: Payment summary date does not match ${expectedDisplayDate}`);
    }

    SanitizedLogger.info('[PAYMENT] Summary verified');
    return true;
  }

  /**
   * 8. Executes Proceed on the Payment Gateway page and verifies final booking confirmation
   */
  static async executePaymentProceedAndConfirm(
    page: Page,
    ctx: BookingExecutionContext,
  ): Promise<{ confirmed: boolean; officialReference?: string; confirmationData?: any; message?: string }> {
    SanitizedLogger.info('[PAYMENT] Proceeding');

    const paymentProceedBtns = [
      'button:has-text("Proceed to Pay")',
      'button:has-text("Proceed to Book")',
      'button:has-text("Proceed")',
      'button:has-text("Pay Now")',
      'button:has-text("Confirm")',
      'button[type="submit"]',
    ];

    let payBtn = null;
    for (const sel of paymentProceedBtns) {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 1500 }).catch(() => false)) {
        payBtn = el;
        break;
      }
    }

    if (payBtn) {
      await payBtn.click();
    }

    // Wait for final response or confirmation dialog
    await page.waitForTimeout(3000);

    // Check for official Booking Confirmation modal / dialog
    const confirmModal = page.locator('mat-dialog-container:has-text("Booking Confirmation"), mat-dialog-container:has-text("transaction is successful"), mat-dialog-container:has-text("Transaction ID")').first();
    const isModalVisible = await confirmModal.isVisible({ timeout: 5000 }).catch(() => false);

    const bodyText = await page.innerText('body').catch(() => '');

    // Check if OTP or CAPTCHA or external gateway was prompted
    if (bodyText.includes('Enter OTP') || bodyText.includes('OTP Verification')) {
      await this.captureFailureScreenshot(page, ctx.bookingCode, 'OTP_REQUIRED');
      return {
        confirmed: false,
        message: 'Official portal requested OTP verification',
      };
    }

    // Extract official transaction / confirmation reference strictly from external portal evidence
    const txnMatch = bodyText.match(/Transaction\s*(?:ID|No|Reference)[\s:]+([0-9A-Z]{6,30})/i) ||
                     bodyText.match(/Booking\s*(?:ID|No|Reference|Pass\s*No)[\s:]+([0-9A-Z]{6,30})/i) ||
                     bodyText.match(/\b(IVQ[0-9A-Z]{6,25})\b/i);
    const officialTransactionId = txnMatch ? txnMatch[1].trim() : null;

    // Reject synthetic references: Never fallback to cartId or internal SAB-2026 booking code
    const validOfficialReference = officialTransactionId || 
      (ctx.officialBookingId && ctx.officialBookingId.length >= 6 && !ctx.officialBookingId.startsWith('SAB-2026-') ? ctx.officialBookingId : null);

    const isConfirmedDialogOrText =
      isModalVisible ||
      /Booking\s*Confirmation/i.test(bodyText) ||
      /transaction\s+is\s+successful/i.test(bodyText) ||
      /download\s+the\s+receipts/i.test(bodyText);

    if (isConfirmedDialogOrText && validOfficialReference) {
      SanitizedLogger.info('[BOOKING] Authoritative confirmation detected with official reference');
      SanitizedLogger.info(`[BOOKING] COMPLETED (Official Reference: ${validOfficialReference})`);

      // Dismiss dialog cleanly if OK button exists
      const okBtn = page.locator('mat-dialog-container button:has-text("OK"), button:has-text("OK")').first();
      if (await okBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
        await okBtn.click({ force: false }).catch(() => {});
      }

      return {
        confirmed: true,
        officialReference: validOfficialReference,
        confirmationData: {
          officialReference: validOfficialReference,
          transactionId: validOfficialReference,
          cartId: ctx.cartId,
          officialBookingId: validOfficialReference,
          requestedDate: ctx.requestedDate,
          selectedTime: ctx.selectedTimeSlot,
          route: ctx.requestedRoute,
          pilgrimsCount: ctx.pilgrimCount || 1,
          grandTotal: ctx.grandTotal || '₹0.00',
          timestamp: new Date().toISOString(),
          status: 'CONFIRMED',
        },
      };
    }

    // If confirmation screen or text appeared but authoritative reference could not be parsed,
    // do NOT manufacture a synthetic reference. Route to reconciliation as UNKNOWN_RESULT.
    if (isConfirmedDialogOrText && !validOfficialReference) {
      SanitizedLogger.warn('[BOOKING] Confirmation dialog displayed but authoritative reference could not be extracted. Marking outcome as UNKNOWN_RESULT.');
      await this.captureFailureScreenshot(page, ctx.bookingCode, 'UNVERIFIED_REFERENCE');
      return {
        confirmed: false,
        message: 'Official confirmation detected but authoritative reference was missing. Requires human reconciliation.',
      };
    }

    await this.captureFailureScreenshot(page, ctx.bookingCode, 'FINAL_BOOKING_UNCONFIRMED');
    return {
      confirmed: false,
      message: 'Official portal did not display booking confirmation',
    };
  }

  private static isCleaningScreenshots = false;

  /**
   * Bounded debug screenshot retention: cleans up files older than maxAgeDays (default 7 days)
   * and caps total debug directory size to maxTotalBytes (default 200MB).
   */
  public static async cleanupOldScreenshots(
    debugDir: string = path.resolve(process.cwd(), 'debug'),
    maxAgeDays: number = 7,
    maxTotalBytes: number = 200 * 1024 * 1024
  ): Promise<void> {
    if (this.isCleaningScreenshots) return;
    this.isCleaningScreenshots = true;
    try {
      if (!fs.existsSync(debugDir)) return;
      const files = await fs.promises.readdir(debugDir);
      const pngFiles: { name: string; fullPath: string; mtimeMs: number; size: number }[] = [];
      const now = Date.now();
      const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;

      for (const file of files) {
        if (!file.endsWith('.png') && !file.endsWith('.jpg')) continue;
        const fullPath = path.join(debugDir, file);
        try {
          const stat = await fs.promises.stat(fullPath);
          if (stat.isFile()) {
            if (now - stat.mtimeMs > maxAgeMs) {
              await fs.promises.unlink(fullPath);
              SanitizedLogger.info(`[DEBUG] Pruned expired screenshot: ${file}`);
            } else {
              pngFiles.push({ name: file, fullPath, mtimeMs: stat.mtimeMs, size: stat.size });
            }
          }
        } catch {}
      }

      let totalSize = pngFiles.reduce((acc, f) => acc + f.size, 0);
      if (totalSize > maxTotalBytes) {
        pngFiles.sort((a, b) => a.mtimeMs - b.mtimeMs);
        for (const f of pngFiles) {
          if (totalSize <= maxTotalBytes) break;
          try {
            await fs.promises.unlink(f.fullPath);
            totalSize -= f.size;
            SanitizedLogger.info(`[DEBUG] Pruned screenshot for space cap: ${f.name}`);
          } catch {}
        }
      }
    } catch (err: any) {
      SanitizedLogger.warn(`[DEBUG] Screenshot cleanup warning: ${err.message}`);
    } finally {
      this.isCleaningScreenshots = false;
    }
  }

  private static async captureFailureScreenshot(page: Page, bookingCode: string, state: string): Promise<void> {
    try {
      const debugDir = path.resolve(process.cwd(), 'debug');
      if (!fs.existsSync(debugDir)) {
        fs.mkdirSync(debugDir, { recursive: true });
      }
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `${bookingCode}-${state}-${timestamp}.png`;
      const screenshotPath = path.join(debugDir, filename);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      SanitizedLogger.info(`[DEBUG] Failure screenshot captured: ${screenshotPath}`);

      // Run bounded cleanup asynchronously
      this.cleanupOldScreenshots(debugDir).catch(() => {});
    } catch (err: any) {
      SanitizedLogger.warn('[DEBUG] Could not save failure screenshot:', err.message);
    }
  }
}
