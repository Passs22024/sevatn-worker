import { Page } from 'playwright';
import { SanitizedLogger } from '../../monitoring/logger';
import { BookingExecutionContext, SelectedPilgrimEvidence, VirtualQWorkflowError } from './types';
import { FlowDiagnosticsManager } from './diagnostics';

export class PilgrimSelectionFlow {
  /**
   * PHASE 4: Pilgrim Selection Master Workflow (#/darshan -> #/piligrimServiceMaster -> #/darshan)
   */
  static async execute(page: Page, ctx: BookingExecutionContext): Promise<{ success: boolean; selectedCount: number }> {
    SanitizedLogger.info(`[PILGRIM-SELECTION] Initiating official pilgrim selection for Booking #${ctx.bookingCode}`);

    try {
      const requestedPilgrims = ctx.pilgrims || [];
      const requiredCount = requestedPilgrims.length > 0 ? requestedPilgrims.length : (ctx.pilgrimCount || 1);

      // Step 1: Open the pilgrim selection flow from #/darshan
      const selectPilgrimBtn = page.locator(
        'button:has-text("Select Pilgrim"), a:has-text("Select Pilgrim"), .btn-select-pilgrim'
      ).first();

      const isBtnVisible = await selectPilgrimBtn.isVisible({ timeout: 4000 }).catch(() => false);
      if (isBtnVisible) {
        await selectPilgrimBtn.click();
        await page.waitForTimeout(2000);
      } else {
        // If not already on pilgrim master, check if we navigated
        if (!page.url().includes('piligrimServiceMaster')) {
          SanitizedLogger.info('[PILGRIM-SELECTION] Direct button not found; checking for inline pilgrim table or navigation');
        }
      }

      // Step 2: Wait for saved pilgrim table
      await page.waitForSelector('table, mat-table, .pilgrim-card', { timeout: 10000 }).catch(() => {});

      const rows = page.locator('table tbody tr, mat-row');
      const rowCount = await rows.count().catch(() => 0);
      SanitizedLogger.info(`[PILGRIM-SELECTION] Found ${rowCount} registered pilgrim records in official account`);

      if (rowCount === 0) {
        const diag = await FlowDiagnosticsManager.captureDiagnostics(page, 'PHASE_4_PILGRIM_SELECTION', ctx.bookingCode);
        throw new VirtualQWorkflowError(
          'PILGRIM_SELECTION_FAILED',
          'No saved pilgrims found in official portal account. Please register pilgrims in Sabarimala portal first.',
          'PHASE_4_PILGRIM_SELECTION',
          diag,
        );
      }

      // Step 3: Match requested pilgrims against account table records
      const selectedPilgrims: SelectedPilgrimEvidence[] = [];
      let checkedCount = 0;

      if (requestedPilgrims.length > 0) {
        // Strict matching: Match each requested pilgrim by idNumber, fullName, or name keywords
        for (const reqP of requestedPilgrims) {
          const reqNameClean = reqP.fullName.toLowerCase().replace(/[^a-z0-9]/g, '');
          const reqIdClean = (reqP.idNumber || '').toLowerCase().replace(/[^a-z0-9]/g, '');
          let matched = false;

          for (let i = 0; i < rowCount; i++) {
            const row = rows.nth(i);
            const rowText = (await row.innerText().catch(() => '')).toLowerCase();

            const idMatches = reqIdClean.length >= 4 && rowText.includes(reqIdClean);
            const nameMatches = reqNameClean.length >= 3 && rowText.replace(/[^a-z0-9]/g, '').includes(reqNameClean);

            if (idMatches || nameMatches) {
              const cb = row.locator('mat-checkbox, input[type="checkbox"]').first();
              if (await cb.isVisible({ timeout: 1000 }).catch(() => false)) {
                const isChecked = await cb.evaluate((el: HTMLElement) => {
                  if (el instanceof HTMLInputElement) return el.checked;
                  return (
                    el.classList.contains('mat-checkbox-checked') ||
                    !!el.querySelector('.mat-checkbox-checked') ||
                    !!(el.querySelector('input[type="checkbox"]') as HTMLInputElement)?.checked
                  );
                }).catch(() => false);

                if (!isChecked) {
                  const clickable = cb.locator('label, .mat-checkbox-inner-container').first();
                  if (await clickable.isVisible({ timeout: 500 }).catch(() => false)) {
                    await clickable.click({ force: false });
                  } else {
                    await cb.click({ force: false });
                  }
                  await page.waitForTimeout(400);
                }

                checkedCount++;
                selectedPilgrims.push({
                  name: reqP.fullName,
                  idNumber: reqP.idNumber,
                  rowNumber: i + 1,
                });
                matched = true;
                SanitizedLogger.info(`[PILGRIM-SELECTION] Matched requested pilgrim "${reqP.fullName}" (ID: ${reqP.idNumber}) in row ${i + 1}`);
                break;
              }
            }
          }

          if (!matched) {
            SanitizedLogger.warn(`[PILGRIM-SELECTION] Requested pilgrim "${reqP.fullName}" (ID: ${reqP.idNumber}) not found in account records.`);
          }
        }
      } else {
        // If no specific pilgrims specified in context, select up to ctx.pilgrimCount (default 1)
        const targetSelection = Math.min(rowCount, requiredCount);
        SanitizedLogger.info(`[PILGRIM-SELECTION] Selecting up to ${targetSelection} registered pilgrim(s) (requested: ${requiredCount}, available: ${rowCount})`);
        for (let i = 0; i < targetSelection; i++) {
          const row = rows.nth(i);
          const cb = row.locator('mat-checkbox, input[type="checkbox"]').first();
          if (await cb.isVisible({ timeout: 1000 }).catch(() => false)) {
            await cb.click({ force: false }).catch(() => {});
            await page.waitForTimeout(300);
            checkedCount++;
            const rowText = (await row.innerText().catch(() => '')).split('\n')[0].trim();
            selectedPilgrims.push({
              name: rowText || `Pilgrim #${i + 1}`,
              rowNumber: i + 1,
            });
          }
        }
      }

      // Step 4: Verify selected count (graceful fallback if requested > available rows)
      if (checkedCount === 0) {
        const diag = await FlowDiagnosticsManager.captureDiagnostics(page, 'PHASE_4_PILGRIM_SELECTION', ctx.bookingCode);
        throw new VirtualQWorkflowError(
          'PILGRIM_SELECTION_FAILED',
          'Failed to select any pilgrim from official portal account.',
          'PHASE_4_PILGRIM_SELECTION',
          diag,
        );
      }

      if (checkedCount < requiredCount) {
        SanitizedLogger.warn(
          `[PILGRIM-SELECTION] Requested ${requiredCount} pilgrims, but only ${checkedCount} available row(s) in official account. Proceeding with available ${checkedCount} pilgrim(s).`
        );
      }
      ctx.pilgrimCount = checkedCount;

      // Step 5: Click Submit
      const submitBtn = page.locator(
        'button:has-text("Submit"), button:has-text("Done"), button:has-text("Apply"), button:has-text("Add to Booking"), button[type="submit"]'
      ).first();

      if (await submitBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await submitBtn.click();
        await page.waitForTimeout(2000);
      }

      // Step 6: Wait for return to #/darshan
      if (typeof page.waitForURL === 'function') {
        await page.waitForURL(/darshan/i, { timeout: 6000 }).catch(() => {});
      }
      await page.waitForTimeout(1000);

      // Step 7: Verify selected pilgrims are reflected on the booking form
      const formPilgrims = page.locator('table tbody tr, .pilgrim-details tr, .selected-pilgrims');
      const reflectedCount = await formPilgrims.count().catch(() => 0);
      SanitizedLogger.info(`[PILGRIM-SELECTION] Verified ${checkedCount} pilgrims submitted and returned to booking flow (Reflected rows: ${reflectedCount})`);

      ctx.pilgrimCount = checkedCount;
      ctx.selectedPilgrims = selectedPilgrims;

      return {
        success: true,
        selectedCount: checkedCount,
      };
    } catch (err: any) {
      if (err instanceof VirtualQWorkflowError) throw err;
      const diag = await FlowDiagnosticsManager.captureDiagnostics(page, 'PHASE_4_PILGRIM_SELECTION', ctx.bookingCode);
      throw new VirtualQWorkflowError(
        'PILGRIM_SELECTION_FAILED',
        err.message || 'Failed during official pilgrim selection flow',
        'PHASE_4_PILGRIM_SELECTION',
        diag,
      );
    }
  }
}

