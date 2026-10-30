import { ApiClient } from '../api/client';
import { HeartbeatService } from '../heartbeat/heartbeat';
import { VerificationWorker } from '../jobs/verification-worker';
import { BookingWorker } from '../jobs/booking-worker';
import { AvailabilityDiscoveryWorker } from '../availability/discovery-worker';
import { SanitizedLogger } from '../monitoring/logger';
import { BookingExecutionGuard } from '../security/execution-guard';

export class WorkerOrchestrator {
  private isRunning = false;
  private verificationWorker: VerificationWorker;
  private bookingWorker: BookingWorker;
  private discoveryWorker: AvailabilityDiscoveryWorker;

  private maxActiveBookings: number;
  private maxAvailabilityMonitors: number;
  private activeExecutions = 0;
  private activeJobIds = new Set<string>();

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
    SanitizedLogger.info('🚀 TICKETASSIST THREE-ENGINE WORKER ORCHESTRATOR STARTED');
    SanitizedLogger.info(`• Engine 1: Availability Discovery Engine (Public Pre-Login)`);
    SanitizedLogger.info(`• Engine 2: Booking Execution Engine (Concurrency Limit: ${this.maxActiveBookings})`);
    SanitizedLogger.info(`• Engine 3: Account Verification Engine (Independent Sandbox)`);
    SanitizedLogger.info('=======================================================');

    // 1. Start Independent Availability Discovery Engine
    this.startDiscoveryLoop();

    // 2. Start Booking Execution Engine Polling Loop
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
      const isDiscoveryPermitted = typeof this.heartbeat.isDiscoveryPermitted === 'function'
        ? this.heartbeat.isDiscoveryPermitted()
        : this.heartbeat.isExecutionPermitted();

      if (isDiscoveryPermitted) {
        try {
          const workerId = process.env.MACHINE_CODE || 'worker-node';
          await this.discoveryWorker.runDiscoveryPass(workerId);
        } catch (err: any) {
          SanitizedLogger.error('[AVAILABILITY] Discovery cycle error:', err?.message || err);
        }
      }

      await new Promise((resolve) => setTimeout(resolve, this.discoveryIntervalMs));
    }
  }

  /**
   * Independent execution loop for claimed matching bookings
   */
  private async startExecutionLoop() {
    SanitizedLogger.info('[BOOKING] Booking Execution Engine active. Polling for queued execution jobs...');

    let lastStoppedNotice = 0;
    let lastPassiveNotice = 0;
    let lastPollNotice = 0;
    let wasPaused = false;

    while (this.isRunning) {
      if (!this.heartbeat.isExecutionPermitted()) {
        wasPaused = true;
        const now = Date.now();
        if (now - lastStoppedNotice > 30000) {
          SanitizedLogger.info(`[Worker] Execution is ${this.heartbeat.getDesiredState()} by Super Admin. Job polling paused.`);
          lastStoppedNotice = now;
        }
        if (this.activeExecutions === 0) {
          this.heartbeat.setStatus('IDLE');
        }
        await new Promise((resolve) => setTimeout(resolve, this.checkIntervalMs));
        continue;
      }

      if (this.maxActiveBookings <= 0) {
        const now = Date.now();
        if (now - lastPassiveNotice > 60000) {
          SanitizedLogger.info(
            `[BOOKING] Execution Engine in MONITOR-ONLY mode (MAX_ACTIVE_BOOKINGS=${this.maxActiveBookings}). Job claiming disabled. Set MAX_ACTIVE_BOOKINGS >= 1 to enable booking execution.`
          );
          lastPassiveNotice = now;
        }
        if (this.activeExecutions === 0) {
          this.heartbeat.setStatus('IDLE');
        }
        await new Promise((resolve) => setTimeout(resolve, this.checkIntervalMs));
        continue;
      }

      if (wasPaused) {
        wasPaused = false;
        SanitizedLogger.info('[Worker] Execution RESUMED by Super Admin. Resuming job claims & execution polling.');
        lastStoppedNotice = 0;
      }

      if (this.activeExecutions < this.maxActiveBookings) {
        try {
          const claimResult = await this.apiClient.claimJob();

          if (claimResult.stopped) {
            this.heartbeat.setExecutionPermitted(false);
            SanitizedLogger.warn(`[Worker] Execution stopped by Super Admin. Halting new job claims.`);
            if (this.activeExecutions === 0) {
              this.heartbeat.setStatus('IDLE');
            }
          } else if (claimResult.hasJob && claimResult.job) {
            const job = claimResult.job;
            const bookingKey = job.bookingRequestId || job.bookingCode || job.id;

            if (claimResult.jobType !== 'ACCOUNT_VERIFICATION' && (BookingExecutionGuard.isBookingActive(bookingKey) || this.activeJobIds.has(job.id))) {
              SanitizedLogger.warn(
                `[Worker] Deduplication: Claimed job #${job.id} for booking #${job.bookingCode || bookingKey} is already active in this worker process. Skipping duplicate dispatch.`
              );
              await new Promise((resolve) => setTimeout(resolve, this.checkIntervalMs));
              continue;
            }

            this.activeExecutions++;
            this.activeJobIds.add(job.id);
            this.processJobAsync(claimResult.jobType, job);
          } else {
            if (this.activeExecutions === 0) {
              this.heartbeat.setStatus('IDLE');
            }
            const now = Date.now();
            if (now - lastPollNotice > 60000) {
              SanitizedLogger.info(
                `[BOOKING] Queue poll: No queued jobs available (Capacity: ${this.activeExecutions}/${this.maxActiveBookings}). Polling every ${this.checkIntervalMs / 1000}s.`
              );
              lastPollNotice = now;
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
    this.activeJobIds.add(job.id);

    const isBooking = jobType !== 'ACCOUNT_VERIFICATION';
    let lockAcquired = false;

    if (isBooking) {
      const lockRes = BookingExecutionGuard.acquire({
        bookingId: job.bookingRequestId || job.id,
        bookingCode: job.bookingCode || job.id,
        jobId: job.id,
        dispatchSource: job.dispatchSource || 'QUEUE_POLL',
        owner: 'WORKER_ORCHESTRATOR',
      });

      if (!lockRes.acquired) {
        SanitizedLogger.warn(
          `[Worker] Deduplication guard: Aborting duplicate dispatch for Booking #${job.bookingCode || job.id}. Lock owned by Job #${lockRes.existingLock?.jobId}.`
        );
        this.activeExecutions = Math.max(0, this.activeExecutions - 1);
        this.activeJobIds.delete(job.id);
        this.heartbeat.removeActiveJob(job.id);
        return;
      }
      lockAcquired = true;
      job.attemptId = lockRes.attemptId;
    }

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
      if (isBooking && lockAcquired) {
        BookingExecutionGuard.release(job.bookingRequestId || job.bookingCode || job.id, job.id);
      }
      this.activeJobIds.delete(job.id);
      this.activeExecutions = Math.max(0, this.activeExecutions - 1);
      this.heartbeat.removeActiveJob(job.id);
    }
  }
}
