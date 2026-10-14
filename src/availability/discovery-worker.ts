import { ApiClient } from '../api/client';
import { PlaywrightSabarimalaAdapter } from '../sabarimala/sabarimala-adapter';
import { SanitizedLogger } from '../monitoring/logger';
import { normalizeDate } from '../sabarimala/virtual-q';

export class AvailabilityDiscoveryWorker {
  private isChecking = false;

  constructor(private apiClient: ApiClient) {}

  /**
   * Executes a single non-blocking discovery pass across all active demand dates.
   * Entry Point: https://sabarimalaonline.org/#/darshanAvailability (Public pre-login page)
   * Discovers available dates and real time slots, publishes internal availability events,
   * and immediately releases the browser context.
   */
  async runDiscoveryPass(): Promise<void> {
    if (this.isChecking) {
      return;
    }

    this.isChecking = true;
    const adapter = new PlaywrightSabarimalaAdapter();

    try {
      // 1. Query active demand groups from API (Date Demand Index)
      const demandGroups = await this.apiClient.getDemandDates();
      if (!demandGroups || demandGroups.length === 0) {
        SanitizedLogger.info('[PENDING-MONITOR] No pending bookings. Monitor idle.');
        return;
      }

      const demandDates = Array.from(new Set(demandGroups.map((g: any) => normalizeDate(g.date))));
      SanitizedLogger.info(`[PENDING-MONITOR] Active demand dates to inspect: ${demandDates.join(', ')}`);

      // 2. Open official Darshan Availability page in isolated browser context
      await adapter.init();
      const openResult = await adapter.openDarshanAvailability();
      if (!openResult.success) {
        SanitizedLogger.warn('[PENDING-MONITOR] Official portal darshanAvailability unreachable during discovery pass');
        return;
      }

      const discoveredOpportunities: Array<{ date: string; route: string; timeSlot: string; source: string }> = [];

      // 3. Inspect each target demand date on the official calendar
      for (const demandGroup of demandGroups) {
        const canonicalDate = normalizeDate(demandGroup.date);
        const targetRoute = demandGroup.route || 'Pamba (Regular Footpath Route)';

        const checkResult = await adapter.checkRequestedDateAvailability(canonicalDate);

        if (checkResult.available) {
          try {
            // Select the date
            await adapter.selectRequestedDate(canonicalDate);

            // Select the route
            const routeResult = await adapter.selectRoute(targetRoute);

            // Discover all real available time slots
            const slots = await adapter.discoverAvailableSlots();

            if (slots.length > 0) {
              SanitizedLogger.info(`[PENDING-MONITOR] 🟢 Date became available: ${canonicalDate}`);
              for (const slot of slots) {
                discoveredOpportunities.push({
                  date: canonicalDate,
                  route: routeResult.selectedRoute || targetRoute,
                  timeSlot: slot.slotName,
                  source: 'SABARIMALA_DARSHAN_AVAILABILITY',
                });
              }
            } else {
              SanitizedLogger.warn(`[PENDING-MONITOR] Date ${canonicalDate} open but no selectable time slots rendered`);
            }
          } catch (selErr: any) {
            SanitizedLogger.warn(`[PENDING-MONITOR] Error selecting open date ${canonicalDate}:`, selErr.message);
          }
        } else {
          SanitizedLogger.info(`[PENDING-MONITOR] Date ${canonicalDate} state: ${checkResult.state}`);
        }
      }

      if (discoveredOpportunities.length > 0) {
        SanitizedLogger.info(`[PENDING-MONITOR] Discovered ${discoveredOpportunities.length} available opportunity slot(s)!`);
        for (const opp of discoveredOpportunities) {
          SanitizedLogger.info(`[PENDING-MONITOR] ${opp.date} / ${opp.route} / ${opp.timeSlot} available`);
        }

        // 4. Publish availability events to API Smart Scheduler
        await this.apiClient.publishBulkAvailability(discoveredOpportunities);
      } else {
        SanitizedLogger.info('[PENDING-MONITOR] No new availability events discovered for current active demand dates.');
      }
    } catch (err: any) {
      SanitizedLogger.error('[PENDING-MONITOR] Error during discovery pass:', err);
    } finally {
      // 5. Always release browser context immediately
      await adapter.close().catch(() => {});
      this.isChecking = false;
    }
  }
}

