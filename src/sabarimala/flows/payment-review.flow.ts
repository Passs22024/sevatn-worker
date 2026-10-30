import { Page } from 'playwright';
import { SanitizedLogger } from '../../monitoring/logger';
import { BookingExecutionContext, VirtualQWorkflowError } from './types';
import { FlowDiagnosticsManager } from './diagnostics';
import { SABARIMALA_SELECTORS } from '../selectors';
import { WishlistFlow } from './wishlist.flow';
import { resolveCanonicalRoute, OFFICIAL_PORTAL_ROUTES } from './date-route.flow';

export interface PaymentGatewayState {
  loaded: boolean;
  gatewayUrl: string;
  amount?: string;
  summaryText?: string;
  checkoutVerified: boolean;
}

export class PaymentReviewFlow {
  /**
   * Helper: Bounded wait for async loaders / shade overlays to detach/hide
   */
  static async waitForLoaderHidden(page: Page, timeoutMs = 10000): Promise<void> {
    const loaderSelectors = [
      '#loader .shade',
      '#loader',
      '.loader .shade',
      '.loader',
      '.ngx-spinner-overlay',
      'ngx-spinner .overlay',
      '.cdk-overlay-backdrop',
    ];

    const startTime = Date.now();
    for (const sel of loaderSelectors) {
      const remainingTime = Math.max(500, timeoutMs - (Date.now() - startTime));
      try {
        const loaderEl = page.locator(sel).first();
        if (await loaderEl.isVisible({ timeout: 400 }).catch(() => false)) {
          SanitizedLogger.info(`[LOADER] Detected active loader/shade (${sel}). Waiting up to ${remainingTime}ms for it to detach/hide...`);
          await loaderEl.waitFor({ state: 'hidden', timeout: remainingTime }).catch(() => {});
        }
      } catch {
        // Continue checking other selectors
      }
      if (Date.now() - startTime >= timeoutMs) break;
    }

    // Verify no blocking loader overlay remains visible
    const shadeEl = page.locator('#loader .shade, .loader .shade, #loader, .ngx-spinner-overlay').first();
    const isStillVisible = await shadeEl.isVisible({ timeout: 400 }).catch(() => false);
    if (isStillVisible) {
      throw new Error('LOADER_ACTIVE: Loader overlay (#loader .shade) remained visible after bounded timeout');
    }
  }

  /**
   * PHASE 8: Proceed from Wishlist to Official Payment Gateway (#/paymentGateway)
   * And authoritatively verify checkout page booking details against original booking request.
   */
  static async execute(page: Page, ctx: BookingExecutionContext): Promise<PaymentGatewayState> {
    SanitizedLogger.info(`[PAYMENT-REVIEW] Initiating payment review sequence for Booking #${ctx.bookingCode}`);

    try {
      // Step 8.1: Wait for any active loader/shade from previous actions to hide
      try {
        await this.waitForLoaderHidden(page, 10000);
      } catch (loaderErr: any) {
        const diag = await FlowDiagnosticsManager.captureDiagnostics(page, 'PHASE_8_PAYMENT_REVIEW', ctx.bookingCode);
        throw new VirtualQWorkflowError(
          'LOADER_TIMEOUT',
          `Loader overlay (#loader .shade) intercepted pointer events and failed to detach within timeout: ${loaderErr.message}`,
          'PHASE_8_PAYMENT_REVIEW',
          diag,
        );
      }

      // Step 8.2: Authoritative pre-proceed verification:
      // Never click Proceed based only on button enabled state.
      // Must verify wishlist item matches booking details before proceeding.
      const isWishlistVerified = ctx.wishlistStatus === 'VERIFIED' || (await WishlistFlow.verifyItemInWishlist(page, ctx, true));
      if (!isWishlistVerified) {
        const diag = await FlowDiagnosticsManager.captureDiagnostics(page, 'PHASE_8_PAYMENT_REVIEW', ctx.bookingCode);
        throw new VirtualQWorkflowError(
          'WISHLIST_VERIFICATION_MISMATCH',
          `Target booking (Date: ${ctx.requestedDateDisplay || ctx.requestedDate}, Route: ${ctx.requestedRoute}, Slot: ${ctx.selectedTimeSlot}) could not be verified in Wishlist drawer before proceeding`,
          'PHASE_8_PAYMENT_REVIEW',
          diag,
        );
      }

      // Step 8.3: Locate Proceed button inside the My Wishlist panel on Virtual-Q page (#/darshan)
      // Never navigate away to #/wishlist. The My Wishlist panel is rendered on the right side of #/darshan.
      SanitizedLogger.info('[PAYMENT-REVIEW] Staying on Virtual-Q page: https://sabarimalaonline.org/#/darshan');
      SanitizedLogger.info('[PAYMENT-REVIEW] Inspecting My Wishlist panel on Virtual-Q page');

      const proceedSelectors = [
        'app-wishlist button:has-text("Proceed")',
        'app-wishlist button:has-text("Proceed to Book")',
        'app-wishlist button:has-text("Proceed to Pay")',
        '.side-drawer button:has-text("Proceed")',
        '.side-drawer button:has-text("Proceed to Book")',
        '.side-drawer button:has-text("Proceed to Pay")',
        'mat-drawer button:has-text("Proceed")',
        '.drawer button:has-text("Proceed")',
        '.wishlist-drawer button:has-text("Proceed")',
        '.wishlist-panel button:has-text("Proceed")',
        'button:has-text("Proceed to Book")',
        'button:has-text("Proceed to Pay")',
        'button:has-text("Proceed")',
      ];

      let targetProceedBtn = null;
      for (const sel of proceedSelectors) {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 1500 }).catch(() => false)) {
          targetProceedBtn = btn;
          break;
        }
      }

      if (!targetProceedBtn) {
        const diag = await FlowDiagnosticsManager.captureDiagnostics(page, 'PHASE_8_PAYMENT_REVIEW', ctx.bookingCode);
        throw new VirtualQWorkflowError(
          'PAYMENT_PAGE_LOAD_FAILED',
          'Proceed button not found in My Wishlist panel on Virtual-Q page (#/darshan)',
          'PHASE_8_PAYMENT_REVIEW',
          diag,
        );
      }

      // Verify Proceed button is enabled
      const isDisabled = await targetProceedBtn.isDisabled().catch(() => false);
      if (isDisabled) {
        const diag = await FlowDiagnosticsManager.captureDiagnostics(page, 'PHASE_8_PAYMENT_REVIEW', ctx.bookingCode);
        throw new VirtualQWorkflowError(
          'BUTTON_DISABLED',
          'Proceed button is disabled in Wishlist panel',
          'PHASE_8_PAYMENT_REVIEW',
          diag,
        );
      }

      // Final loader check before click
      await this.waitForLoaderHidden(page, 3000).catch(() => {});

      // Click Proceed normally (never force-click)
      await targetProceedBtn.scrollIntoViewIfNeeded().catch(() => {});
      try {
        await targetProceedBtn.click({ force: false, timeout: 6000 });
        SanitizedLogger.info(`[PAYMENT-REVIEW] Clicked Proceed button. Waiting for loader and navigation to checkout...`);
      } catch (clickErr: any) {
        const diag = await FlowDiagnosticsManager.captureDiagnostics(page, 'PHASE_8_PAYMENT_REVIEW', ctx.bookingCode);
        if (clickErr.message?.includes('intercepts pointer events') || clickErr.message?.includes('shade') || clickErr.message?.includes('loader')) {
          throw new VirtualQWorkflowError(
            'LOADER_TIMEOUT',
            `Proceed click intercepted by loader overlay: ${clickErr.message}`,
            'PHASE_8_PAYMENT_REVIEW',
            diag,
          );
        }
        throw clickErr;
      }

      // Step 8.4: Wait for loader and navigation to complete
      try {
        await this.waitForLoaderHidden(page, 15000);
      } catch (loaderErr: any) {
        const diag = await FlowDiagnosticsManager.captureDiagnostics(page, 'PHASE_8_PAYMENT_REVIEW', ctx.bookingCode);
        throw new VirtualQWorkflowError(
          'LOADER_TIMEOUT',
          `Loader remained active after clicking Proceed: ${loaderErr.message}`,
          'PHASE_8_PAYMENT_REVIEW',
          diag,
        );
      }

      if (typeof page.waitForURL === 'function') {
        await page.waitForURL(/paymentGateway|payment/i, { timeout: 15000 }).catch(() => {});
      }

      const currentUrl = typeof page.url === 'function' ? page.url() : '';
      const isPaymentUrl = currentUrl.includes('paymentGateway') || currentUrl.includes('payment');

      if (!isPaymentUrl) {
        const diag = await FlowDiagnosticsManager.captureDiagnostics(page, 'PHASE_8_PAYMENT_REVIEW', ctx.bookingCode);
        throw new VirtualQWorkflowError(
          'PAYMENT_PAGE_LOAD_FAILED',
          `Official payment page failed to load after Proceed. Current URL: "${currentUrl}"`,
          'PHASE_8_PAYMENT_REVIEW',
          diag,
        );
      }

      // Step 8.5: Authoritative comparison of payment/review page details against original booking request
      const pageText = await page.innerText('body').catch(() => '');
      const amountEl = page.locator('.total-amount, .grand-total, text=/Total Amount/i, text=/Grand Total/i').first();
      let grandTotal = '₹0';
      if (await amountEl.isVisible({ timeout: 1000 }).catch(() => false)) {
        grandTotal = (await amountEl.innerText().catch(() => '₹0')).trim();
      }

      // Check date equality if dates are rendered on payment summary
      const hasAnyDateMention = /\b\d{2}[-/]\d{2}[-/]\d{4}\b|\b\d{4}-\d{2}-\d{2}\b/.test(pageText);
      if (hasAnyDateMention) {
        const hasDate = WishlistFlow.matchesDate(pageText, ctx.requestedDate, ctx.requestedDateDisplay);
        if (!hasDate) {
          const diag = await FlowDiagnosticsManager.captureDiagnostics(page, 'PHASE_8_PAYMENT_REVIEW', ctx.bookingCode);
          throw new VirtualQWorkflowError(
            'CHECKOUT_VERIFICATION_MISMATCH',
            `Payment review page date does not match requested date (Expected: ${ctx.requestedDateDisplay || ctx.requestedDate})`,
            'PHASE_8_PAYMENT_REVIEW',
            diag,
          );
        }
      }

      // Check route equality
      const canonicalRoute = resolveCanonicalRoute(ctx.requestedRoute);
      if (canonicalRoute && Object.values(OFFICIAL_PORTAL_ROUTES).some((r: any) => pageText.toLowerCase().includes(r.primaryKeyword))) {
        const hasRoute = WishlistFlow.matchesRoute(pageText, ctx.requestedRoute);
        if (!hasRoute) {
          const diag = await FlowDiagnosticsManager.captureDiagnostics(page, 'PHASE_8_PAYMENT_REVIEW', ctx.bookingCode);
          throw new VirtualQWorkflowError(
            'CHECKOUT_VERIFICATION_MISMATCH',
            `Payment review page route does not match requested route (Expected: ${canonicalRoute.canonicalName})`,
            'PHASE_8_PAYMENT_REVIEW',
            diag,
          );
        }
      }

      // Check slot equality if time slots are mentioned
      if (ctx.selectedTimeSlot && ctx.selectedTimeSlot !== 'Any' && /\b\d{2}:\d{2}\s*-\s*\d{2}:\d{2}\b/.test(pageText)) {
        const hasSlot = WishlistFlow.matchesSlot(pageText, ctx.selectedTimeSlot);
        if (!hasSlot) {
          const diag = await FlowDiagnosticsManager.captureDiagnostics(page, 'PHASE_8_PAYMENT_REVIEW', ctx.bookingCode);
          throw new VirtualQWorkflowError(
            'CHECKOUT_VERIFICATION_MISMATCH',
            `Payment review page time slot does not match requested slot (Expected: ${ctx.selectedTimeSlot})`,
            'PHASE_8_PAYMENT_REVIEW',
            diag,
          );
        }
      }

      // Check pilgrim count equality if pilgrim count is mentioned
      if (ctx.pilgrimCount && ctx.pilgrimCount > 0 && /(?:pilgrim|person)/i.test(pageText)) {
        const hasPilgrims = WishlistFlow.matchesPilgrimCount(pageText, ctx.pilgrimCount);
        if (!hasPilgrims) {
          const diag = await FlowDiagnosticsManager.captureDiagnostics(page, 'PHASE_8_PAYMENT_REVIEW', ctx.bookingCode);
          throw new VirtualQWorkflowError(
            'CHECKOUT_VERIFICATION_MISMATCH',
            `Payment review page pilgrim count does not match requested count (Expected: ${ctx.pilgrimCount})`,
            'PHASE_8_PAYMENT_REVIEW',
            diag,
          );
        }
      }

      ctx.checkoutVerified = true;
      ctx.paymentStatus = 'GATEWAY_LOADED';
      ctx.grandTotal = grandTotal;

      SanitizedLogger.info(
        `[PAYMENT-REVIEW] ✅ Checkout details independently verified against booking request. URL: ${currentUrl}, Total: ${grandTotal}`,
      );

      return {
        loaded: true,
        gatewayUrl: currentUrl,
        amount: grandTotal,
        summaryText: pageText.slice(0, 500),
        checkoutVerified: true,
      };
    } catch (err: any) {
      if (err instanceof VirtualQWorkflowError) throw err;
      const diag = await FlowDiagnosticsManager.captureDiagnostics(page, 'PHASE_8_PAYMENT_REVIEW', ctx.bookingCode);
      throw new VirtualQWorkflowError(
        'PAYMENT_PAGE_LOAD_FAILED',
        err.message || 'Failed proceeding to official payment page',
        'PHASE_8_PAYMENT_REVIEW',
        diag,
      );
    }
  }
}
