import { ApiClient } from '../api/client';
import { PlaywrightSabarimalaAdapter } from '../sabarimala/sabarimala-adapter';
import { SanitizedLogger } from '../monitoring/logger';
import { normalizeDate } from '../sabarimala/virtual-q';
import { normalizeDemandKey } from './demand-key';

export class AvailabilityDiscoveryWorker {
  private isChecking = false;

  // Task 1: In-memory cache for confirmed available dates
  public availableDatesSet: Set<string> = new Set<string>();

  // Task 4: In-memory cache for backoff on failed/FULL dates (Map<date, nextCheckTime>)
  public failedDateBackoffMap: Map<string, number> = new Map<string, number>();

  constructor(
    private apiClient: ApiClient,
    private onBookingSniped?: (jobType: string, job: any) => void,
  ) {}

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
      let demandGroups: any[] = [];
      try {
        demandGroups = await this.apiClient.getDemandDates();
      } catch (err: any) {
        SanitizedLogger.warn(`[DISCOVERY] Failed to fetch demand dates: ${err.message}`);
      }

      // Supplementary fallback: check getPendingDates if demandGroups is empty
      if (!demandGroups || demandGroups.length === 0) {
        try {
          if (typeof this.apiClient.getPendingDates === 'function') {
            const pending = await this.apiClient.getPendingDates();
            if (pending?.dates && pending.dates.length > 0) {
              demandGroups = pending.dates.map((d: string) => ({
                date: d,
                route: 'Pamba (Regular Footpath Route)',
                pendingCount: 1,
              }));
            }
          }
        } catch (_) {}
      }

      if (!demandGroups || demandGroups.length === 0) {
        SanitizedLogger.info('[DISCOVERY] No pending bookings. Monitor idle.');
        return;
      }

      // 2. Identify due demands (Task 4: Enforce 5-minute backoff on failed/FULL dates)
      const now = Date.now();
      const dueDemands = demandGroups.filter((g: any) => {
        const canonical = normalizeDate(g.date);
        const nextCheckTime = this.failedDateBackoffMap.get(canonical);
        if (nextCheckTime && now < nextCheckTime) {
          const remainingSec = Math.round((nextCheckTime - now) / 1000);
          SanitizedLogger.info(
            `[DISCOVERY] Date ${canonical} in 5-min backoff (${remainingSec}s remaining). Skipping.`
          );
          return false;
        }
        return g.isDue !== false;
      });

      if (dueDemands.length === 0) {
        // All active demands are within their scheduled intervals or 5-min backoff. Skip browser launch completely.
        const nextUpcoming = demandGroups
          .filter((g: any) => g.nextCheckAt)
          .sort((a: any, b: any) => (a.nextCheckAt > b.nextCheckAt ? 1 : -1))[0];

        SanitizedLogger.info(
          `[DISCOVERY] No demand dates due for inspection (all in backoff or within scheduled intervals). Browser launch skipped. Next due: ${nextUpcoming?.demandKey || 'none'} at ${nextUpcoming?.nextCheckAt || 'N/A'}`
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
            // Task 1: Store available date in local in-memory cache & clear backoff
            this.availableDatesSet.add(canonicalDate);
            this.failedDateBackoffMap.delete(canonicalDate);

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

              // Task 2: Cancellation Sniping - Instantly grab oldest pending booking for this date
              if (typeof this.apiClient.matchPending === 'function') {
                try {
                  SanitizedLogger.info(`[SNIPER] 🎯 Date ${canonicalDate} is AVAILABLE! Triggering cancellation sniping via match-pending...`);
                  const matchRes = await this.apiClient.matchPending(canonicalDate, verifiedRoute);
                  if (matchRes && matchRes.hasJob && matchRes.job) {
                    SanitizedLogger.info(`[SNIPER] 🚀 Successfully claimed sniped booking #${matchRes.job.bookingCode || matchRes.job.id} for ${canonicalDate}! Dispatching execution.`);
                    if (this.onBookingSniped) {
                      this.onBookingSniped(matchRes.jobType || 'BOOKING_EXECUTION', matchRes.job);
                    }
                  } else {
                    SanitizedLogger.info(`[SNIPER] No claimable pending booking for ${canonicalDate} (claimed by peer worker or none remaining).`);
                  }
                } catch (snipeErr: any) {
                  SanitizedLogger.warn(`[SNIPER] match-pending claim error for ${canonicalDate}: ${snipeErr.message}`);
                }
              }

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
            // Task 4: Date is FULL / UNAVAILABLE. Apply 5-minute backoff cache
            this.availableDatesSet.delete(canonicalDate);
            this.failedDateBackoffMap.set(canonicalDate, Date.now() + 5 * 60 * 1000);

            SanitizedLogger.info(
              `[DISCOVERY] 🔴 Date ${canonicalDate} is FULL/UNAVAILABLE (${checkResult.state}). 5-minute backoff applied.`
            );
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
