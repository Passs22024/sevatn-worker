import { Page } from 'playwright';
import { SanitizedLogger } from '../../monitoring/logger';
import { BookingExecutionContext, VirtualQWorkflowError } from './types';
import { FlowDiagnosticsManager } from './diagnostics';

export interface TimeSlotSelectionResult {
  success: boolean;
  selectedSlot: string;
  availabilityCount?: number;
}

export class TimeSlotSelectionFlow {
  /**
   * Helper: Wait for any Angular/CDK loading overlay or spinner to detach
   */
  static async waitForSpinnerDetached(page: Page, timeoutMs = 8000): Promise<void> {
    try {
      const loc = page.locator('.cdk-overlay-backdrop, .ngx-spinner-overlay, .loading-spinner, .mat-progress-spinner');
      const count = await loc.count().catch(() => 0);
      if (count > 0) {
        const target = loc.first();
        await target.waitFor({ state: 'detached', timeout: timeoutMs }).catch(() => {});
      }
    } catch {}
  }

  /**
   * PHASE 3 — Step 3: Wait for and Select Time Slots on #/darshan
   */
  static async selectTimeSlot(page: Page, ctx: BookingExecutionContext): Promise<TimeSlotSelectionResult> {
    SanitizedLogger.info(`[TIME-SLOT] Discovering available time slots for Date: ${ctx.requestedDate}, Route: ${ctx.requestedRoute}`);

    // Wait for spinners to detach before reading DOM
    await this.waitForSpinnerDetached(page);

    const slotCardLocator = page.locator(
      '.slot-dar-3, .slot-dar-5, .slot-box, .slot-card, div[class*="slot-dar-"], [id^="myName_"], mat-radio-button[name*="slot"]'
    );

    // Bounded dynamic poll for slot cards (up to 15s)
    let count = await slotCardLocator.count().catch(() => 0);
    if (count === 0) {
      SanitizedLogger.info('[TIME-SLOT] Waiting for official slot cards to load...');
      const startTime = Date.now();
      const maxWaitMs = 15000;
      while (Date.now() - startTime < maxWaitMs) {
        await page.waitForTimeout(500);
        await this.waitForSpinnerDetached(page, 1000);
        count = await slotCardLocator.count().catch(() => 0);
        if (count > 0) break;
      }
    }

    // STRICT CHECK: If slot cards do not appear, capture diagnostics and throw SLOT_CARDS_MISSING
    if (count === 0) {
      const diag = await FlowDiagnosticsManager.captureDiagnostics(page, 'PHASE_3_TIME_SLOT_SELECTION', ctx.bookingCode, {
        selectedDate: ctx.requestedDate,
        selectedRoute: ctx.requestedRoute,
      });
      throw new VirtualQWorkflowError(
        'SLOT_CARDS_MISSING',
        `SLOT_CARDS_MISSING: No slot cards appeared on authenticated booking page for date ${ctx.requestedDate} and route "${ctx.requestedRoute}". Stopping safely before pilgrim submission.`,
        'PHASE_3_TIME_SLOT_SELECTION',
        diag,
      );
    }

    SanitizedLogger.info(`[TIME-SLOT] Found ${count} slot cards on official booking form.`);

    let chosenCard: any = null;
    let chosenTimeText = '';
    let chosenAvailability = 0;

    // 1. If preferred slot specified (and not 'Any Slot' / 'Any'), search for exact time interval match
    const hasSpecificPreference =
      ctx.selectedTimeSlot &&
      ctx.selectedTimeSlot !== 'Any' &&
      ctx.selectedTimeSlot !== 'Any Slot' &&
      ctx.selectedTimeSlot.toUpperCase() !== 'ANY';

    if (hasSpecificPreference) {
      const prefClean = ctx.selectedTimeSlot!.replace(/\s+/g, '');
      for (let i = 0; i < count; i++) {
        const card = slotCardLocator.nth(i);
        const text = (await card.innerText().catch(() => '')).trim();
        const norm = text.replace(/\s+/g, '');

        if (norm.includes(prefClean)) {
          const isFull = await card.evaluate((el: HTMLElement) =>
            el.classList.contains('slot-dar-2') ||
            el.classList.contains('disabled') ||
            el.classList.contains('slot-full') ||
            el.getAttribute('aria-disabled') === 'true'
          ).catch(() => false);

          if (!isFull) {
            const availMatch = text.match(/Availability\s*:\s*(\d+)/i) || text.match(/(\d+)\s*Available/i);
            const availNum = availMatch ? parseInt(availMatch[1], 10) : 100;
            if (availNum > 0) {
              chosenCard = card;
              chosenTimeText = text;
              chosenAvailability = availNum;
              break;
            }
          }
        }
      }
    }

    // 2. Fallback: Select first available slot card with positive availability
    if (!chosenCard) {
      for (let i = 0; i < count; i++) {
        const card = slotCardLocator.nth(i);
        const isAvailable = await card.evaluate((el: HTMLElement) => {
          if (
            el.classList.contains('slot-dar-2') ||
            el.classList.contains('disabled') ||
            el.classList.contains('slot-full') ||
            el.getAttribute('aria-disabled') === 'true'
          ) {
            return false;
          }
          return (
            el.classList.contains('slot-dar-3') ||
            el.classList.contains('slot-dar-5') ||
            el.classList.contains('available') ||
            !el.hasAttribute('disabled')
          );
        }).catch(() => false);

        if (isAvailable) {
          const text = (await card.innerText().catch(() => '')).trim();
          const availMatch = text.match(/Availability\s*:\s*(\d+)/i) || text.match(/(\d+)\s*Available/i);
          const availNum = availMatch ? parseInt(availMatch[1], 10) : 100;

          if (availNum > 0) {
            chosenCard = card;
            chosenTimeText = text;
            chosenAvailability = availNum;
            break;
          }
        }
      }
    }

    if (!chosenCard) {
      const diag = await FlowDiagnosticsManager.captureDiagnostics(page, 'PHASE_3_TIME_SLOT_SELECTION', ctx.bookingCode, {
        selectedDate: ctx.requestedDate,
        selectedRoute: ctx.requestedRoute,
      });
      throw new VirtualQWorkflowError(
        'SLOT_UNAVAILABLE',
        `All visible time slots for date ${ctx.requestedDate} are fully booked or closed on official portal`,
        'PHASE_3_TIME_SLOT_SELECTION',
        diag,
      );
    }

    // Extract standard time range
    const timeIntervalMatch = chosenTimeText.match(/(\d{2}:\d{2}\s*-\s*\d{2}:\d{2})/);
    const resolvedSlotTime = timeIntervalMatch ? timeIntervalMatch[1].trim() : '';

    if (!resolvedSlotTime) {
      const diag = await FlowDiagnosticsManager.captureDiagnostics(page, 'PHASE_3_TIME_SLOT_SELECTION', ctx.bookingCode, {
        selectedDate: ctx.requestedDate,
        selectedRoute: ctx.requestedRoute,
      });
      throw new VirtualQWorkflowError(
        'SLOT_SELECTION_FAILED',
        `Could not extract valid time interval from slot card text: "${chosenTimeText}"`,
        'PHASE_3_TIME_SLOT_SELECTION',
        diag,
      );
    }

    // Click slot card to select it
    await chosenCard.scrollIntoViewIfNeeded().catch(() => {});
    await chosenCard.click({ force: false });
    await page.waitForTimeout(800);

    // Verify selection indicator on the card
    let isSelected = await chosenCard.evaluate((el: HTMLElement) => {
      const container = el.closest('.slot-dar-3, .slot-dar-5, .slot-box, .slot-card, div[class*="slot"]') || el;
      return (
        container.classList.contains('slot-dar-5') ||
        container.classList.contains('selected') ||
        container.classList.contains('active') ||
        container.getAttribute('aria-selected') === 'true' ||
        el.classList.contains('slot-dar-5') ||
        el.classList.contains('selected') ||
        el.classList.contains('active')
      );
    }).catch(() => false);

    // If not verified directly, check if any slot card matching resolvedSlotTime now has .slot-dar-5
    if (!isSelected) {
      const selectedMatch = page.locator('.slot-dar-5, .slot-card.active, .slot-card.selected, [aria-selected="true"]');
      if ((await selectedMatch.count().catch(() => 0)) > 0) {
        isSelected = true;
      }
    }

    // Retry once if selection didn't register
    if (!isSelected) {
      SanitizedLogger.info(`[TIME-SLOT] Selection not immediately confirmed for ${resolvedSlotTime}. Retrying click...`);
      await chosenCard.click({ force: false }).catch(() => {});
      await page.waitForTimeout(800);
      const selectedMatch = page.locator('.slot-dar-5, .slot-card.active, .slot-card.selected, [aria-selected="true"]');
      if ((await selectedMatch.count().catch(() => 0)) > 0) {
        isSelected = true;
      }
    }

    if (!isSelected) {
      const diag = await FlowDiagnosticsManager.captureDiagnostics(page, 'PHASE_3_TIME_SLOT_SELECTION', ctx.bookingCode, {
        selectedDate: ctx.requestedDate,
        selectedRoute: ctx.requestedRoute,
      });
      throw new VirtualQWorkflowError(
        'SLOT_SELECTION_FAILED',
        `SLOT_SELECTION_UNVERIFIED: Clicked slot card ${resolvedSlotTime} but official portal did not accept the selection (.slot-dar-5 missing)`,
        'PHASE_3_TIME_SLOT_SELECTION',
        diag,
      );
    }

    ctx.selectedTimeSlot = resolvedSlotTime;
    SanitizedLogger.info(`[TIME-SLOT] Selected time slot verified on official portal: "${resolvedSlotTime}" (Availability: ${chosenAvailability})`);

    return {
      success: true,
      selectedSlot: resolvedSlotTime,
      availabilityCount: chosenAvailability,
    };
  }
}

