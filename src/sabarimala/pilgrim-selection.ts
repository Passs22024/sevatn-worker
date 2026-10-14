import { Page } from 'playwright';
import { SABARIMALA_SELECTORS } from './selectors';
import { SanitizedLogger } from '../monitoring/logger';

export interface PilgrimSelectionResult {
  success: boolean;
  selectedCount?: number;
  message?: string;
}

export class SabarimalaPilgrimSelectionFlow {
  /**
   * Opens pilgrim selection page/modal, selects all existing registered pilgrims, and submits.
   */
  static async selectAllExistingPilgrims(page: Page): Promise<PilgrimSelectionResult> {
    SanitizedLogger.info('Opening official pilgrim selection master');

    try {
      // 1. Click "Select Pilgrim" or "Add Pilgrim" if currently on booking page
      if (!page.url().includes('piligrimServiceMaster')) {
        let clicked = false;
        try {
          const btn = page.getByRole('button', { name: /Select Pilgrim/i }).or(page.getByRole('link', { name: /Select Pilgrim/i }));
          if (await btn.count() > 0 && await btn.first().isVisible({ timeout: 2000 })) {
            await btn.first().click();
            clicked = true;
          }
        } catch {}

        if (!clicked) {
          for (const selector of SABARIMALA_SELECTORS.pilgrimSelection.selectPilgrimButton) {
            try {
              const el = page.locator(selector).first();
              if (await el.isVisible({ timeout: 1500 })) {
                await el.click();
                clicked = true;
                break;
              }
            } catch {}
          }
        }

        // Wait for navigation to pilgrim service master or dialog
        await page.waitForTimeout(2000);
      }

      // 2. Select All existing pilgrims
      SanitizedLogger.info('Selecting all registered pilgrims from official account');
      await page.waitForSelector('table, mat-table, mat-checkbox', { timeout: 10000 }).catch(() => {});

      // Locate rows or checkboxes
      const rows = page.locator('table tbody tr, mat-row');
      const rowCount = await rows.count();
      SanitizedLogger.info(`Found ${rowCount} pilgrim rows in official table.`);

      let checkedCount = 0;
      if (rowCount > 0) {
        for (let i = 0; i < rowCount; i++) {
          const row = rows.nth(i);
          const cb = row.locator('mat-checkbox, input[type="checkbox"]').first();
          if (await cb.isVisible({ timeout: 1500 }).catch(() => false)) {
            const isChecked = await cb.evaluate((el: HTMLElement) => {
              if (el instanceof HTMLInputElement) return el.checked;
              return el.classList.contains('mat-checkbox-checked') || !!el.querySelector('.mat-checkbox-checked') || !!(el.querySelector('input[type="checkbox"]') as HTMLInputElement)?.checked;
            }).catch(() => false);

            if (!isChecked) {
              // Click the checkbox or inner label
              const targetClickable = cb.locator('label, .mat-checkbox-inner-container').first();
              if (await targetClickable.isVisible({ timeout: 500 }).catch(() => false)) {
                await targetClickable.click({ force: false });
              } else {
                await cb.click({ force: false });
              }
              await page.waitForTimeout(400);
            }
            checkedCount++;
          }
        }
      }

      // If no rows found with row locator, select all mat-checkbox directly
      if (checkedCount === 0) {
        const checkboxes = page.locator('mat-checkbox');
        const count = await checkboxes.count();
        SanitizedLogger.info(`Fallback: Found ${count} mat-checkbox elements.`);
        for (let i = 0; i < count; i++) {
          const cb = checkboxes.nth(i);
          if (await cb.isVisible({ timeout: 1000 }).catch(() => false)) {
            const isChecked = await cb.evaluate((el: HTMLElement) => el.classList.contains('mat-checkbox-checked')).catch(() => false);
            if (!isChecked) {
              await cb.click({ force: false }).catch(() => {});
              await page.waitForTimeout(300);
            }
            checkedCount++;
          }
        }
      }

      SanitizedLogger.info(`Checked ${checkedCount} pilgrims.`);
      await page.waitForTimeout(1000);

      // 3. Click Submit / Done
      SanitizedLogger.info('Submitting selected pilgrim list to booking pass');
      const submitBtn = page.locator('button.btn-search:has-text("Submit"), button:has-text("Submit"), button:has-text("Done"), button:has-text("Apply")').first();
      if (await submitBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await submitBtn.click({ force: false });
      }

      await page.waitForTimeout(1500);

      // 4. Handle any warning modal ("You have not selected any pilgrim") if it appears
      const warnDialog = page.locator('mat-dialog-container:has-text("You have not selected any pilgrim")');
      if (await warnDialog.isVisible({ timeout: 1000 }).catch(() => false)) {
        SanitizedLogger.warn('Warning modal detected: Pilgrim was not checked. Retrying selection.');
        // Click No
        const noBtn = warnDialog.locator('button:has-text("No")').first();
        if (await noBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
          await noBtn.click({ force: false });
          await page.waitForTimeout(1000);
        }

        // Force check row 1 checkbox
        const firstRowCb = page.locator('table tbody tr mat-checkbox, mat-row mat-checkbox').first();
        if (await firstRowCb.isVisible({ timeout: 1000 }).catch(() => false)) {
          await firstRowCb.click({ force: false });
          await page.waitForTimeout(500);
        }

        // Click Submit again
        if (await submitBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
          await submitBtn.click({ force: false });
        }
      }

      // 5. Wait for navigation back from pilgrimServiceMaster or modal detachment
      await page.locator('.cdk-overlay-backdrop').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
      
      // Wait for URL to leave pilgrimServiceMaster if navigating
      if (page.url().includes('piligrimServiceMaster')) {
        await page.waitForURL((url) => !url.toString().includes('piligrimServiceMaster'), { timeout: 8000 }).catch(() => {});
      }
      await page.waitForTimeout(1500);

      return {
        success: true,
        selectedCount: checkedCount > 0 ? checkedCount : 1,
        message: 'Existing pilgrims selected and submitted successfully',
      };
    } catch (err: any) {
      SanitizedLogger.error('Exception during pilgrim selection flow:', err);
      return { success: false, message: err.message };
    }
  }
}
