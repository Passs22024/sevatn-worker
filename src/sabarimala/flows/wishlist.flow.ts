import { Page } from 'playwright';
import { SanitizedLogger } from '../../monitoring/logger';
import { BookingExecutionContext, VirtualQWorkflowError } from './types';
import { FlowDiagnosticsManager } from './diagnostics';
import { SABARIMALA_SELECTORS } from '../selectors';
import { resolveCanonicalRoute, OFFICIAL_PORTAL_ROUTES } from './date-route.flow';

export class WishlistFlow {
  /**
   * Helper: Extract all text blocks / rows currently rendered in Wishlist drawer or table.
   * Does NOT modify, clear or remove any items.
   */
  static async getWishlistItemsText(page: Page): Promise<string[]> {
    const itemSelectors = [
      'app-wishlist .item',
      'app-wishlist .wishlist-list',
      'app-wishlist .item_content',
      'app-wishlist ul.wishlist-list li',
      ...SABARIMALA_SELECTORS.wishlist.tableRows,
      '.side-drawer table tbody tr',
      'mat-drawer table tbody tr',
      '.drawer table tbody tr',
      '.wishlist-drawer table tbody tr',
      '.side-drawer .wishlist-item',
      'mat-drawer .wishlist-item',
      '.drawer .wishlist-item',
      '.side-drawer mat-card',
      'mat-drawer mat-card',
      'mat-card.wishlist-card',
    ];

    const results: string[] = [];
    for (const sel of itemSelectors) {
      const locator = page.locator(sel);
      const count = await locator.count().catch(() => 0);
      for (let i = 0; i < count; i++) {
        const txt = await locator.nth(i).innerText().catch(() => '');
        if (txt.trim().length > 0) {
          results.push(txt.trim());
        }
      }
      if (results.length > 0) break;
    }
    return results;
  }

  /**
   * PHASE 7: Add to Wishlist and Authoritatively Verify the Newly Added Item
   * - Never clicks Proceed based only on button enabled state.
   * - Never treats an existing wishlist item as the newly created booking.
   * - Never clears or deletes existing wishlist entries automatically.
   * - Ignores existing unrelated wishlist entries.
   * - Strictly detects PREVIOUS_BOOKING_RESTRICTION portal error.
   */
  static async execute(page: Page, ctx: BookingExecutionContext): Promise<boolean> {
    SanitizedLogger.info(`[WISHLIST] Initiating Wishlist flow for Booking #${ctx.bookingCode}`);
    SanitizedLogger.info('[WISHLIST] Staying on Virtual-Q page: https://sabarimalaonline.org/#/darshan');
    SanitizedLogger.info('[WISHLIST] Inspecting My Wishlist panel on Virtual-Q page');

    try {
      // Step 7.1: Pre-submission verification of context completeness
      if (!ctx.requestedDate || !ctx.requestedRoute || !ctx.selectedTimeSlot) {
        const diag = await FlowDiagnosticsManager.captureDiagnostics(page, 'PHASE_7_WISHLIST', ctx.bookingCode);
        throw new VirtualQWorkflowError(
          'WISHLIST_INSERTION_FAILED',
          `Cannot add to wishlist: Incomplete booking context (Date: ${ctx.requestedDate}, Route: ${ctx.requestedRoute}, Slot: ${ctx.selectedTimeSlot})`,
          'PHASE_7_WISHLIST',
          diag,
        );
      }

      // Step 7.2: Snapshot existing items in Wishlist BEFORE clicking Add to Wishlist.
      // This ensures existing entries are never treated as the newly created booking.
      const preExistingItems = await this.getWishlistItemsText(page);
      SanitizedLogger.info(
        `[WISHLIST] Pre-existing wishlist items count: ${preExistingItems.length}. Existing items will be preserved and not treated as new booking.`,
      );

      // Step 7.3: Check for any pre-existing restriction banner before clicking
      await this.checkForPortalRestrictions(page, ctx);

      // Step 7.4: Locate "Add to Wishlist" button (Avoid Reset button which shares id="regi_continue")
      const addBtn = page.locator(
        'button.btn-addto, button:has-text("Add to Wishlist"), button:has-text("Add To Wishlist"), button#regi_continue:has-text("Add to Wishlist"), .btn-wishlist'
      ).first();

      const isBtnVisible = await addBtn.isVisible({ timeout: 4000 }).catch(() => false);
      if (!isBtnVisible) {
        const diag = await FlowDiagnosticsManager.captureDiagnostics(page, 'PHASE_7_WISHLIST', ctx.bookingCode);
        throw new VirtualQWorkflowError(
          'WISHLIST_INSERTION_FAILED',
          '"Add to Wishlist" button not found on official form',
          'PHASE_7_WISHLIST',
          diag,
        );
      }

      // Check if button is disabled due to missing mandatory form fields
      const isDisabled = await addBtn.isDisabled().catch(() => false);
      if (isDisabled) {
        const diag = await FlowDiagnosticsManager.captureDiagnostics(page, 'PHASE_7_WISHLIST', ctx.bookingCode);
        throw new VirtualQWorkflowError(
          'WISHLIST_INSERTION_FAILED',
          'BUTTON_DISABLED: "Add to Wishlist" button is disabled. Mandatory form fields incomplete on official portal.',
          'PHASE_7_WISHLIST',
          diag,
        );
      }

      // Click "Add to Wishlist" without force
      await addBtn.scrollIntoViewIfNeeded().catch(() => {});
      await addBtn.click({ force: false });
      SanitizedLogger.info(`[WISHLIST] Clicked "Add to Wishlist" button. Waiting for portal response...`);

      // Bounded wait for network response / DOM mutations
      await page.waitForTimeout(1500);

      // Step 7.5: Immediate check for PREVIOUS_BOOKING_RESTRICTION or other portal rejection banners
      await this.checkForPortalRestrictions(page, ctx);

      // Step 7.6: Wait for Wishlist panel/drawer to update and detect the NEWLY ADDED item
      const startTime = Date.now();
      const waitTimeoutMs = 12000;
      let newlyAddedItemFound = false;
      let mismatchReason = '';

      while (Date.now() - startTime < waitTimeoutMs) {
        // Re-check for restriction popups/toasts that appear asynchronously
        await this.checkForPortalRestrictions(page, ctx);

        const currentItems = await this.getWishlistItemsText(page);

        // Find items that were NOT present before or whose count increased
        const candidateItems = currentItems.length > preExistingItems.length
          ? currentItems.slice(preExistingItems.length)
          : currentItems;

        for (const itemText of candidateItems) {
          // If item was already in preExistingItems, skip it to prevent treating existing items as new
          if (preExistingItems.includes(itemText) && currentItems.length === preExistingItems.length) {
            continue;
          }

          // Verify 5 mandatory attributes independently
          const dateMatch = this.matchesDate(itemText, ctx.requestedDate, ctx.requestedDateDisplay);
          const slotMatch = this.matchesSlot(itemText, ctx.selectedTimeSlot);
          const routeMatch = this.matchesRoute(itemText, ctx.requestedRoute);
          const pilgrimMatch = this.matchesPilgrimCount(itemText, ctx.pilgrimCount);
          const reliefMatch = this.matchesReliefAmount(itemText);

          if (dateMatch && slotMatch && routeMatch && pilgrimMatch && reliefMatch) {
            newlyAddedItemFound = true;
            SanitizedLogger.info(
              `[WISHLIST] ✅ Newly added item verified in Wishlist: Date=${ctx.requestedDateDisplay || ctx.requestedDate}, Route=${ctx.requestedRoute}, Slot=${ctx.selectedTimeSlot}, Pilgrims=${ctx.pilgrimCount}, ReliefFund=₹0`,
            );
            break;
          } else {
            // Record mismatch details for diagnostics
            const fails: string[] = [];
            if (!dateMatch) fails.push(`Date mismatch (expected ${ctx.requestedDateDisplay || ctx.requestedDate})`);
            if (!slotMatch) fails.push(`Slot mismatch (expected ${ctx.selectedTimeSlot})`);
            if (!routeMatch) fails.push(`Route mismatch (expected ${ctx.requestedRoute})`);
            if (!pilgrimMatch) fails.push(`Pilgrim count mismatch (expected ${ctx.pilgrimCount})`);
            if (!reliefMatch) fails.push(`Relief fund mismatch (expected ₹0)`);
            mismatchReason = fails.join(', ');
          }
        }

        if (newlyAddedItemFound) break;
        await page.waitForTimeout(600);
      }

      if (!newlyAddedItemFound) {
        const diag = await FlowDiagnosticsManager.captureDiagnostics(page, 'PHASE_7_WISHLIST', ctx.bookingCode);
        throw new VirtualQWorkflowError(
          'WISHLIST_MISMATCH',
          `Add to Wishlist completed but newly added item verification failed: ${mismatchReason || 'Matching item not detected in wishlist drawer'}`,
          'PHASE_7_WISHLIST',
          diag,
        );
      }

      ctx.wishlistStatus = 'VERIFIED';
      ctx.newlyAddedWishlistVerified = true;
      return true;
    } catch (err: any) {
      if (err instanceof VirtualQWorkflowError) throw err;
      const diag = await FlowDiagnosticsManager.captureDiagnostics(page, 'PHASE_7_WISHLIST', ctx.bookingCode);
      throw new VirtualQWorkflowError(
        'WISHLIST_INSERTION_FAILED',
        err.message || 'Failed to add or verify item in Wishlist',
        'PHASE_7_WISHLIST',
        diag,
      );
    }
  }

  /**
   * Helper: Checks page for PREVIOUS_BOOKING_RESTRICTION banners or toasts
   */
  static async checkForPortalRestrictions(page: Page, ctx: BookingExecutionContext): Promise<void> {
    const restrictionSelectors = [
      ...SABARIMALA_SELECTORS.portalWarnings.previousBookingRestriction,
      '.toast-error',
      '.toast-message',
      '.alert-danger',
      '.swal2-html-container',
      '.mat-error',
    ];

    for (const sel of restrictionSelectors) {
      try {
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: 200 }).catch(() => false)) {
          const txt = await el.innerText().catch(() => '');
          if (
            /avail\s+previous\s+booking/i.test(txt) ||
            /cannot\s+make\s+transaction\s+until\s+you\s+avail/i.test(txt) ||
            /previous\s+booking/i.test(txt) ||
            /already\s+booked/i.test(txt) ||
            /active\s+booking\s+exists/i.test(txt)
          ) {
            SanitizedLogger.error(`[WISHLIST] ⛔ PREVIOUS_BOOKING_RESTRICTION detected on official portal: "${txt.trim()}"`);
            const diag = await FlowDiagnosticsManager.captureDiagnostics(page, 'PHASE_7_WISHLIST', ctx.bookingCode);
            throw new VirtualQWorkflowError(
              'PREVIOUS_BOOKING_RESTRICTION',
              `PREVIOUS_BOOKING_RESTRICTION: Official portal reports you cannot make transaction until you avail previous booking. ("${txt.trim()}")`,
              'PHASE_7_WISHLIST',
              diag,
            );
          }
        }
      } catch (checkErr: any) {
        if (checkErr instanceof VirtualQWorkflowError) throw checkErr;
      }
    }
  }

  /**
   * Helper: Inspects wishlist panel/drawer/table for matching item
   */
  static async verifyItemInWishlist(page: Page, ctx: BookingExecutionContext, silent = false): Promise<boolean> {
    const items = await this.getWishlistItemsText(page);
    for (const rowText of items) {
      const dateMatch = this.matchesDate(rowText, ctx.requestedDate, ctx.requestedDateDisplay);
      const slotMatch = !ctx.selectedTimeSlot || this.matchesSlot(rowText, ctx.selectedTimeSlot);
      const routeMatch = this.matchesRoute(rowText, ctx.requestedRoute);
      const pilgrimMatch = this.matchesPilgrimCount(rowText, ctx.pilgrimCount);
      const reliefMatch = this.matchesReliefAmount(rowText);

      if (dateMatch && slotMatch && routeMatch && pilgrimMatch && reliefMatch) {
        if (!silent) {
          SanitizedLogger.info(
            `[WISHLIST] Authoritative item match verified: Date=${ctx.requestedDateDisplay || ctx.requestedDate}, Route=${ctx.requestedRoute}, Slot=${ctx.selectedTimeSlot}`,
          );
        }
        return true;
      }
    }
    return false;
  }

  static matchesDate(text: string, isoDate: string, displayDate?: string): boolean {
    if (!text || !isoDate) return false;
    if (text.includes(isoDate)) return true;
    if (displayDate && text.includes(displayDate)) return true;

    const parts = isoDate.split('-');
    if (parts.length === 3) {
      const ddmmyyyy = `${parts[2]}-${parts[1]}-${parts[0]}`;
      const ddmmyyyySlash = `${parts[2]}/${parts[1]}/${parts[0]}`;
      if (text.includes(ddmmyyyy) || text.includes(ddmmyyyySlash)) return true;
    }
    return false;
  }

  static matchesSlot(text: string, slot?: string): boolean {
    if (!slot || slot === 'Any' || slot === 'Any Slot') return true;
    const cleanSlot = slot.replace(/\s+/g, '');
    const cleanText = text.replace(/\s+/g, '');
    return cleanText.includes(cleanSlot);
  }

  static matchesRoute(text: string, requestedRoute?: string): boolean {
    if (!requestedRoute) return true;
    const canonical = resolveCanonicalRoute(requestedRoute);
    if (!canonical) return true;

    const normText = text.toLowerCase().replace(/[^a-z0-9]/g, '');

    // Check if item text contains a competing route name - if so, this item is for a DIFFERENT route!
    for (const key of Object.keys(OFFICIAL_PORTAL_ROUTES)) {
      const otherDef = OFFICIAL_PORTAL_ROUTES[key];
      if (otherDef.canonicalName !== canonical.canonicalName) {
        const otherNorm = otherDef.primaryKeyword.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (normText.includes(otherNorm)) {
          return false;
        }
      }
    }

    // If the drawer item explicitly mentions any route keyword, verify it matches our expected route
    const hasAnyRouteMention = Object.values(OFFICIAL_PORTAL_ROUTES).some(def =>
      normText.includes(def.primaryKeyword)
    );

    if (hasAnyRouteMention) {
      return normText.includes(canonical.primaryKeyword);
    }

    return true;
  }

  static matchesPilgrimCount(text: string, count?: number): boolean {
    if (!count) return true;
    const norm = text.toLowerCase();
    const matchAfter = norm.match(/(?:pilgrim(?:s)?|person(?:s)?|count)[\s:=]*(\d+)/i);
    if (matchAfter) {
      return parseInt(matchAfter[1], 10) === count;
    }
    const matchBefore = norm.match(/(\d+)\s*(?:pilgrim|person)/i);
    if (matchBefore) {
      return parseInt(matchBefore[1], 10) === count;
    }
    return true;
  }

  static matchesReliefAmount(text: string): boolean {
    const norm = text.toLowerCase();
    if (/relief\s*(?:fund)?\s*[:=]?\s*no/i.test(norm)) {
      return true;
    }
    const match = norm.match(/(?:relief\s*(?:fund)?\s*(?:amount)?)\s*[:=]?\s*(?:₹|rs\.?)?\s*(\d+)/i);
    if (match) {
      const amount = parseInt(match[1], 10);
      return amount === 0;
    }
    if (norm.includes('relief') && /(?:relief|fund)[^\d\n]*[1-9]\d*/i.test(norm)) {
      return false;
    }
    return true;
  }
}
