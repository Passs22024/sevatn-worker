import { Page } from 'playwright';
import { SABARIMALA_SELECTORS } from './selectors';
import { SabarimalaResultParser, OfficialBookingResult } from './result-parser';
import { SanitizedLogger } from '../monitoring/logger';

export interface PilgrimData {
  fullName?: string;
  age?: number;
  gender?: string;
  idType?: string;
  idNumber?: string;
  photoUrl?: string;
}

export class SabarimalaBooking {
  static async fillPilgrimsAndSubmit(
    page: Page,
    pilgrims?: PilgrimData[],
  ): Promise<OfficialBookingResult> {
    try {
      SanitizedLogger.info('Proceeding with official registered pilgrims selection');

      // 1. Submit pilgrim selection
      for (const sel of SABARIMALA_SELECTORS.pilgrimSelection.submitPilgrimsButton) {
        if (await page.locator(sel).first().isVisible().catch(() => false)) {
          await page.locator(sel).first().click();
          break;
        }
      }

      await page.waitForTimeout(2000);

      // Parse confirmation
      return await SabarimalaResultParser.extractConfirmation(page);
    } catch (err: any) {
      SanitizedLogger.error('Exception during pilgrim booking submission:', err);
      return {
        success: false,
        errorMessage: err.message || 'Error executing booking on official portal.',
      };
    }
  }
}
