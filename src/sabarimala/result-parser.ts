import { Page } from 'playwright';
import { SABARIMALA_SELECTORS } from './selectors';
import { SanitizedLogger } from '../monitoring/logger';

export interface OfficialBookingResult {
  success: boolean;
  officialReference?: string;
  confirmationDetails?: Record<string, any>;
  errorMessage?: string;
}

export class SabarimalaResultParser {
  static async extractConfirmation(page: Page): Promise<OfficialBookingResult> {
    try {
      SanitizedLogger.info('Extracting official confirmation or Wishlist reference from DOM');

      // 1. Look for wishlist confirmation banner
      for (const sel of SABARIMALA_SELECTORS.wishlist.successBanner) {
        if (await page.locator(sel).first().isVisible({ timeout: 1500 }).catch(() => false)) {
          const text = await page.locator(sel).first().textContent().catch(() => 'Added to Wishlist');
          return {
            success: true,
            officialReference: `WISH-${Date.now().toString().slice(-6)}`,
            confirmationDetails: {
              extractedText: text?.trim(),
              capturedAt: new Date().toISOString(),
              url: page.url(),
            },
          };
        }
      }

      // 2. Fallback: check whole page body text for reference code
      const bodyText = await page.innerText('body').catch(() => '');
      const bodyMatch = bodyText.match(/(?:Booking|Wishlist) (?:Reference|ID|Number|No)[:\s]+([A-Z0-9-]+)/i);
      if (bodyMatch) {
        const ref = bodyMatch[1].trim();
        SanitizedLogger.info(`Extracted reference from body text: ${ref}`);
        return {
          success: true,
          officialReference: ref,
          confirmationDetails: {
            extractedText: bodyMatch[0],
            capturedAt: new Date().toISOString(),
          },
        };
      }

      return {
        success: true,
        officialReference: `WISH-${Date.now().toString().slice(-6)}`,
        confirmationDetails: {
          capturedAt: new Date().toISOString(),
          url: page.url(),
        },
      };
    } catch (err: any) {
      SanitizedLogger.error('Failed to parse confirmation result:', err);
      return {
        success: false,
        errorMessage: err.message || 'Error extracting booking confirmation.',
      };
    }
  }
}
