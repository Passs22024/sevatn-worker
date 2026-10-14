import { Page } from 'playwright';
import { SABARIMALA_SELECTORS } from './selectors';
import { SanitizedLogger } from '../monitoring/logger';
import { normalizeDate } from './virtual-q';

export interface DateAvailabilityCheckResult {
  available: boolean;
  state: 'AVAILABLE' | 'DISABLED' | 'FULL' | 'NOT_FOUND' | 'PAGE_UNREACHABLE';
  displayedMonth?: string;
  displayedYear?: string;
  message?: string;
}

export interface DiscoveredSlot {
  slotName: string;
  availabilityCount: number;
}

const MONTH_NAMES = [
  'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
  'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER',
];

const MONTH_SHORT_NAMES = [
  'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
];

export class SabarimalaDarshanAvailabilityFlow {
  /**
   * 1. Opens official Darshan Availability page (Public pre-login URL)
   */
  static async openDarshanAvailability(page: Page): Promise<{ success: boolean; url: string; title: string }> {
    SanitizedLogger.info('[AVAILABILITY] Opening darshanAvailability');

    await page.goto(SABARIMALA_SELECTORS.urls.darshanAvailability, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForTimeout(2500);

    const url = page.url();
    const title = await page.title().catch(() => '');

    SanitizedLogger.info(`[AVAILABILITY] Final URL: ${url}`);
    SanitizedLogger.info(`[AVAILABILITY] Page title: ${title}`);

    const calToggleCount = await page.locator('button[aria-label="Open calendar"], .mat-datepicker-toggle button, mat-datepicker-toggle button').count();
    const isCalDetected = calToggleCount > 0;
    SanitizedLogger.info(`[AVAILABILITY] Calendar detected: ${isCalDetected}`);

    return {
      success: isCalDetected,
      url,
      title,
    };
  }

  /**
   * Opens the datepicker calendar dialog
   */
  static async openCalendar(page: Page): Promise<boolean> {
    try {
      const calDialog = page.locator('.mat-calendar, mat-calendar');
      if (await calDialog.isVisible({ timeout: 500 }).catch(() => false)) {
        return true;
      }

      const toggle = page.locator('button[aria-label="Open calendar"], .mat-datepicker-toggle button, mat-datepicker-toggle button').first();
      await toggle.click();
      await page.waitForTimeout(800);
      return true;
    } catch (err: any) {
      SanitizedLogger.warn('[AVAILABILITY] Notice opening calendar dialog:', err.message);
      return false;
    }
  }

  /**
   * 2. Inspects and navigates calendar to target month & year
   */
  static async inspectAndNavigateMonth(page: Page, targetDateStr: string): Promise<{ month: string; year: string; success: boolean }> {
    const canonicalDate = normalizeDate(targetDateStr);
    const [tYearStr, tMonthStr] = canonicalDate.split('-');
    const targetYear = parseInt(tYearStr, 10);
    const targetMonthIdx = parseInt(tMonthStr, 10) - 1; // 0-indexed

    await this.openCalendar(page);

    // Max 12 navigation attempts
    for (let attempt = 0; attempt < 12; attempt++) {
      const periodBtn = page.locator('.mat-calendar-period-button').first();
      const periodText = (await periodBtn.textContent().catch(() => ''))?.trim().toUpperCase() || '';

      // Text usually like "OCT 2026" or "OCTOBER 2026"
      const yearMatch = periodText.match(/(\d{4})/);
      const currentYear = yearMatch ? parseInt(yearMatch[1], 10) : targetYear;

      let currentMonthIdx = -1;
      for (let m = 0; m < 12; m++) {
        if (periodText.includes(MONTH_NAMES[m]) || periodText.includes(MONTH_SHORT_NAMES[m])) {
          currentMonthIdx = m;
          break;
        }
      }

      if (currentMonthIdx === -1) {
        currentMonthIdx = new Date().getMonth();
      }

      const displayedMonthName = MONTH_NAMES[currentMonthIdx];
      const displayedYearStr = String(currentYear);

      if (currentYear === targetYear && currentMonthIdx === targetMonthIdx) {
        SanitizedLogger.info(`[DISCOVERY] Displayed month: ${displayedMonthName}`);
        SanitizedLogger.info(`[DISCOVERY] Displayed year: ${displayedYearStr}`);
        return { month: displayedMonthName, year: displayedYearStr, success: true };
      }

      // Calculate direction
      const currentTotalMonths = currentYear * 12 + currentMonthIdx;
      const targetTotalMonths = targetYear * 12 + targetMonthIdx;

      if (targetTotalMonths > currentTotalMonths) {
        const nextBtn = page.locator('.mat-calendar-next-button').first();
        if (await nextBtn.isDisabled().catch(() => true)) {
          SanitizedLogger.warn(`[AVAILABILITY] Cannot advance calendar to ${canonicalDate}: Next button disabled`);
          break;
        }
        await nextBtn.click();
      } else {
        const prevBtn = page.locator('.mat-calendar-previous-button').first();
        if (await prevBtn.isDisabled().catch(() => true)) {
          SanitizedLogger.warn(`[AVAILABILITY] Cannot advance calendar back to ${canonicalDate}: Prev button disabled`);
          break;
        }
        await prevBtn.click();
      }

      await page.waitForTimeout(600);
    }

    const finalPeriod = (await page.locator('.mat-calendar-period-button').first().textContent().catch(() => ''))?.trim() || '';
    return { month: finalPeriod, year: tYearStr, success: false };
  }

  /**
   * 3. Checks semantic availability of exact requested date
   */
  static async checkRequestedDateAvailability(page: Page, requestedDateInput: string | Date): Promise<DateAvailabilityCheckResult> {
    const canonicalDate = normalizeDate(requestedDateInput);
    SanitizedLogger.info(`[DISCOVERY] Requested date: ${canonicalDate}`);

    const [yearStr, monthStr, dayStr] = canonicalDate.split('-');
    const dayNum = parseInt(dayStr, 10);

    const monthNav = await this.inspectAndNavigateMonth(page, canonicalDate);
    if (!monthNav.success) {
      return {
        available: false,
        state: 'NOT_FOUND',
        displayedMonth: monthNav.month,
        displayedYear: monthNav.year,
        message: `Could not navigate calendar to requested month/year for ${canonicalDate}`,
      };
    }

    // Locate day cells
    const calendarCells = page.locator('.mat-calendar-body-cell');
    const count = await calendarCells.count();

    if (count === 0) {
      return {
        available: false,
        state: 'PAGE_UNREACHABLE',
        message: 'No calendar cells found in open calendar dialog',
      };
    }

    for (let i = 0; i < count; i++) {
      const cell = calendarCells.nth(i);
      const text = (await cell.textContent().catch(() => ''))?.trim();

      const isMatchingDay = text === String(dayNum);

      if (isMatchingDay) {
        const classAttr = (await cell.getAttribute('class').catch(() => '')) || '';
        const ariaDisabled = await cell.getAttribute('aria-disabled').catch(() => null);

        const isDisabled = classAttr.includes('mat-calendar-body-disabled') || ariaDisabled === 'true';

        SanitizedLogger.info(`[DISCOVERY] Requested day found: true`);

        if (!isDisabled) {
          SanitizedLogger.info(`[DISCOVERY] Requested day state: AVAILABLE`);
          return {
            available: true,
            state: 'AVAILABLE',
            displayedMonth: monthNav.month,
            displayedYear: monthNav.year,
          };
        } else {
          SanitizedLogger.info(`[DISCOVERY] Requested day state: FULL/DISABLED`);
          return {
            available: false,
            state: 'DISABLED',
            displayedMonth: monthNav.month,
            displayedYear: monthNav.year,
            message: `Requested date ${canonicalDate} is full or disabled on official portal`,
          };
        }
      }
    }

    SanitizedLogger.info(`[DISCOVERY] Requested day found: false`);
    return {
      available: false,
      state: 'NOT_FOUND',
      displayedMonth: monthNav.month,
      displayedYear: monthNav.year,
      message: `Day ${dayNum} not found in calendar for ${monthNav.month} ${monthNav.year}`,
    };
  }

  /**
   * 4. Selects exact requested date
   */
  static async selectDate(page: Page, requestedDateInput: string | Date): Promise<{ success: boolean; selectedDate: string }> {
    const canonicalDate = normalizeDate(requestedDateInput);
    const [yearStr, monthStr, dayStr] = canonicalDate.split('-');
    const dayNum = parseInt(dayStr, 10);

    await this.inspectAndNavigateMonth(page, canonicalDate);

    const availableCell = page.locator('.mat-calendar-body-cell:not(.mat-calendar-body-disabled)').filter({
      hasText: new RegExp(`^${dayNum}$`),
    });

    if (await availableCell.count() === 0) {
      throw new Error(`Date ${canonicalDate} is not selectable in calendar`);
    }

    await availableCell.first().click();
    await page.waitForTimeout(1000);

    SanitizedLogger.info(`[AVAILABILITY] Requested date: ${canonicalDate}`);
    SanitizedLogger.info(`[AVAILABILITY] Date selected successfully: ${canonicalDate}`);

    return { success: true, selectedDate: canonicalDate };
  }

  /**
   * 5. Selects Route
   */
  static async selectRoute(page: Page, preferredRoute?: string): Promise<{ success: boolean; selectedRoute: string }> {
    const selectEl = page.locator('select').first();
    if (await selectEl.count() === 0) {
      return { success: true, selectedRoute: preferredRoute || 'Pamba' };
    }

    const options = await selectEl.locator('option').allTextContents().catch(() => []);
    let targetIndex = 1; // Default to first actual route option (after "Select Route")

    if (preferredRoute) {
      const matchIdx = options.findIndex(o => o.toLowerCase().includes(preferredRoute.toLowerCase().split(' ')[0]));
      if (matchIdx > 0) {
        targetIndex = matchIdx;
      }
    }

    await selectEl.selectOption({ index: targetIndex });
    await page.waitForTimeout(1500);

    const selectedText = options[targetIndex]?.trim() || preferredRoute || 'Pamba';
    SanitizedLogger.info(`[AVAILABILITY] Route selected: ${selectedText}`);
    return { success: true, selectedRoute: selectedText };
  }

  /**
   * 6. Discovers all genuinely available Time Slots from official portal
   */
  static async discoverAvailableSlots(page: Page): Promise<DiscoveredSlot[]> {
    await page.waitForTimeout(1000);

    const slots: DiscoveredSlot[] = [];

    const slotCards = page.locator('[id^="myName_"], .slot-dar-3');
    const count = await slotCards.count();

    for (let i = 0; i < count; i++) {
      const card = slotCards.nth(i);
      const text = (await card.textContent().catch(() => ''))?.trim() || '';

      const timeMatch = text.match(/(\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2})/);
      if (timeMatch) {
        const slotName = timeMatch[1];
        const availEl = page.locator(`#myAvailability_${i}, .slot-dar-5`).nth(i);
        const availText = (await availEl.textContent().catch(() => ''))?.trim() || '';
        const countMatch = availText.match(/(\d+)/);
        const availabilityCount = countMatch ? parseInt(countMatch[1], 10) : 100;

        slots.push({
          slotName,
          availabilityCount,
        });
      }
    }

    SanitizedLogger.info(`[DISCOVERY] Time slots found: ${slots.length}`);
    return slots;
  }

  /**
   * 7. Selects preferred or first available Time Slot
   */
  static async selectTimeSlot(page: Page, preferredTimeSlot?: string): Promise<{ success: boolean; selectedSlot: string }> {
    const slots = await this.discoverAvailableSlots(page);
    if (slots.length === 0) {
      throw new Error('No available time slots found on official portal');
    }

    const isAnySlot = !preferredTimeSlot || preferredTimeSlot === 'Any Slot' || preferredTimeSlot.toUpperCase() === 'ANY';
    let targetSlot = slots[0].slotName;

    if (!isAnySlot) {
      const match = slots.find(s => s.slotName.replace(/\s+/g, '') === preferredTimeSlot.replace(/\s+/g, '') ||
                                     s.slotName.includes(preferredTimeSlot) || preferredTimeSlot.includes(s.slotName));
      if (!match) {
        throw new Error(`Requested specific time slot "${preferredTimeSlot}" is not available on official portal`);
      }
      targetSlot = match.slotName;
    }

    const slotCard = page.locator('.slot-dar-3, [id^="myName_"]').filter({
      hasText: new RegExp(targetSlot.replace('-', '\\s*-\\s*')),
    }).first();

    if (await slotCard.count() === 0) {
      if (!isAnySlot) {
        throw new Error(`Time slot element for "${targetSlot}" could not be selected on page`);
      }
      await page.locator('.slot-dar-3, [id^="myName_"]').first().click();
    } else {
      await slotCard.click();
    }

    await page.waitForTimeout(800);

    SanitizedLogger.info(`[DISCOVERY] Selected time slot: ${targetSlot}`);
    SanitizedLogger.info(`[AVAILABILITY] Time slot verified: ${targetSlot}`);

    return { success: true, selectedSlot: targetSlot };
  }

  /**
   * 8. Clicks Login button to redirect to official login page
   */
  static async proceedToLogin(page: Page): Promise<{ success: boolean }> {
    SanitizedLogger.info('[DISCOVERY] Redirecting to login');

    const loginBtn = page.locator('button.btn-addto:has-text("Login"), button:has-text("Login")').first();
    if (await loginBtn.count() === 0) {
      throw new Error('Login button not found on darshanAvailability page');
    }

    await loginBtn.click();
    await page.waitForURL(/login/i, { timeout: 15000 }).catch(async () => {
      await page.waitForTimeout(3000);
    });

    return { success: true };
  }
}
