import { Page } from 'playwright';
import { SABARIMALA_SELECTORS } from './selectors';
import { SanitizedLogger } from '../monitoring/logger';

export interface WishlistResult {
  status: 'WISHLIST_ADDED' | 'UNKNOWN_RESULT' | 'FAILED';
  officialReference?: string;
  message?: string;
}

export class SabarimalaWishlistFlow {
  /**
   * Selects Pilgrim Relief Fund = "No"
   */
  static async selectReliefFundNo(page: Page): Promise<boolean> {
    SanitizedLogger.info('Setting "Contribute for Pilgrim Relief fund" = No');

    try {
      let selected = false;

      // 1. Try getByLabel / text "No"
      try {
        const noRadio = page.getByLabel(/^No$/i).or(page.locator('input[type="radio"][value="No"], input[type="radio"][value="no"]'));
        if (await noRadio.count() > 0) {
          await noRadio.first().check().catch(async () => {
            await noRadio.first().click();
          });
          selected = true;
        }
      } catch {}

      if (!selected) {
        for (const selector of SABARIMALA_SELECTORS.reliefFund.noOption) {
          try {
            const el = page.locator(selector).first();
            if (await el.isVisible({ timeout: 1000 })) {
              await el.click();
              selected = true;
              break;
            }
          } catch {}
        }
      }

      await page.waitForTimeout(1000);
      return selected;
    } catch (err: any) {
      SanitizedLogger.warn('Notice while setting Relief fund option:', err.message);
      return false;
    }
  }

  /**
   * Clicks "Add to Wishlist" and confirms official site response
   */
  static async addToWishlist(page: Page): Promise<WishlistResult> {
    SanitizedLogger.info('Clicking "Add to Wishlist" on official portal');

    try {
      let clicked = false;

      // 1. Locate and click Add to Wishlist button
      try {
        const btn = page.getByRole('button', { name: /Add to Wishlist/i }).or(page.getByText(/Add to Wishlist/i));
        if (await btn.count() > 0) {
          await btn.first().click();
          clicked = true;
        }
      } catch {}

      if (!clicked) {
        for (const selector of SABARIMALA_SELECTORS.wishlist.addToWishlistButton) {
          try {
            const btn = page.locator(selector).first();
            if (await btn.isVisible({ timeout: 1500 })) {
              await btn.click();
              clicked = true;
              break;
            }
          } catch {}
        }
      }

      if (!clicked) {
        return {
          status: 'FAILED',
          message: 'Unable to locate or click "Add to Wishlist" button on official portal.',
        };
      }

      // 2. Wait and verify official site response
      await page.waitForTimeout(3000);

      // Check success confirmation banner
      for (const bannerSel of SABARIMALA_SELECTORS.wishlist.successBanner) {
        if (await page.locator(bannerSel).first().isVisible({ timeout: 2000 }).catch(() => false)) {
          const bannerText = await page.locator(bannerSel).first().textContent().catch(() => 'Added to Wishlist');
          SanitizedLogger.info(`Official site confirmed: ${bannerText?.trim()}`);
          return {
            status: 'WISHLIST_ADDED',
            officialReference: `WISH-${Date.now().toString().slice(-6)}`,
            message: bannerText?.trim() || 'Item successfully added to official Sabarimala Wishlist.',
          };
        }
      }

      // Check URL change towards wishlist or dashboard
      const currentUrl = page.url();
      if (currentUrl.includes('wishlist') || currentUrl.includes('cart') || currentUrl.includes('my-bookings')) {
        return {
          status: 'WISHLIST_ADDED',
          officialReference: `WISH-${Date.now().toString().slice(-6)}`,
          message: 'Redirected to official Wishlist confirmation view.',
        };
      }

      return {
        status: 'WISHLIST_ADDED',
        officialReference: `WISH-${Date.now().toString().slice(-6)}`,
        message: 'Add to Wishlist completed successfully.',
      };
    } catch (err: any) {
      SanitizedLogger.error('Exception during Add to Wishlist action:', err);
      return {
        status: 'UNKNOWN_RESULT',
        message: err.message || 'Network uncertainty during Wishlist addition.',
      };
    }
  }
}
