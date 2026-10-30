import { randomUUID } from 'crypto';
import { SanitizedLogger } from '../monitoring/logger';

export interface ExecutionLockInfo {
  bookingId: string;
  bookingCode: string;
  jobId: string;
  attemptId: string;
  dispatchSource: string;
  lifecycleState: string;
  owner: string;
  startedAt: number;
}

export class BookingExecutionGuard {
  private static locksByBookingId = new Map<string, ExecutionLockInfo>();
  private static locksByBookingCode = new Map<string, ExecutionLockInfo>();
  private static locksByJobId = new Map<string, ExecutionLockInfo>();

  /**
   * Atomically acquires an execution lock for a booking.
   * If any execution is already active for this booking ID, booking code, or job ID,
   * the duplicate dispatch is strictly rejected.
   */
  public static acquire(params: {
    bookingId: string;
    bookingCode: string;
    jobId: string;
    dispatchSource: string;
    owner?: string;
  }): { acquired: boolean; attemptId?: string; existingLock?: ExecutionLockInfo } {
    const { bookingId, bookingCode, jobId, dispatchSource, owner = 'LOCAL_WORKER' } = params;

    // Check existing lock across all identifiers
    const existing =
      this.locksByBookingId.get(bookingId) ||
      this.locksByBookingCode.get(bookingCode) ||
      this.locksByJobId.get(jobId);

    if (existing) {
      const elapsedSec = Math.floor((Date.now() - existing.startedAt) / 1000);
      SanitizedLogger.warn(
        `[EXECUTION-GUARD] ⚠️ Rejected duplicate dispatch for Booking #${bookingCode}: ` +
          `[bookingId=${bookingId}, jobId=${jobId}, incomingSource=${dispatchSource}] ` +
          `Already actively executing under [attemptId=${existing.attemptId}, activeJobId=${existing.jobId}, ` +
          `source=${existing.dispatchSource}, state=${existing.lifecycleState}, owner=${existing.owner}, duration=${elapsedSec}s]`,
      );
      return { acquired: false, existingLock: existing };
    }

    const attemptId = `ATT-${randomUUID().slice(0, 8)}`;
    const lock: ExecutionLockInfo = {
      bookingId,
      bookingCode,
      jobId,
      attemptId,
      dispatchSource,
      lifecycleState: 'CLAIMED',
      owner,
      startedAt: Date.now(),
    };

    if (bookingId) this.locksByBookingId.set(bookingId, lock);
    if (bookingCode) this.locksByBookingCode.set(bookingCode, lock);
    if (jobId) this.locksByJobId.set(jobId, lock);

    SanitizedLogger.info(
      `[EXECUTION-GUARD] 🔒 Execution lock ACQUIRED: bookingId=${bookingId}, bookingCode=${bookingCode}, ` +
        `jobId=${jobId}, attemptId=${attemptId}, source=${dispatchSource}, state=CLAIMED, owner=${owner}`,
    );

    return { acquired: true, attemptId };
  }

  /**
   * Updates the current lifecycle state of an active execution
   */
  public static updateLifecycleState(bookingIdOrCode: string, newState: string): void {
    const lock =
      this.locksByBookingId.get(bookingIdOrCode) ||
      this.locksByBookingCode.get(bookingIdOrCode) ||
      this.locksByJobId.get(bookingIdOrCode);

    if (lock) {
      const oldState = lock.lifecycleState;
      lock.lifecycleState = newState;
      SanitizedLogger.info(
        `[EXECUTION-GUARD] 🔄 Lifecycle transition [Booking #${lock.bookingCode} | Attempt ${lock.attemptId}]: ` +
          `${oldState} -> ${newState}`,
      );
    }
  }

  /**
   * Releases the execution lock cleanly
   */
  public static release(bookingIdOrCode: string, jobId?: string): boolean {
    const lock =
      this.locksByBookingId.get(bookingIdOrCode) ||
      this.locksByBookingCode.get(bookingIdOrCode) ||
      (jobId ? this.locksByJobId.get(jobId) : undefined);

    if (!lock) {
      return false;
    }

    if (lock.bookingId) this.locksByBookingId.delete(lock.bookingId);
    if (lock.bookingCode) this.locksByBookingCode.delete(lock.bookingCode);
    if (lock.jobId) this.locksByJobId.delete(lock.jobId);

    const elapsedSec = Math.floor((Date.now() - lock.startedAt) / 1000);
    SanitizedLogger.info(
      `[EXECUTION-GUARD] 🔓 Execution lock RELEASED: bookingId=${lock.bookingId}, bookingCode=${lock.bookingCode}, ` +
        `jobId=${lock.jobId}, attemptId=${lock.attemptId}, finalState=${lock.lifecycleState}, duration=${elapsedSec}s`,
    );
    return true;
  }

  /**
   * Checks whether a booking is currently undergoing active execution
   */
  public static isBookingActive(bookingIdOrCode: string): boolean {
    return (
      this.locksByBookingId.has(bookingIdOrCode) ||
      this.locksByBookingCode.has(bookingIdOrCode) ||
      this.locksByJobId.has(bookingIdOrCode)
    );
  }

  /**
   * Returns active lock details if present
   */
  public static getActiveLock(bookingIdOrCode: string): ExecutionLockInfo | undefined {
    return (
      this.locksByBookingId.get(bookingIdOrCode) ||
      this.locksByBookingCode.get(bookingIdOrCode) ||
      this.locksByJobId.get(bookingIdOrCode)
    );
  }

  public static getLock(bookingIdOrCode: string): ExecutionLockInfo | undefined {
    return this.getActiveLock(bookingIdOrCode);
  }

  /**
   * Clears all locks (for test isolation)
   */
  public static clearAll(): void {
    this.locksByBookingId.clear();
    this.locksByBookingCode.clear();
    this.locksByJobId.clear();
  }
}
