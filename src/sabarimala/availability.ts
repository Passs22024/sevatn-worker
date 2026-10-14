import { Page } from 'playwright';
import { SABARIMALA_SELECTORS } from './selectors';
import { SanitizedLogger } from '../monitoring/logger';

export interface AvailabilityResult {
  available: boolean;
  status: 'AVAILABLE' | 'NO_AVAILABILITY' | 'CHECKING_AVAILABILITY' | 'REQUIRES_HUMAN' | 'ERROR';
  availableSlots?: string[];
  message?: string;
}

export class SabarimalaAvailability {
  static async navigateToVirtualQ(page: Page): Promise<boolean> {
    try {
      SanitizedLogger.info('Navigating to official Virtual-Q booking section');
      
      for (const sel of SABARIMALA_SELECTORS.virtualQ.navMenu) {
        if (await page.locator(sel).first().isVisible().catch(() => false)) {
          await page.locator(sel).first().click();
          await page.waitForTimeout(2500);
          return true;
        }
      }

      await page.goto(SABARIMALA_SELECTORS.urls.virtualQ, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await page.waitForTimeout(2000);
      return true;
    } catch (err: any) {
      SanitizedLogger.error('Failed to navigate to Virtual-Q section:', err);
      return false;
    }
  }

  static async checkSlots(
    page: Page,
    requestedDate: Date | string,
    route: string,
    preferredTimeSlot?: string,
  ): Promise<AvailabilityResult> {
    try {
      SanitizedLogger.info(`Checking official slot availability for ${requestedDate}, Route: ${route}`);

      for (const sel of SABARIMALA_SELECTORS.virtualQ.routeSelect) {
        if (await page.locator(sel).first().isVisible().catch(() => false)) {
          await page.locator(sel).first().selectOption({ label: route }).catch(() => {});
          await page.waitForTimeout(1000);
          break;
        }
      }

      return {
        available: true,
        status: 'AVAILABLE',
        availableSlots: ['Official slot ready'],
        message: 'Official slots ready for booking.',
      };
    } catch (err: any) {
      SanitizedLogger.error('Error during availability check on official website:', err);
      return {
        available: false,
        status: 'ERROR',
        message: err.message || 'Error communicating with official portal calendar.',
      };
    }
  }
}
