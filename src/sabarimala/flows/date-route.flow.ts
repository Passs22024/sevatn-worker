import { Page } from 'playwright';
import { SABARIMALA_SELECTORS } from '../selectors';
import { SanitizedLogger } from '../../monitoring/logger';
import { normalizeDate } from '../virtual-q';
import { BookingExecutionContext, VirtualQWorkflowError } from './types';
import { FlowDiagnosticsManager } from './diagnostics';

const MONTH_NAMES = [
  'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
  'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER',
];

const MONTH_SHORT_NAMES = [
  'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
];

export interface OfficialRouteDefinition {
  canonicalName: string;
  officialValue: string; // "1", "2", "3"
  primaryKeyword: string;
  aliases: string[];
}

export const OFFICIAL_PORTAL_ROUTES: Record<string, OfficialRouteDefinition> = {
  PAMBA: {
    canonicalName: 'Pamba - Marakkoottam - 4 Kms',
    officialValue: '1',
    primaryKeyword: 'pamba',
    aliases: [
      'pamba',
      'pamba - marakkoottam - 4 kms',
      'pamba marakkoottam 4 kms',
      'pamba (regular footpath route)',
      'pamba regular footpath route',
      'regular footpath route',
      'marakkoottam',
      'marakkootam',
    ],
  },
  ERUMELY: {
    canonicalName: 'Erumely - Kalaketti Traditional Path - 46 Kms',
    officialValue: '2',
    primaryKeyword: 'erumely',
    aliases: [
      'erumely',
      'erumeli',
      'erumely - kalaketti traditional path - 46 kms',
      'kalaketti',
      'traditional path',
      'traditional route',
      'erumely traditional path',
    ],
  },
  VANDIPERIYAR: {
    canonicalName: 'Vandiperiyar - Sathram - Pulmedu - 16 Kms',
    officialValue: '3',
    primaryKeyword: 'vandiperiyar',
    aliases: [
      'vandiperiyar',
      'vandi periyar',
      'sathram',
      'pulmedu',
      'vandiperiyar - sathram - pulmedu - 16 kms',
      'sathram pulmedu',
    ],
  },
};

export function resolveCanonicalRoute(inputRoute: string): OfficialRouteDefinition | null {
  if (!inputRoute || typeof inputRoute !== 'string') return null;
  const cleanInput = inputRoute.trim().toLowerCase();
  const normInput = cleanInput.replace(/[^a-z0-9]/g, '');

  for (const key of Object.keys(OFFICIAL_PORTAL_ROUTES)) {
    const routeDef = OFFICIAL_PORTAL_ROUTES[key];
    const normCanonical = routeDef.canonicalName.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (normInput === normCanonical) return routeDef;

    for (const alias of routeDef.aliases) {
      const normAlias = alias.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (normInput === normAlias || normInput.includes(normAlias) || normAlias.includes(normInput)) {
        return routeDef;
      }
    }
  }

  // Check prefix keywords if still no match
  if (cleanInput.startsWith('pamba')) return OFFICIAL_PORTAL_ROUTES.PAMBA;
  if (cleanInput.startsWith('erume')) return OFFICIAL_PORTAL_ROUTES.ERUMELY;
  if (cleanInput.startsWith('vandi')) return OFFICIAL_PORTAL_ROUTES.VANDIPERIYAR;

  return null;
}

export class PostLoginDateRouteFlow {
  /**
   * PHASE 3 — Step 1: Select Date on Authenticated Virtual-Q Form (#/darshan)
   */
  static async selectAuthenticatedDate(page: Page, ctx: BookingExecutionContext): Promise<boolean> {
    const canonicalDate = normalizeDate(ctx.requestedDate);
    SanitizedLogger.info(`[POST-LOGIN-DATE] Selecting approved date: ${canonicalDate} on official form (#/darshan)`);

    try {
      const [targetYearStr, targetMonthStr, targetDayStr] = canonicalDate.split('-');
      const targetYear = parseInt(targetYearStr, 10);
      const targetMonthIdx = parseInt(targetMonthStr, 10) - 1; // 0-based
      const targetDay = parseInt(targetDayStr, 10);

      // Locate the date field container
      const dateInput = page.locator(
        'input[name="darshanDate"], input[name*="Date" i], input[matinput], #mat-input-0, input[formcontrolname="darshanDate"], input[formcontrolname="date"], #darshanDate, input[placeholder*="Date" i]'
      ).first();

      const isInputPresent = await dateInput.isVisible({ timeout: 4000 }).catch(() => false);
      if (!isInputPresent) {
        const diag = await FlowDiagnosticsManager.captureDiagnostics(page, 'PHASE_3_DATE_ROUTE_SELECTION', ctx.bookingCode, {
          selectedDate: canonicalDate,
          selectedRoute: ctx.requestedRoute,
        });
        throw new VirtualQWorkflowError(
          'AUTHENTICATED_DATE_SELECTION_FAILED',
          'Date input field could not be located on authenticated booking form (#/darshan)',
          'PHASE_3_DATE_ROUTE_SELECTION',
          diag,
        );
      }

      // Step 1.1: Check if calendar datepicker dialog is already open, or open via toggle
      const calDialog = page.locator('.mat-calendar, mat-calendar').first();
      let calendarOpened = await calDialog.isVisible({ timeout: 1000 }).catch(() => false);

      if (!calendarOpened) {
        const calToggle = page.locator(
          'button[aria-label="Open calendar"], .mat-datepicker-toggle button, mat-datepicker-toggle button, .calendar-icon, mat-icon:has-text("calendar_today")'
        ).first();

        if (await calToggle.isVisible({ timeout: 1500 }).catch(() => false)) {
          await calToggle.click().catch(() => {});
          await page.waitForTimeout(600);
        }

        calendarOpened = await calDialog.isVisible({ timeout: 1500 }).catch(() => false);

        // Fallback click on the input itself if toggle didn't open dialog
        if (!calendarOpened) {
          await dateInput.click().catch(() => {});
          await page.waitForTimeout(600);
          calendarOpened = await calDialog.isVisible({ timeout: 1500 }).catch(() => false);
        }
      }

      if (calendarOpened) {
        // Step 1.2: Navigate Month and Year
        await this.navigateCalendarMonthYear(page, targetYear, targetMonthIdx);

        // Step 1.3: Click the day cell
        const dayCell = page.locator(
          `.mat-calendar-body-cell:not(.mat-calendar-body-disabled)`
        ).filter({
          hasText: new RegExp(`^\\s*${targetDay}\\s*$`),
        }).first();

        if (await dayCell.isVisible({ timeout: 2000 }).catch(() => false)) {
          await dayCell.click();
          await page.waitForTimeout(800);
        } else {
          // Check if day cell is explicitly disabled/full
          const disabledCell = page.locator(
            `.mat-calendar-body-disabled`
          ).filter({
            hasText: new RegExp(`^\\s*${targetDay}\\s*$`),
          }).first();

          if (await disabledCell.isVisible({ timeout: 1000 }).catch(() => false)) {
            const diag = await FlowDiagnosticsManager.captureDiagnostics(page, 'PHASE_3_DATE_ROUTE_SELECTION', ctx.bookingCode, {
              selectedDate: canonicalDate,
              selectedRoute: ctx.requestedRoute,
            });
            throw new VirtualQWorkflowError(
              'AUTHENTICATED_DATE_SELECTION_FAILED',
              `Requested date ${canonicalDate} is marked DISABLED or FULL in official portal calendar`,
              'PHASE_3_DATE_ROUTE_SELECTION',
              diag,
            );
          }
        }
      }

      // Step 1.4: Verify date was written to input; fallback to direct fill if calendar didn't populate
      let currentVal = (await dateInput.inputValue().catch(() => ''))?.trim() || '';
      let isVerified = this.matchesDate(currentVal, canonicalDate, ctx.requestedDateDisplay);

      if (!isVerified) {
        SanitizedLogger.info(`[POST-LOGIN-DATE] Calendar pick not registered. Attempting direct date fill: ${canonicalDate}`);
        await dateInput.fill(canonicalDate).catch(() => {});
        await dateInput.press('Enter').catch(() => {});

        // DOM event dispatch fallback
        await page.evaluate((d) => {
          const inp = document.querySelector(
            'input[formcontrolname="darshanDate"], input[formcontrolname="date"], #darshanDate, input[placeholder*="Date"]'
          ) as HTMLInputElement;
          if (inp) {
            inp.value = d;
            inp.dispatchEvent(new Event('input', { bubbles: true }));
            inp.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }, canonicalDate).catch(() => {});

        await page.waitForTimeout(800);
        currentVal = (await dateInput.inputValue().catch(() => ''))?.trim() || '';
        isVerified = this.matchesDate(currentVal, canonicalDate, ctx.requestedDateDisplay);
      }

      if (!isVerified) {
        const diag = await FlowDiagnosticsManager.captureDiagnostics(page, 'PHASE_3_DATE_ROUTE_SELECTION', ctx.bookingCode, {
          selectedDate: canonicalDate,
          selectedRoute: ctx.requestedRoute,
        });
        throw new VirtualQWorkflowError(
          'AUTHENTICATED_DATE_SELECTION_FAILED',
          `Selected date could not be verified on authenticated form. Field value: "${currentVal}", expected: "${canonicalDate}"`,
          'PHASE_3_DATE_ROUTE_SELECTION',
          diag,
        );
      }

      SanitizedLogger.info(`[POST-LOGIN-DATE] Date successfully selected and verified on #/darshan: ${currentVal}`);
      return true;
    } catch (err: any) {
      if (err instanceof VirtualQWorkflowError) throw err;
      const diag = await FlowDiagnosticsManager.captureDiagnostics(page, 'PHASE_3_DATE_ROUTE_SELECTION', ctx.bookingCode, {
        selectedDate: canonicalDate,
        selectedRoute: ctx.requestedRoute,
      });
      throw new VirtualQWorkflowError(
        'AUTHENTICATED_DATE_SELECTION_FAILED',
        err.message || 'Failed to select authenticated date on official form',
        'PHASE_3_DATE_ROUTE_SELECTION',
        diag,
      );
    }
  }

  /**
   * PHASE 3 — Step 2: Select Route on Authenticated Virtual-Q Form (#/darshan)
   */
  static async selectAuthenticatedRoute(page: Page, ctx: BookingExecutionContext): Promise<boolean> {
    SanitizedLogger.info(`[POST-LOGIN-ROUTE] Selecting approved route: "${ctx.requestedRoute}" on #/darshan`);

    // 1. Resolve canonical route definition
    const canonicalRoute = resolveCanonicalRoute(ctx.requestedRoute);
    if (!canonicalRoute) {
      const diag = await FlowDiagnosticsManager.captureDiagnostics(page, 'PHASE_3_DATE_ROUTE_SELECTION', ctx.bookingCode, {
        selectedDate: ctx.requestedDate,
        selectedRoute: ctx.requestedRoute,
      });
      throw new VirtualQWorkflowError(
        'ROUTE_SELECTION_MISMATCH',
        `Unsupported or unrecognized requested route "${ctx.requestedRoute}". Must match one of the 3 official Sabarimala routes.`,
        'PHASE_3_DATE_ROUTE_SELECTION',
        diag,
      );
    }

    SanitizedLogger.info(
      `[POST-LOGIN-ROUTE] Canonical route resolved: "${canonicalRoute.canonicalName}" (officialValue: "${canonicalRoute.officialValue}")`,
    );

    try {
      // Locate the route dropdown control
      const routeSelect = page.locator(
        'select[name="route"], select.form-control, select[formcontrolname="route"], select#route, select:has(option:has-text("Select Route"))'
      ).first();

      const isSelectVisible = await routeSelect.isVisible({ timeout: 5000 }).catch(() => false);

      if (!isSelectVisible) {
        // Check for Angular Material mat-select as alternative
        const matSelect = page.locator('mat-select[formcontrolname="route"], mat-select#route').first();
        if (await matSelect.isVisible({ timeout: 1500 }).catch(() => false)) {
          return await this.selectMatSelectRoute(page, matSelect, ctx, canonicalRoute);
        }

        const diag = await FlowDiagnosticsManager.captureDiagnostics(page, 'PHASE_3_DATE_ROUTE_SELECTION', ctx.bookingCode, {
          selectedDate: ctx.requestedDate,
          selectedRoute: ctx.requestedRoute,
        });
        throw new VirtualQWorkflowError(
          'AUTHENTICATED_ROUTE_SELECTION_FAILED',
          'Route dropdown control is missing on authenticated booking form (#/darshan)',
          'PHASE_3_DATE_ROUTE_SELECTION',
          diag,
        );
      }

      // Inspect available options
      const options = await routeSelect.locator('option').allTextContents().catch(() => []);
      SanitizedLogger.info(`[POST-LOGIN-ROUTE] Available route options: [${options.map(o => `"${o.trim()}"`).join(', ')}]`);

      // Match option against canonical route
      const normCanonical = canonicalRoute.canonicalName.toLowerCase().replace(/[^a-z0-9]/g, '');
      let matchIdx = -1;

      for (let i = 0; i < options.length; i++) {
        const optText = options[i].trim();
        if (optText.toLowerCase().includes('select route') || !optText) continue;

        const optNorm = optText.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (optNorm === normCanonical || optNorm.includes(normCanonical) || normCanonical.includes(optNorm)) {
          matchIdx = i;
          break;
        }

        const aliasMatch = canonicalRoute.aliases.some(alias => {
          const normAlias = alias.toLowerCase().replace(/[^a-z0-9]/g, '');
          return optNorm.includes(normAlias) || normAlias.includes(optNorm);
        });
        if (aliasMatch) {
          matchIdx = i;
          break;
        }
      }

      // If text didn't match directly, check option values
      if (matchIdx <= 0) {
        const optionValues = await routeSelect.locator('option').evaluateAll((opts: HTMLOptionElement[]) => opts.map(o => o.value)).catch(() => []);
        for (let i = 0; i < optionValues.length; i++) {
          if (optionValues[i] === canonicalRoute.officialValue) {
            matchIdx = i;
            break;
          }
        }
      }

      // Strict requirement: NEVER fall back to index 1 or any unmatched option!
      if (matchIdx <= 0) {
        const diag = await FlowDiagnosticsManager.captureDiagnostics(page, 'PHASE_3_DATE_ROUTE_SELECTION', ctx.bookingCode, {
          selectedDate: ctx.requestedDate,
          selectedRoute: ctx.requestedRoute,
          additionalInfo: {
            canonicalRoute: canonicalRoute.canonicalName,
            availableOptions: options,
          },
        });
        throw new VirtualQWorkflowError(
          'ROUTE_SELECTION_MISMATCH',
          `Requested route "${ctx.requestedRoute}" (canonical: "${canonicalRoute.canonicalName}") is not available in portal options: [${options.join(', ')}]`,
          'PHASE_3_DATE_ROUTE_SELECTION',
          diag,
        );
      }

      // Select the option
      await routeSelect.selectOption({ index: matchIdx });
      await page.waitForTimeout(1000);

      // Verify selected value directly from DOM
      const rawDomText = await Promise.resolve(
        routeSelect.evaluate((el: HTMLSelectElement) => {
          return el.options && el.selectedIndex >= 0 ? (el.options[el.selectedIndex]?.text?.trim() || '') : '';
        })
      ).catch(() => '');
      const domOptionText = typeof rawDomText === 'string' && rawDomText.length > 0 ? rawDomText : (options[matchIdx]?.trim() || '');

      const rawDomVal = await Promise.resolve(
        routeSelect.evaluate((el: HTMLSelectElement) => {
          return el.options && el.selectedIndex >= 0 ? (el.options[el.selectedIndex]?.value?.trim() || '') : '';
        })
      ).catch(() => '');
      const domOptionValue = typeof rawDomVal === 'string' ? rawDomVal : '';

      SanitizedLogger.info(`[POST-LOGIN-ROUTE] DOM selected option: text="${domOptionText}", value="${domOptionValue}"`);

      // Verify that DOM selected route matches canonical route and reject competing routes
      const normDomText = domOptionText.toLowerCase().replace(/[^a-z0-9]/g, '');
      const isValMatch = domOptionValue === canonicalRoute.officialValue;
      const isTextMatch = normDomText.includes(normCanonical) || normCanonical.includes(normDomText) ||
        canonicalRoute.aliases.some(alias => normDomText.includes(alias.toLowerCase().replace(/[^a-z0-9]/g, '')));

      const isCompetingRoute = Object.keys(OFFICIAL_PORTAL_ROUTES).some(key => {
        const otherDef = OFFICIAL_PORTAL_ROUTES[key];
        if (otherDef.canonicalName === canonicalRoute.canonicalName) return false;
        return normDomText.includes(otherDef.primaryKeyword);
      });

      if ((!isValMatch && !isTextMatch) || isCompetingRoute) {
        const diag = await FlowDiagnosticsManager.captureDiagnostics(page, 'PHASE_3_DATE_ROUTE_SELECTION', ctx.bookingCode, {
          selectedDate: ctx.requestedDate,
          selectedRoute: ctx.requestedRoute,
          additionalInfo: {
            requestedRoute: ctx.requestedRoute,
            canonicalRoute: canonicalRoute.canonicalName,
            domOptionText,
            domOptionValue,
          },
        });
        throw new VirtualQWorkflowError(
          'ROUTE_SELECTION_MISMATCH',
          `ROUTE_SELECTION_MISMATCH: Requested "${ctx.requestedRoute}" (${canonicalRoute.canonicalName}), but DOM selected "${domOptionText}" (value: "${domOptionValue}"). Stopping before pilgrim submission.`,
          'PHASE_3_DATE_ROUTE_SELECTION',
          diag,
        );
      }

      // Update context with canonical route
      ctx.requestedRoute = canonicalRoute.canonicalName;
      ctx.selectedRoute = canonicalRoute.canonicalName;

      return true;
    } catch (err: any) {
      if (err instanceof VirtualQWorkflowError) throw err;
      const diag = await FlowDiagnosticsManager.captureDiagnostics(page, 'PHASE_3_DATE_ROUTE_SELECTION', ctx.bookingCode, {
        selectedDate: ctx.requestedDate,
        selectedRoute: ctx.requestedRoute,
      });
      throw new VirtualQWorkflowError(
        'AUTHENTICATED_ROUTE_SELECTION_FAILED',
        err.message || 'Failed to select route on authenticated form',
        'PHASE_3_DATE_ROUTE_SELECTION',
        diag,
      );
    }
  }

  /**
   * Helper for Angular Material mat-select route dropdown
   */
  private static async selectMatSelectRoute(
    page: Page,
    matSelect: any,
    ctx: BookingExecutionContext,
    canonicalRoute: OfficialRouteDefinition,
  ): Promise<boolean> {
    await matSelect.click();
    await page.waitForTimeout(500);

    const option = page.locator(
      `mat-option:has-text("${canonicalRoute.canonicalName}"), mat-option:has-text("${canonicalRoute.primaryKeyword}")`
    ).first();

    if (await option.isVisible({ timeout: 1500 }).catch(() => false)) {
      await option.click();
      await page.waitForTimeout(800);

      const selectedMatText = (await matSelect.innerText().catch(() => '')).trim();
      const normMatText = selectedMatText.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!normMatText.includes(canonicalRoute.primaryKeyword)) {
        throw new VirtualQWorkflowError(
          'ROUTE_SELECTION_MISMATCH',
          `ROUTE_SELECTION_MISMATCH in mat-select: Expected "${canonicalRoute.canonicalName}", got "${selectedMatText}"`,
          'PHASE_3_DATE_ROUTE_SELECTION',
        );
      }
      ctx.requestedRoute = canonicalRoute.canonicalName;
      ctx.selectedRoute = canonicalRoute.canonicalName;
      return true;
    }

    throw new VirtualQWorkflowError(
      'ROUTE_SELECTION_MISMATCH',
      `Route "${canonicalRoute.canonicalName}" not found in mat-select options`,
      'PHASE_3_DATE_ROUTE_SELECTION',
    );
  }

  /**
   * Helper: Navigates calendar month and year to match target
   */
  private static async navigateCalendarMonthYear(page: Page, targetYear: number, targetMonthIdx: number): Promise<void> {
    for (let attempt = 0; attempt < 12; attempt++) {
      const periodBtn = page.locator('.mat-calendar-period-button').first();
      const periodText = (await periodBtn.textContent().catch(() => ''))?.trim().toUpperCase() || '';

      const yearMatch = periodText.match(/(\d{4})/);
      const currentYear = yearMatch ? parseInt(yearMatch[1], 10) : targetYear;

      let currentMonthIdx = -1;
      for (let m = 0; m < 12; m++) {
        if (periodText.includes(MONTH_NAMES[m]) || periodText.includes(MONTH_SHORT_NAMES[m])) {
          currentMonthIdx = m;
          break;
        }
      }

      if (currentMonthIdx === -1) break;

      const currentAbsoluteMonth = currentYear * 12 + currentMonthIdx;
      const targetAbsoluteMonth = targetYear * 12 + targetMonthIdx;

      if (currentAbsoluteMonth === targetAbsoluteMonth) {
        break;
      }

      if (currentAbsoluteMonth < targetAbsoluteMonth) {
        const nextBtn = page.locator('.mat-calendar-next-button').first();
        await nextBtn.click();
      } else {
        const prevBtn = page.locator('.mat-calendar-previous-button').first();
        await prevBtn.click();
      }

      await page.waitForTimeout(300);
    }
  }

  /**
   * Helper: Verifies canonical or display date representation
   */
  private static matchesDate(inputVal: string, canonicalDate: string, displayDate?: string): boolean {
    if (!inputVal) return false;
    const clean = inputVal.trim();
    if (clean === canonicalDate || clean.includes(canonicalDate)) return true;
    if (displayDate && (clean === displayDate || clean.includes(displayDate))) return true;

    // Check DD-MM-YYYY or DD/MM/YYYY
    const parts = canonicalDate.split('-');
    if (parts.length === 3) {
      const ddmmyyyy = `${parts[2]}-${parts[1]}-${parts[0]}`;
      const ddmmyyyySlash = `${parts[2]}/${parts[1]}/${parts[0]}`;
      if (clean.includes(ddmmyyyy) || clean.includes(ddmmyyyySlash)) return true;
    }
    return false;
  }
}

