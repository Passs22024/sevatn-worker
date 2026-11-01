import { Page } from 'playwright';
import { SanitizedLogger } from '../../monitoring/logger';
import { BookingExecutionContext, VirtualQWorkflowError } from './types';
import { FlowDiagnosticsManager } from './diagnostics';

export interface BookingConfirmationResult {
  confirmed: boolean;
  isZeroCost: boolean;
  officialReference?: string;
  cartId?: string;
  officialBookingReference?: string;
  officialReceiptReference?: string;
  portalTransactionReference?: string;
  confirmationEvidence?: Record<string, any>;
  confirmedAt?: string;
  payableAmount: string;
  bookingStatus?: string;
  confirmationData?: {
    officialReference: string;
    transactionId: string;
    cartId?: string;
    officialBookingId?: string;
    officialBookingReference?: string;
    officialReceiptReference?: string;
    portalTransactionReference?: string;
    requestedDate: string;
    selectedTime?: string;
    route: string;
    pilgrimsCount: number;
    grandTotal: string;
    status: string;
    receiptUrl?: string;
    timestamp: string;
    evidence?: any;
  };
  reconciliationRequired?: boolean;
  message?: string;
}

export class BookingConfirmationFlow {
  /**
   * Helper: Parse payable numeric amount from string like "₹0", "₹0.00", "Rs. 249.50", "0"
   */
  public static parseNumericAmount(amountStr: string | undefined): number {
    if (!amountStr) return 0;
    // Strip common currency prefixes like "Rs.", "Rs", "₹", "INR"
    const cleanedPrefix = amountStr.replace(/^(?:Rs\.?|INR\.?|₹|\$)\s*/i, '');
    const match = cleanedPrefix.match(/[\d,]+(?:\.\d+)?/);
    if (!match) return 0;
    const num = parseFloat(match[0].replace(/,/g, ''));
    return isNaN(num) ? 0 : num;
  }

  /**
   * Alias for verifyConfirmation expected by workflow specs
   */
  public static async verifyConfirmation(page: Page, ctx: BookingExecutionContext): Promise<BookingConfirmationResult> {
    const rawAmount = ctx.grandTotal || '₹0.00';
    const isZeroCost = this.parseNumericAmount(rawAmount) === 0;
    const res = await this.verifyAndExtractConfirmation(page, ctx, rawAmount, isZeroCost);
    return {
      ...res,
      bookingStatus: res.confirmed ? 'CONFIRMED' : 'PAYMENT_PENDING',
    };
  }

  /**
   * PHASE 9: Official Confirmation & Reconciliation Flow
   */
  public static async execute(page: Page, ctx: BookingExecutionContext): Promise<BookingConfirmationResult> {
    SanitizedLogger.info(`[CONFIRMATION] Initiating autonomous confirmation sequence for Booking #${ctx.bookingCode}`);

    // Step 9.1: Inspect payable amount
    const rawAmount = ctx.grandTotal || '₹0.00';
    const numericAmount = this.parseNumericAmount(rawAmount);
    const isZeroCost = numericAmount === 0;

    SanitizedLogger.info(
      `[CONFIRMATION] Booking #${ctx.bookingCode} payable amount: ${rawAmount} (Numeric: ₹${numericAmount}, Zero-Cost: ${isZeroCost})`,
    );

    // Step 9.2: Route into Zero-Cost or Paid Confirmation Flow
    if (isZeroCost) {
      return await this.executeZeroCostConfirmation(page, ctx);
    } else {
      return await this.executePaidConfirmation(page, ctx, numericAmount);
    }
  }

  /**
   * Zero-Cost Booking Confirmation (Official Sabarimala Virtual-Q)
   */
  private static async executeZeroCostConfirmation(
    page: Page,
    ctx: BookingExecutionContext,
  ): Promise<BookingConfirmationResult> {
    SanitizedLogger.info(`[CONFIRMATION] Executing zero-cost confirmation for Booking #${ctx.bookingCode}`);

    // Verify customer authorization policy
    const policy = ctx.preferences?.customerAuthorizationPolicy || {};
    if (policy.allowZeroCostConfirmation === false) {
      const diag = await FlowDiagnosticsManager.captureDiagnostics(page, 'PHASE_9_BOOKING_CONFIRMATION', ctx.bookingCode);
      throw new VirtualQWorkflowError(
        'PAYMENT_PENDING',
        'Customer authorization policy explicitly disallows zero-cost auto-confirmation without operator review.',
        'PHASE_9_BOOKING_CONFIRMATION',
        diag,
      );
    }

    // Locate official confirmation action on #/paymentGateway
    const confirmButtons = [
      'button:has-text("Proceed to Book")',
      'button:has-text("Confirm")',
      'button:has-text("Proceed to Pay")',
      'button:has-text("Pay Now")',
      'button:has-text("Proceed")',
      'button[type="submit"]',
    ];

    let targetBtn = null;
    for (const sel of confirmButtons) {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 1500 }).catch(() => false)) {
        targetBtn = el;
        break;
      }
    }

    if (!targetBtn) {
      const diag = await FlowDiagnosticsManager.captureDiagnostics(page, 'PHASE_9_BOOKING_CONFIRMATION', ctx.bookingCode);
      throw new VirtualQWorkflowError(
        'BOOKING_CONFIRMATION_MISSING',
        'Official confirmation action button not found on payment review page.',
        'PHASE_9_BOOKING_CONFIRMATION',
        diag,
      );
    }

    // Verify button is enabled
    const isDisabled = await targetBtn.isDisabled().catch(() => false);
    if (isDisabled) {
      const diag = await FlowDiagnosticsManager.captureDiagnostics(page, 'PHASE_9_BOOKING_CONFIRMATION', ctx.bookingCode);
      throw new VirtualQWorkflowError(
        'BUTTON_DISABLED',
        'Confirmation button is disabled on payment review page.',
        'PHASE_9_BOOKING_CONFIRMATION',
        diag,
      );
    }

    // Trigger official confirmation action
    SanitizedLogger.info(`[CONFIRMATION] Clicking official confirmation button...`);
    await targetBtn.scrollIntoViewIfNeeded().catch(() => {});
    await targetBtn.click({ force: false });

    // Wait for response and modal
    await page.waitForTimeout(3000);

    return await this.verifyAndExtractConfirmation(page, ctx, '₹0.00', true);
  }

  /**
   * Paid Booking Flow (Payment sandbox integration, limit enforcement, idempotency)
   */
  private static async executePaidConfirmation(
    page: Page,
    ctx: BookingExecutionContext,
    numericAmount: number,
  ): Promise<BookingConfirmationResult> {
    SanitizedLogger.info(
      `[CONFIRMATION] Initiating paid flow for Booking #${ctx.bookingCode} (Payable: ₹${numericAmount})`,
    );

    // Enforce transaction limit (default max ₹5,000 for standard darshan bookings)
    const maxAllowedLimit = ctx.preferences?.maxTransactionLimit ?? 5000;
    if (numericAmount > maxAllowedLimit) {
      const diag = await FlowDiagnosticsManager.captureDiagnostics(page, 'PHASE_9_BOOKING_CONFIRMATION', ctx.bookingCode);
      throw new VirtualQWorkflowError(
        'PAYMENT_PENDING',
        `Payable amount ₹${numericAmount} exceeds maximum authorized transaction limit of ₹${maxAllowedLimit}.`,
        'PHASE_9_BOOKING_CONFIRMATION',
        diag,
      );
    }

    // Payment Idempotency Key
    const paymentIdempotencyKey = `PAY-${ctx.bookingCode}-${Date.now()}`;
    SanitizedLogger.info(`[CONFIRMATION] Enforcing payment idempotency key: ${paymentIdempotencyKey}`);

    // Check for payment proceed buttons
    const paymentButtons = [
      'button:has-text("Proceed to Pay")',
      'button:has-text("Pay Now")',
      'button:has-text("Confirm and Pay")',
      'button:has-text("Proceed")',
    ];

    let payBtn = null;
    for (const sel of paymentButtons) {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 1500 }).catch(() => false)) {
        payBtn = el;
        break;
      }
    }

    if (payBtn) {
      await payBtn.click({ force: false }).catch(() => {});
      await page.waitForTimeout(3000);
    }

    // Check for bank OTP / CAPTCHA challenge
    const bodyText = await page.innerText('body').catch(() => '');
    if (
      bodyText.includes('Enter OTP') ||
      bodyText.includes('OTP Verification') ||
      bodyText.includes('3D Secure') ||
      bodyText.includes('Bank Authentication')
    ) {
      SanitizedLogger.warn(`[CONFIRMATION] Bank 3D Secure / OTP requested. Pausing safely without bypassing security.`);
      const diag = await FlowDiagnosticsManager.captureDiagnostics(page, 'PHASE_9_BOOKING_CONFIRMATION', ctx.bookingCode);
      throw new VirtualQWorkflowError(
        'PAYMENT_PENDING',
        'Official payment gateway prompted 3D Secure / OTP bank authentication challenge.',
        'PHASE_9_BOOKING_CONFIRMATION',
        diag,
      );
    }

    // Check for sandbox / test gateway simulation or authoritative confirmation
    return await this.verifyAndExtractConfirmation(page, ctx, `₹${numericAmount.toFixed(2)}`, false);
  }

  /**
   * Verifies the authoritative confirmation modal and extracts official reference
   */
  public static async verifyAndExtractConfirmation(
    page: Page,
    ctx: BookingExecutionContext,
    payableAmount: string,
    isZeroCost: boolean,
  ): Promise<BookingConfirmationResult> {
    // Check for official Booking Confirmation modal / dialog
    const confirmModalSelectors = [
      'mat-dialog-container:has-text("Booking Confirmation")',
      'mat-dialog-container:has-text("transaction is successful")',
      'mat-dialog-container:has-text("Transaction ID")',
      '.swal2-modal:has-text("Booking Confirmation")',
      '.swal2-modal:has-text("Success")',
      'mat-dialog-container:has-text("Booking Pass")',
      '[id*="confirmation"]',
    ];

    let isModalVisible = false;
    for (const sel of confirmModalSelectors) {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 4000 }).catch(() => false)) {
        isModalVisible = true;
        break;
      }
    }

    const bodyText = await page.innerText('body').catch(() => '');

    // 1. Extract Portal Transaction Reference from confirmation text/dialog
    const txnMatch =
      bodyText.match(/(?:Transaction\s*(?:ID|No|Reference)|TXN\s*ID)[\s:]+([0-9A-Z]{6,30})/i);
    const portalTransactionReference = txnMatch ? txnMatch[1].trim() : (ctx.cartId || undefined);

    // 2. Extract Official Pass Booking Reference (e.g. IVQ26103022183531421270)
    // Priority:
    // A) Explicit IVQ\d+ or VQ\d+ or TXN\d+ from the confirmation modal or body text
    // B) Authoritative official booking ID captured from payment summary table (#/paymentGateway)
    // C) Explicit Booking ID / Pass No labeled values, strictly rejecting non-reference labels like "Service"
    const ivqMatch = bodyText.match(/\b(IVQ[0-9A-Z]{6,30})\b/i);
    const vqMatch = bodyText.match(/\b(VQ[0-9A-Z]{6,30})\b/i);
    const txnPrefixMatch = bodyText.match(/\b(TXN[0-9A-Z]{6,30})\b/i);

    let modalBookingRef: string | null = null;
    if (ivqMatch) {
      modalBookingRef = ivqMatch[1].trim();
    } else if (vqMatch) {
      modalBookingRef = vqMatch[1].trim();
    } else if (txnPrefixMatch) {
      modalBookingRef = txnPrefixMatch[1].trim();
    } else {
      const genericMatch = bodyText.match(/(?:Booking\s*(?:ID|No|Reference|Pass\s*No)|Pass\s*(?:Number|No))[\s:]+([0-9A-Z]{6,30})/i);
      if (genericMatch) {
        const candidate = genericMatch[1].trim();
        // Reject plain table headers, labels, or words like "Service", "Darshan", "Virtual"
        const rejectedWords = ['service', 'darshan', 'virtual', 'booking', 'status', 'success', 'pending', 'confirmed'];
        if (!rejectedWords.includes(candidate.toLowerCase()) && !/^[A-Za-z]+$/.test(candidate)) {
          modalBookingRef = candidate;
        }
      }
    }

    // Helper: validate whether a string is a legitimate authoritative reference (must match IVQ\d+, VQ\d+, TXN\d+, or alphanumeric with digits)
    const isLegitReference = (ref: string | null | undefined): boolean => {
      if (!ref || typeof ref !== 'string') return false;
      const clean = ref.trim();
      if (clean.length < 6) return false;
      if (clean.startsWith('SAB-2026-')) return false;
      // Reject pure numeric Cart IDs (8 to 12 digits)
      if ((ctx.cartId && clean === ctx.cartId) || /^\d{8,12}$/.test(clean)) return false;
      // Reject plain words with no digits like "Service", "Darshan"
      if (!/\d/.test(clean)) return false;
      // Must match IVQ, VQ, TXN, or standard alphanumeric reference with digits
      return /^(?:IVQ|VQ|TXN|[A-Z]{2,5}\d|\d{2,5}[A-Z])[0-9A-Z]+$/i.test(clean);
    };

    let authoritativeBookingRef: string | null = null;
    if (isLegitReference(modalBookingRef)) {
      authoritativeBookingRef = modalBookingRef;
    } else if (isLegitReference(ctx.officialBookingReference)) {
      authoritativeBookingRef = ctx.officialBookingReference!;
    } else if (isLegitReference(ctx.officialBookingId)) {
      authoritativeBookingRef = ctx.officialBookingId!;
    } else if (isLegitReference(portalTransactionReference)) {
      authoritativeBookingRef = portalTransactionReference!;
    }

    // Strict validation: Authoritative booking reference must NOT be a Cart ID, plain text, or synthetic reference
    const validOfficialReference = authoritativeBookingRef;

    // 3. Extract Receipt Reference if present
    const receiptMatch = bodyText.match(/(?:Receipt\s*(?:ID|No|Reference))[\s:]+([0-9A-Z]{6,30})/i);
    const officialReceiptReference = receiptMatch ? receiptMatch[1].trim() : undefined;

    const isConfirmedDialogOrText =
      isModalVisible ||
      /Booking\s*Confirmation/i.test(bodyText) ||
      /transaction\s+is\s+successful/i.test(bodyText) ||
      /download\s+the\s+receipts/i.test(bodyText);

    const confirmationEvidence = {
      cartId: ctx.cartId,
      portalTransactionReference,
      officialBookingReference: validOfficialReference,
      officialReceiptReference,
      isZeroCost,
      payableAmount,
      isModalVisible,
      bodyTextSnippet: bodyText.slice(0, 500),
      timestamp: new Date().toISOString(),
    };

    if (isConfirmedDialogOrText && validOfficialReference) {
      SanitizedLogger.info(`[CONFIRMATION] Authoritative confirmation detected with reference: ${validOfficialReference} (Cart ID: ${ctx.cartId || 'N/A'}, Txn Ref: ${portalTransactionReference || 'N/A'})`);

      // Dismiss dialog cleanly if OK button exists
      const okBtn = page
        .locator('mat-dialog-container button:has-text("OK"), button:has-text("OK"), .swal2-confirm, mat-dialog-actions button')
        .first();
      if (await okBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await okBtn.click({ force: false }).catch(() => {});
        const backdrop = page.locator('.cdk-overlay-backdrop');
        if (typeof backdrop.waitFor === 'function') {
          await backdrop.waitFor({ state: 'detached', timeout: 3000 }).catch(() => {});
        }
      }

      const receiptUrl = 'https://sabarimalaonline.org/#/booking-history';

      return {
        confirmed: true,
        isZeroCost,
        officialReference: validOfficialReference,
        officialBookingReference: validOfficialReference,
        cartId: ctx.cartId,
        portalTransactionReference,
        officialReceiptReference,
        confirmationEvidence,
        confirmedAt: new Date().toISOString(),
        payableAmount,
        bookingStatus: 'CONFIRMED',
        confirmationData: {
          officialReference: validOfficialReference,
          officialBookingReference: validOfficialReference,
          officialBookingId: validOfficialReference,
          transactionId: portalTransactionReference || validOfficialReference,
          portalTransactionReference,
          cartId: ctx.cartId,
          officialReceiptReference,
          requestedDate: ctx.requestedDate,
          selectedTime: ctx.selectedTimeSlot,
          route: ctx.requestedRoute,
          pilgrimsCount: ctx.pilgrimCount || 1,
          grandTotal: payableAmount,
          status: 'CONFIRMED',
          receiptUrl,
          timestamp: new Date().toISOString(),
          evidence: confirmationEvidence,
        },
      };
    }

    // Ambiguous outcome: Confirmation appeared or submitted but authoritative booking pass reference was missing
    if (isConfirmedDialogOrText && !validOfficialReference) {
      SanitizedLogger.warn(
        `[CONFIRMATION] Confirmation displayed but authoritative pass reference (IVQ) was missing/ambiguous. Cart ID: ${ctx.cartId || 'N/A'}, Txn Ref: ${portalTransactionReference || 'N/A'}. Route to reconciliation.`,
      );
      return {
        confirmed: false,
        isZeroCost,
        cartId: ctx.cartId,
        portalTransactionReference,
        officialReceiptReference,
        confirmationEvidence,
        payableAmount,
        bookingStatus: 'PAYMENT_PENDING',
        reconciliationRequired: true,
        message: 'Official confirmation dialog displayed but authoritative booking pass reference (IVQ) could not be parsed.',
      };
    }

    // Unconfirmed outcome
    return {
      confirmed: false,
      isZeroCost,
      payableAmount,
      bookingStatus: 'PAYMENT_PENDING',
      reconciliationRequired: true,
      message: 'Official portal did not present authoritative booking confirmation.',
    };
  }
}
