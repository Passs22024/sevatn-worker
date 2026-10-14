import { ApiClient } from '../api/client';
import { HeartbeatService } from '../heartbeat/heartbeat';
import { VerificationWorker } from '../jobs/verification-worker';
import { BookingWorker } from '../jobs/booking-worker';
import { AvailabilityDiscoveryWorker } from '../availability/discovery-worker';
import { SanitizedLogger } from '../monitoring/logger';

export class WorkerOrchestrator {
  private isRunning = false;
  private verificationWorker: VerificationWorker;
  private bookingWorker: BookingWorker;
  private discoveryWorker: AvailabilityDiscoveryWorker;

  private maxActiveBookings: number;
  private maxAvailabilityMonitors: number;
  private activeExecutions = 0;

  constructor(
    private apiClient: ApiClient,
    private heartbeat: HeartbeatService,
    private checkIntervalMs: number = 5000,
    private discoveryIntervalMs: number = 15000,
  ) {
    this.verificationWorker = new VerificationWorker(apiClient);
    this.bookingWorker = new BookingWorker(apiClient);
    this.discoveryWorker = new AvailabilityDiscoveryWorker(apiClient);

    this.maxActiveBookings = parseInt(process.env.MAX_ACTIVE_BOOKINGS || '3', 10);
    this.maxAvailabilityMonitors = parseInt(process.env.MAX_AVAILABILITY_MONITORS || '2', 10);
  }

  async start() {
    this.isRunning = true;
    SanitizedLogger.info('=======================================================');
    SanitizedLogger.info('🚀 TICKETASSIST DUAL-ENGINE WORKER ORCHESTRATOR STARTED');
    SanitizedLogger.info(`• Execution Concurrency Limit: ${this.maxActiveBookings}`);
    SanitizedLogger.info(`• Discovery Concurrency Limit: ${this.maxAvailabilityMonitors}`);
    SanitizedLogger.info('=======================================================');

    // 1. Start Independent Availability Discovery Loop
    this.startDiscoveryLoop();

    // 2. Start Booking Execution Queue Polling Loop
    this.startExecutionLoop();
  }

  stop() {
    this.isRunning = false;
    SanitizedLogger.info('[Worker] Stopping orchestrator loops...');
  }

  /**
   * Independent loop that continuously discovers available dates & slots across official portal
   * and publishes them to the Smart Matcher without locking booking workers.
   */
  private async startDiscoveryLoop() {
    SanitizedLogger.info('[AVAILABILITY] Availability Discovery Engine initialized.');

    while (this.isRunning) {
      try {
        await this.discoveryWorker.runDiscoveryPass();
      } catch (err: any) {
        SanitizedLogger.error('[AVAILABILITY] Discovery cycle error:', err?.message || err);
      }

      await new Promise((resolve) => setTimeout(resolve, this.discoveryIntervalMs));
    }
  }

  /**
   * Independent execution loop for claimed matching bookings
   */
  private async startExecutionLoop() {
    SanitizedLogger.info('[BOOKING] Booking Execution Engine active. Polling for queued execution jobs...');

    while (this.isRunning) {
      if (this.activeExecutions < this.maxActiveBookings) {
        try {
          const claimResult = await this.apiClient.claimJob();

          if (claimResult.hasJob && claimResult.job) {
            this.activeExecutions++;
            this.processJobAsync(claimResult.jobType, claimResult.job);
          } else {
            if (this.activeExecutions === 0) {
              this.heartbeat.setStatus('IDLE');
            }
          }
        } catch (err: any) {
          SanitizedLogger.error('[Worker] Claim poll error:', err?.response?.data || err.message);
          if (this.activeExecutions === 0) {
            this.heartbeat.setStatus('IDLE');
          }
        }
      }

      await new Promise((resolve) => setTimeout(resolve, this.checkIntervalMs));
    }
  }

  private async processJobAsync(jobType: string, job: any) {
    this.heartbeat.addActiveJob(job.id);

    // Active lease renewal heartbeat timer (every 45s)
    const leaseTimer = setInterval(async () => {
      try {
        await this.apiClient.updateJobProgress(job.id, {
          status: 'EXECUTING',
          note: 'Worker active lease heartbeat',
        });
      } catch (err) {
        SanitizedLogger.warn(`[Lease] Heartbeat notice for Job ID: ${job.id}`);
      }
    }, 45000);

    try {
      if (jobType === 'ACCOUNT_VERIFICATION') {
        SanitizedLogger.info(`[Worker] Executing Official Account Verification: ${job.username}`);
        await this.verificationWorker.execute(job);
      } else {
        SanitizedLogger.info(`[Worker] Executing Booking Workflow: #${job.bookingCode || job.id}`);
        await this.bookingWorker.execute(job);
      }
    } catch (err: any) {
      SanitizedLogger.error(`[Worker] Job execution unhandled exception:`, err);
    } finally {
      clearInterval(leaseTimer);
      this.activeExecutions = Math.max(0, this.activeExecutions - 1);
      this.heartbeat.removeActiveJob(job.id);
    }
  }
}
