import { ApiClient } from '../api/client';
import { PlaywrightSabarimalaAdapter } from '../sabarimala/sabarimala-adapter';
import { SanitizedLogger } from '../monitoring/logger';
import { normalizeDate } from '../sabarimala/virtual-q';
import { normalizeDemandKey } from './demand-key';

export class AvailabilityDiscoveryWorker {
  private isChecking = false;

  constructor(private apiClient: ApiClient) {}

  /**
   * Executes an intelligent, distributed-throttled discovery pass across active demand dates.
   * Entry Point: https://sabarimalaonline.org/#/darshanAvailability (Public pre-login page)
   * 
   * Features:
   * - Demand-based: only inspects dates with active pending customer demand.
   * - Distributed deduplication: acquires an atomic lock per demand key.
   * - Interval throttling: skips browser launches when demands are within backoff/refresh windows.
   * - Browser lifecycle optimization: zero browser launches when no demands are due.
   * - Structured logging: [DISCOVERY] tags with demandKey, lastCheckedAt, nextCheckAt.
   */
  async runDiscoveryPass(workerId: string = 'worker-node'): Promise<void> {
    if (this.isChecking) {
      return;
    }

    this.isChecking = true;

    try {
      // 1. Fetch active demand dates with schedule state from API
      const demandGroups = await this.apiClient.getDemandDates();
      if (!demandGroups || demandGroups.length === 0) {
        SanitizedLogger.info('[DISCOVERY] No pending bookings. Monitor idle.');
        return;
      }

      // 2. Identify due demands
      const dueDemands = demandGroups.filter((g: any) => g.isDue !== false);

      if (dueDemands.length === 0) {
        // All active demands are within their scheduled intervals. Skip browser launch completely.
        const nextUpcoming = demandGroups
          .filter((g: any) => g.nextCheckAt)
          .sort((a: any, b: any) => (a.nextCheckAt > b.nextCheckAt ? 1 : -1))[0];

        SanitizedLogger.info(
          `[DISCOVERY] No demand dates due for inspection (all within scheduled intervals). Browser launch skipped. Next due: ${nextUpcoming?.demandKey || 'none'} at ${nextUpcoming?.nextCheckAt || 'N/A'}`
        );
        return;
      }

      // 3. Atomically claim due demands to prevent concurrent multi-worker scanning
      const claimedDemands: any[] = [];
      for (const demand of dueDemands) {
        const demandKey = demand.demandKey || normalizeDemandKey(demand.date, demand.route);
        let claimed = true;

        if (typeof this.apiClient.claimDemand === 'function') {
          try {
            const claimRes = await this.apiClient.claimDemand(demandKey, workerId);
            claimed = claimRes?.claimed ?? true;
          } catch (claimErr: any) {
            SanitizedLogger.warn(`[DISCOVERY] demandKey=${demandKey} claim error: ${claimErr.message}. Proceeding locally.`);
            claimed = true;
          }
        }

        if (claimed) {
          claimedDemands.push({ ...demand, demandKey });
        } else {
          SanitizedLogger.info(
            `[DISCOVERY] demandKey=${demandKey} lastCheckedAt=${demand.lastCheckedAt || 'NEVER'} nextCheckAt=${demand.nextCheckAt || 'N/A'} deduplication=SKIPPED`
          );
        }
      }

      if (claimedDemands.length === 0) {
        SanitizedLogger.info('[DISCOVERY] All due demands claimed or in-flight by another worker. Browser launch skipped.');
        return;
      }

      // 4. Open official Darshan Availability page only now that at least one demand is claimed
      const adapter = new PlaywrightSabarimalaAdapter();
      const passStartTime = Date.now();

      try {
        await adapter.init();
        const openResult = await adapter.openDarshanAvailability();
        if (!openResult.success) {
          SanitizedLogger.warn('[DISCOVERY] Official portal darshanAvailability unreachable during discovery pass');
          for (const d of claimedDemands) {
            if (typeof this.apiClient.releaseDemand === 'function') {
              await this.apiClient.releaseDemand(d.demandKey, workerId, 'ERROR', Date.now() - passStartTime, 'Page unreachable');
            }
          }
          return;
        }

        const discoveredOpportunities: Array<{ date: string; route: string; timeSlot?: string; source: string }> = [];

        // 5. Inspect each claimed target demand date on official calendar
        for (const demand of claimedDemands) {
          const canonicalDate = normalizeDate(demand.date);
          const targetRoute = demand.route || 'Pamba (Regular Footpath Route)';
          const demandKey = demand.demandKey;
          const scanStartTime = Date.now();

          const checkResult = await adapter.checkRequestedDateAvailability(canonicalDate);

          if (checkResult.available) {
            try {
              // Select date
              await adapter.selectRequestedDate(canonicalDate);

              // Select route
              const routeResult = await adapter.selectRoute(targetRoute);
              const verifiedRoute = routeResult.selectedRoute || targetRoute;

              SanitizedLogger.info(`[DISCOVERY] 🟢 Date and route verified available: ${canonicalDate} / ${verifiedRoute}`);
              discoveredOpportunities.push({
                date: canonicalDate,
                route: verifiedRoute,
                source: 'SABARIMALA_DARSHAN_AVAILABILITY',
              });

              if (typeof this.apiClient.releaseDemand === 'function') {
                await this.apiClient.releaseDemand(demandKey, workerId, 'AVAILABLE', Date.now() - scanStartTime);
              }
            } catch (selErr: any) {
              SanitizedLogger.warn(`[DISCOVERY] Error selecting open date ${canonicalDate}:`, selErr.message);
              if (typeof this.apiClient.releaseDemand === 'function') {
                await this.apiClient.releaseDemand(demandKey, workerId, 'ERROR', Date.now() - scanStartTime, selErr.message);
              }
            }
          } else {
            SanitizedLogger.info(`[DISCOVERY] demandKey=${demandKey} result=UNAVAILABLE state=${checkResult.state}`);
            if (typeof this.apiClient.releaseDemand === 'function') {
              await this.apiClient.releaseDemand(demandKey, workerId, 'UNAVAILABLE', Date.now() - scanStartTime);
            }
          }
        }

        // 6. Publish bulk discovered availability events to API Smart Matcher
        if (discoveredOpportunities.length > 0) {
          SanitizedLogger.info(`[DISCOVERY] Discovered ${discoveredOpportunities.length} available date/route opportunity(ies)!`);
          for (const opp of discoveredOpportunities) {
            SanitizedLogger.info(`[DISCOVERY] Available: ${opp.date} / ${opp.route}`);
          }
          await this.apiClient.publishBulkAvailability(discoveredOpportunities);
        } else {
          SanitizedLogger.info('[DISCOVERY] No new availability events discovered for inspected demand dates.');
        }
      } catch (innerErr: any) {
        SanitizedLogger.error('[DISCOVERY] Error during portal discovery execution:', innerErr);
        for (const d of claimedDemands) {
          if (typeof this.apiClient.releaseDemand === 'function') {
            await this.apiClient.releaseDemand(d.demandKey, workerId, 'ERROR', Date.now() - passStartTime, innerErr.message);
          }
        }
      } finally {
        await adapter.close().catch(() => {});
      }
    } catch (err: any) {
      SanitizedLogger.error('[DISCOVERY] Error in discovery pass:', err);
    } finally {
      this.isChecking = false;
    }
  }
}
