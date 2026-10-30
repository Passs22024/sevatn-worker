import { Page } from 'playwright';
import { SanitizedLogger } from '../../monitoring/logger';
import { BookingExecutionContext, VirtualQWorkflowError } from './types';
import { FlowDiagnosticsManager } from './diagnostics';

export class ReliefFundFlow {
  /**
   * PHASE 6: Explicitly selects "No" for Pilgrim Relief Fund and verifies Amount = 0
   */
  static async execute(page: Page, ctx: BookingExecutionContext): Promise<boolean> {
    SanitizedLogger.info('[RELIEF-FUND] Setting "Contribute for Pilgrim Relief fund" to NO (Amount = ₹0)');

    try {
      const noSelectors = [
        'mat-radio-group[name="contribute"] mat-radio-button[value="no"]',
        'mat-radio-button[value="no"]',
        'mat-radio-group[name="contribute"] label:has-text("No")',
        'input[type="radio"][value="No"]',
        'input[type="radio"][value="no"]',
        'input[type="radio"][value="N"]',
        'mat-radio-button:has-text("No")',
        'label:has-text("No")',
      ];

      let noBtn = null;
      for (const sel of noSelectors) {
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: 1000 }).catch(() => false)) {
          noBtn = el;
          break;
        }
      }

      if (!noBtn) {
        const labelNo = page.getByLabel(/^No$/i).first();
        if (await labelNo.isVisible({ timeout: 1000 }).catch(() => false)) {
          noBtn = labelNo;
        }
      }

      if (!noBtn) {
        const diag = await FlowDiagnosticsManager.captureDiagnostics(page, 'PHASE_6_RELIEF_FUND', ctx.bookingCode);
        throw new VirtualQWorkflowError(
          'RELIEF_FUND_SELECTION_FAILED',
          'Pilgrim Relief Fund "No" radio control not found on official form',
          'PHASE_6_RELIEF_FUND',
          diag,
        );
      }

      // Click "No"
      await noBtn.scrollIntoViewIfNeeded().catch(() => {});
      await noBtn.click({ force: false }).catch(async () => {
        await noBtn.check().catch(() => {});
      });
      await page.waitForTimeout(600);

      // Verify "No" is actively checked
      const isNoChecked = await noBtn.evaluate((el: HTMLElement) => {
        if (el instanceof HTMLInputElement) return el.checked;
        return (
          el.classList.contains('mat-radio-checked') ||
          !!el.querySelector('.mat-radio-checked') ||
          el.getAttribute('aria-checked') === 'true'
        );
      }).catch(() => false);

      if (!isNoChecked) {
        const diag = await FlowDiagnosticsManager.captureDiagnostics(page, 'PHASE_6_RELIEF_FUND', ctx.bookingCode);
        throw new VirtualQWorkflowError(
          'RELIEF_FUND_SELECTION_FAILED',
          'RELIEF_FUND_UNVERIFIED: Relief Fund "No" radio button could not be verified as selected',
          'PHASE_6_RELIEF_FUND',
          diag,
        );
      }

      // Verify "Yes" is NOT checked
      const yesRadio = page.locator(
        'input[type="radio"][value="Yes"], input[type="radio"][value="yes"], mat-radio-button:has-text("Yes")'
      ).first();

      const isYesChecked = await yesRadio.evaluate((el: HTMLElement) => {
        if (el instanceof HTMLInputElement) return el.checked;
        return (
          el.classList.contains('mat-radio-checked') ||
          !!el.querySelector('.mat-radio-checked') ||
          el.getAttribute('aria-checked') === 'true'
        );
      }).catch(() => false);

      if (isYesChecked) {
        const diag = await FlowDiagnosticsManager.captureDiagnostics(page, 'PHASE_6_RELIEF_FUND', ctx.bookingCode);
        throw new VirtualQWorkflowError(
          'RELIEF_FUND_SELECTION_FAILED',
          'Relief Fund "Yes" radio is unexpectedly checked. Unintended contribution detected.',
          'PHASE_6_RELIEF_FUND',
          diag,
        );
      }

      // Verify displayed amount is ₹0 where portal displays it
      const displayedAmount = page.locator('.relief-amount, .fund-amount, text=/Relief Fund Amount/i').first();
      if (await displayedAmount.isVisible({ timeout: 500 }).catch(() => false)) {
        const txt = await displayedAmount.innerText().catch(() => '');
        if (txt.includes('₹') && !txt.includes('0')) {
          const diag = await FlowDiagnosticsManager.captureDiagnostics(page, 'PHASE_6_RELIEF_FUND', ctx.bookingCode);
          throw new VirtualQWorkflowError(
            'RELIEF_FUND_SELECTION_FAILED',
            `Relief fund amount displays non-zero: "${txt}"`,
            'PHASE_6_RELIEF_FUND',
            diag,
          );
        }
      }

      ctx.reliefFund = 0;
      ctx.reliefFundSelection = 'NO';
      SanitizedLogger.info('[RELIEF-FUND] Verified Relief Fund = "No" (Amount = ₹0)');

      return true;
    } catch (err: any) {
      if (err instanceof VirtualQWorkflowError) throw err;
      const diag = await FlowDiagnosticsManager.captureDiagnostics(page, 'PHASE_6_RELIEF_FUND', ctx.bookingCode);
      throw new VirtualQWorkflowError(
        'RELIEF_FUND_SELECTION_FAILED',
        err.message || 'Failed selecting Pilgrim Relief Fund = No',
        'PHASE_6_RELIEF_FUND',
        diag,
      );
    }
  }
}

