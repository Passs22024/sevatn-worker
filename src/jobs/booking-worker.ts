import { ApiClient } from '../api/client';
import { PlaywrightSabarimalaAdapter } from '../sabarimala/sabarimala-adapter';
import { normalizeDate } from '../sabarimala/virtual-q';
import { CredentialManager } from '../security/credential-manager';
import { SanitizedLogger } from '../monitoring/logger';
import { BookingExecutionContext, SabarimalaPostLoginFlow } from '../sabarimala/post-login-flow';
import { BookingExecutionGuard } from '../security/execution-guard';
import { validateNominee } from '../security/nominee-validator';
import { BookingConfirmationFlow } from '../sabarimala/flows/booking-confirmation.flow';

export interface BookingJobData {
  id: string;
  bookingRequestId: string;
  bookingCode: string;
  requestedDate: string | Date;
  route: string;
  pilgrimCount?: number;
  timeSlot?: string;
  selectedTime?: string;
  preferences?: Record<string, any>;
  pilgrims?: any[];
  nominee?: any;
  nominees?: any[];
  account?: {
    id: string;
    username: string;
    encryptedPassword?: string;
    encryptionIv?: string;
    encryptionTag?: string;
  } | null;
  leaseExpiresAt?: string;
  leaseGeneration?: number;
  fencingToken?: string;
}

export class BookingWorker {
  constructor(private apiClient: ApiClient) {}

  private async reportProgress(job: BookingJobData, status: string, note?: string, logs?: any) {
    return this.apiClient.updateJobProgress(job.id, {
      status,
      note,
      logs,
      leaseGeneration: job.leaseGeneration,
      fencingToken: job.fencingToken,
    });
  }

  private async reportComplete(
    job: BookingJobData,
    payload: {
      officialReference?: string;
      cartId?: string;
      officialBookingReference?: string;
      officialReceiptReference?: string;
      portalTransactionReference?: string;
      confirmationEvidence?: any;
      confirmedAt?: string;
      confirmationData?: any;
      note?: string;
    },
  ) {
    return this.apiClient.completeJob(job.id, {
      ...payload,
      leaseGeneration: job.leaseGeneration,
      fencingToken: job.fencingToken,
    });
  }

  private async reportFail(job: BookingJobData, payload: { status: string; errorCode?: string; errorMessage?: string }) {
    return this.apiClient.failJob(job.id, {
      ...payload,
      leaseGeneration: job.leaseGeneration,
      fencingToken: job.fencingToken,
    });
  }

  async execute(job: BookingJobData): Promise<void> {
    const canonicalDate = normalizeDate(job.requestedDate);
    const isPendingExecution = !!job.selectedTime;
    const bookingKey = job.bookingRequestId || job.bookingCode || job.id;
    let internalLockAcquired = false;

    // Defense-in-depth: Ensure atomic per-booking execution lock is held
    const activeLock =
      BookingExecutionGuard.getLock(bookingKey) ||
      (job.bookingCode ? BookingExecutionGuard.getLock(job.bookingCode) : undefined) ||
      BookingExecutionGuard.getLock(job.id);

    if (activeLock) {
      if (activeLock.jobId !== job.id) {
        SanitizedLogger.warn(
          `[BOOKING] Deduplication: Aborting duplicate execution for #${job.bookingCode || bookingKey}. Active lock owned by Job #${activeLock.jobId} (Attempt: ${activeLock.attemptId}).`,
        );
        return;
      }
      // If it's the exact same jobId, lock was already acquired upstream by Orchestrator
    } else {
      const lockRes = BookingExecutionGuard.acquire({
        bookingId: job.bookingRequestId || job.id,
        bookingCode: job.bookingCode || job.id,
        jobId: job.id,
        dispatchSource: (job as any).dispatchSource || (isPendingExecution ? 'PENDING_MONITOR' : 'QUEUE_POLL'),
        owner: 'BOOKING_WORKER',
      });
      if (!lockRes.acquired) {
        SanitizedLogger.warn(
          `[BOOKING] Deduplication: Aborting duplicate execution for #${job.bookingCode || bookingKey}. Active lock owned by Job #${lockRes.existingLock?.jobId}.`,
        );
        return;
      }
      internalLockAcquired = true;
    }

    const authPolicy = (job.preferences as any)?.customerAuthorizationPolicy || {};
    const ctx: BookingExecutionContext = {
      bookingId: job.bookingRequestId,
      bookingCode: job.bookingCode,
      requestedDate: canonicalDate,
      requestedDateDisplay: SabarimalaPostLoginFlow.toDisplayDate(canonicalDate),
      requestedRoute: job.route,
      selectedTimeSlot: job.selectedTime || job.timeSlot || undefined,
      pilgrimCount: job.pilgrimCount || (job.pilgrims ? job.pilgrims.length : 1),
      reliefFund: 0,
      accountId: job.account?.id,
      nominee: job.nominee || null,
      nominees: (job as any).nominees || (job.preferences as any)?.nominees || [],
      pilgrims: job.pilgrims || [],
      preferences: job.preferences || {},
      allowZeroCostConfirmation: authPolicy.allowZeroCostConfirmation !== false,
      allowPayment: authPolicy.allowPayment === true,
    };

    if (isPendingExecution) {
      SanitizedLogger.info(`[PENDING-MONITOR] ⚡ Pending booking execution started`);
      SanitizedLogger.info(`[PENDING-MONITOR] Target: #${job.bookingCode} | Date: ${canonicalDate} | Slot: ${job.selectedTime}`);
    } else {
      SanitizedLogger.info(`[FAST-BOOKING] New request`);
      SanitizedLogger.info(`[FAST-BOOKING] Checking requested date: ${canonicalDate}`);
    }

    // STEP 0: MANDATORY NOMINEE VALIDATION (Fail-fast before launching browser)
    const nomineeCheck = validateNominee(ctx);
    if (!nomineeCheck.valid) {
      SanitizedLogger.error(`[BOOKING] Pre-execution nominee validation failed for #${job.bookingCode}: ${nomineeCheck.errors.join('; ')}`);
      BookingExecutionGuard.updateLifecycleState(bookingKey, 'HOLD_INVALID_NOMINEE');
      await this.apiClient.failJob(job.id, {
        status: 'HOLD_INVALID_NOMINEE',
        errorCode: 'NOMINEE_DETAILS_MISSING',
        errorMessage: `Mandatory nominee validation failed: ${nomineeCheck.errors.join('; ')}`,
      });
      if (internalLockAcquired) {
        BookingExecutionGuard.release(bookingKey, job.id);
      }
      return;
    }

    const adapter = new PlaywrightSabarimalaAdapter();

    try {
      await adapter.init();

      // STEP A: DIRECT LOGIN NAVIGATION & AUTHENTICATION
      BookingExecutionGuard.updateLifecycleState(bookingKey, 'PROCESSING');
      await this.apiClient.updateJobProgress(job.id, {
        status: 'PROCESSING',
        note: 'Navigating directly to official Sabarimala login',
      });

      const openLoginSuccess = await adapter.openLogin();
      if (!openLoginSuccess) {
        await this.apiClient.failJob(job.id, {
          status: 'SITE_ERROR',
          errorCode: 'OFFICIAL_SITE_UNAVAILABLE',
          errorMessage: 'Official Sabarimala login portal could not be reached.',
        });
        return;
      }

      // Check credentials before submitting
      if (!job.account || !job.account.encryptedPassword || !job.account.encryptionIv || !job.account.encryptionTag) {
        await this.apiClient.failJob(job.id, {
          status: 'LOGIN_FAILED',
          errorCode: 'CREDENTIALS_MISSING',
          errorMessage: 'No official Sabarimala credentials attached to this booking job.',
        });
        return;
      }

      const password = CredentialManager.decrypt(
        job.account.encryptedPassword,
        job.account.encryptionIv,
        job.account.encryptionTag,
      );

      const loginResult = await adapter.login(job.account.username, password);

      if (loginResult.status !== 'LOGIN_SUCCESS') {
        if (loginResult.status === 'OTP_REQUIRED' || loginResult.status === 'CAPTCHA_REQUIRED') {
          await this.apiClient.failJob(job.id, {
            status: 'REQUIRES_HUMAN',
            errorCode: loginResult.status,
            errorMessage: loginResult.message || 'Official portal requested verification challenge (CAPTCHA/OTP).',
          });
          return;
        } else {
          await this.apiClient.failJob(job.id, {
            status: 'LOGIN_FAILED',
            errorCode: loginResult.status,
            errorMessage: loginResult.message || 'Official Sabarimala login failed. Please check credentials.',
          });
          return;
        }
      }

      SanitizedLogger.info('[LOGIN] Login successful');
      BookingExecutionGuard.updateLifecycleState(bookingKey, 'LOGIN_SUCCESS');
      await this.apiClient.updateJobProgress(job.id, {
        status: 'LOGIN_SUCCESS',
        note: 'Official portal authenticated successfully.',
      });

      // STEP B: HOME AND VIRTUAL-Q NAVIGATION (#/home -> #/darshan)
      await adapter.navigateToHomeAndDarshan(ctx);

      // STEP C: DATE, ROUTE, AND TIME SLOT SELECTION ON #/darshan
      await adapter.selectAuthenticatedDateAndRoute(ctx);
      BookingExecutionGuard.updateLifecycleState(bookingKey, 'DATE_VERIFIED');
      await this.apiClient.updateJobProgress(job.id, {
        status: 'DATE_VERIFIED',
        note: `Date verified: ${ctx.requestedDateDisplay || ctx.requestedDate}`,
      });

      BookingExecutionGuard.updateLifecycleState(bookingKey, 'ROUTE_VERIFIED');
      await this.apiClient.updateJobProgress(job.id, {
        status: 'ROUTE_VERIFIED',
        note: `Route verified: ${ctx.requestedRoute}`,
      });

      BookingExecutionGuard.updateLifecycleState(bookingKey, 'SELECTING_SLOT');
      await this.apiClient.updateJobProgress(job.id, {
        status: 'SELECTING_SLOT',
        note: `Selecting time slot for ${canonicalDate}`,
      });
      const postLoginSlotResult = await adapter.selectPostLoginTimeSlot(ctx);
      SanitizedLogger.info(`[BOOKING] Post-login slot selected: ${postLoginSlotResult.selectedSlot}`);
      BookingExecutionGuard.updateLifecycleState(bookingKey, 'SLOT_VERIFIED');
      await this.apiClient.updateJobProgress(job.id, {
        status: 'SLOT_VERIFIED',
        note: `Time slot verified: ${postLoginSlotResult.selectedSlot}`,
      });

      await adapter.selectBookingType(ctx);
      adapter.verifyDateTimePreserved(ctx);

      // STEP D: PILGRIM SELECTION
      await this.reportProgress(job, 'SELECTING_EXISTING_PILGRIMS', 'Selecting registered pilgrims from official account');
      await adapter.selectAllExistingPilgrims(ctx);
      BookingExecutionGuard.updateLifecycleState(bookingKey, 'PILGRIMS_VERIFIED');
      await this.apiClient.updateJobProgress(job.id, {
        status: 'PILGRIMS_VERIFIED',
        note: `Pilgrims selected: ${ctx.pilgrimCount}`,
      });

      // STEP E: NOMINEE DETAILS AND RELIEF FUND = "NO"
      await this.reportProgress(job, 'POPULATING_NOMINEES', 'Populating nominee details for selected pilgrims');
      await adapter.populateNomineeDetails(ctx);
      BookingExecutionGuard.updateLifecycleState(bookingKey, 'NOMINEE_VERIFIED');
      await this.apiClient.updateJobProgress(job.id, {
        status: 'NOMINEE_VERIFIED',
        note: 'Nominee details populated and verified',
      });

      await adapter.handlePrasadamDetails(ctx);

      await this.reportProgress(job, 'SELECTING_RELIEF_FUND_NO', 'Setting "Contribute for Pilgrim Relief fund" to No');
      await adapter.selectReliefFundNo(ctx);
      BookingExecutionGuard.updateLifecycleState(bookingKey, 'RELIEF_VERIFIED');
      await this.apiClient.updateJobProgress(job.id, {
        status: 'RELIEF_VERIFIED',
        note: 'Relief fund set to No (₹0 contribution)',
      });

      // STEP F: ADD TO WISHLIST AND VERIFY NEWLY ADDED ITEM
      BookingExecutionGuard.updateLifecycleState(bookingKey, 'ADDING_TO_WISHLIST');
      await this.reportProgress(job, 'ADDING_TO_WISHLIST', 'Adding booking to Wishlist and verifying newly added item');
      await adapter.addToWishlistAndVerify(ctx);

      BookingExecutionGuard.updateLifecycleState(bookingKey, 'WISHLIST_VERIFIED');
      await this.reportProgress(job, 'WISHLIST_VERIFIED', 'Newly added wishlist item verified with date, route, slot, pilgrims and relief fund');

      // STEP G: PROCEED TO CHECKOUT
      BookingExecutionGuard.updateLifecycleState(bookingKey, 'PROCEEDING_TO_CHECKOUT');
      await this.reportProgress(job, 'PROCEEDING_TO_CHECKOUT', 'Proceeding to checkout with loader synchronization');
      await adapter.proceedToPaymentGateway(ctx);

      // STEP H: CHECKOUT VERIFIED (Authoritative comparison of payment page details)
      await adapter.verifyPaymentSummary(ctx);
      BookingExecutionGuard.updateLifecycleState(bookingKey, 'CHECKOUT_VERIFIED');
      await this.reportProgress(job, 'CHECKOUT_VERIFIED', 'Payment review page details independently verified against booking request');

      const rawAmount = ctx.grandTotal || '₹0.00';
      const isZeroCost = BookingConfirmationFlow.parseNumericAmount(rawAmount) === 0;

      if (isZeroCost) {
        if (ctx.allowZeroCostConfirmation === false) {
          SanitizedLogger.warn(`[BOOKING] Customer authorization required for zero-cost confirmation. Pausing.`);
          BookingExecutionGuard.updateLifecycleState(bookingKey, 'REQUIRES_HUMAN');
          await this.reportProgress(job, 'REQUIRES_HUMAN', 'Zero-cost confirmation awaiting customer authorization policy');
          return;
        }
        BookingExecutionGuard.updateLifecycleState(bookingKey, 'ZERO_COST_CONFIRMATION_PENDING');
        await this.reportProgress(job, 'ZERO_COST_CONFIRMATION_PENDING', 'Submitting official zero-cost Virtual-Q confirmation');
      } else {
        if (!ctx.allowPayment) {
          SanitizedLogger.warn(`[BOOKING] Paid booking requires explicit payment authorization: ${rawAmount}. Pausing.`);
          BookingExecutionGuard.updateLifecycleState(bookingKey, 'PAYMENT_PENDING');
          await this.reportProgress(job, 'PAYMENT_PENDING', `Paid booking awaiting customer payment authorization: ${rawAmount}`);
          return;
        }
        BookingExecutionGuard.updateLifecycleState(bookingKey, 'PAYMENT_PENDING');
        await this.reportProgress(job, 'PAYMENT_PENDING', `Executing payment transaction for ${rawAmount}`);
      }

      // STEP I: FINAL CONFIRMATION AND COMPLETION
      BookingExecutionGuard.updateLifecycleState(bookingKey, 'CONFIRMATION_PENDING');
      const confirmResult = await adapter.executePaymentProceedAndConfirm(ctx);
      const bookingRef = confirmResult.officialBookingReference || confirmResult.officialReference;
      const isCartId = !!(bookingRef && ctx.cartId && bookingRef === ctx.cartId);
      const isValidExternalRef =
        bookingRef &&
        typeof bookingRef === 'string' &&
        bookingRef.trim().length >= 6 &&
        !bookingRef.startsWith('SAB-2026-') &&
        !isCartId;

      if (confirmResult.confirmed && isValidExternalRef) {
        BookingExecutionGuard.updateLifecycleState(bookingKey, 'BOOKING_CONFIRMED');
        await this.reportComplete(job, {
          officialReference: bookingRef,
          officialBookingReference: bookingRef,
          cartId: confirmResult.cartId || ctx.cartId,
          portalTransactionReference: confirmResult.portalTransactionReference,
          officialReceiptReference: confirmResult.officialReceiptReference,
          confirmationEvidence: confirmResult.confirmationEvidence,
          confirmedAt: confirmResult.confirmedAt || new Date().toISOString(),
          confirmationData: confirmResult.confirmationData || {
            officialReference: bookingRef,
            officialBookingReference: bookingRef,
            cartId: confirmResult.cartId || ctx.cartId,
            portalTransactionReference: confirmResult.portalTransactionReference,
            requestedDate: canonicalDate,
            selectedTime: ctx.selectedTimeSlot,
            route: ctx.requestedRoute,
            pilgrimsCount: ctx.pilgrimCount || 1,
            grandTotal: rawAmount,
            timestamp: new Date().toISOString(),
            status: 'CONFIRMED',
          },
          note: `Official Sabarimala Pass confirmed #${bookingRef}`,
        });
      } else if (confirmResult.reconciliationRequired || !isValidExternalRef) {
        SanitizedLogger.warn(`[BOOKING] Outcome unconfirmed or authoritative reference missing for #${job.bookingCode}. Flagging as RECONCILIATION_REQUIRED.`);
        BookingExecutionGuard.updateLifecycleState(bookingKey, 'RECONCILIATION_REQUIRED');
        await this.reportFail(job, {
          status: 'RECONCILIATION_REQUIRED',
          errorCode: 'VERIFICATION_PENDING',
          errorMessage: confirmResult.message || 'Booking submission completed but official confirmation reference could not be authoritatively validated.',
        });
      } else {
        BookingExecutionGuard.updateLifecycleState(bookingKey, 'BOOKING_FAILED');
        await this.reportFail(job, {
          status: 'BOOKING_FAILED',
          errorCode: 'CONFIRMATION_FAILED',
          errorMessage: confirmResult.message || 'Official portal did not confirm reservation.',
        });
      }
    } catch (err: any) {
      SanitizedLogger.error(`[BOOKING] Exception during booking job #${job.bookingCode}:`, {
        name: err?.name,
        message: err?.message || String(err),
        stack: err?.stack,
      });

      let status = 'WORKER_ERROR';
      let errorCode = err.code || 'EXECUTION_EXCEPTION';
      const codeOrMsg = (err.code || '') + ' ' + (err.message || '');

      if (codeOrMsg.includes('SLOT_CARDS_MISSING')) {
        status = 'TEMPORARY_SLOT_LOST';
        errorCode = 'SLOT_CARDS_MISSING';
        BookingExecutionGuard.updateLifecycleState(bookingKey, 'RETRYABLE_FAILURE');
      } else if (codeOrMsg.includes('PAYMENT_REQUIRED_OR_AMBIGUOUS') || codeOrMsg.includes('PAYMENT_PENDING')) {
        status = 'REQUIRES_HUMAN';
        errorCode = 'PAYMENT_REQUIRED_OR_AMBIGUOUS';
        BookingExecutionGuard.updateLifecycleState(bookingKey, 'MANUAL_REVIEW');
      } else if (codeOrMsg.includes('PREVIOUS_BOOKING_RESTRICTION') || codeOrMsg.includes('ACCOUNT_PREVIOUS_BOOKING_RESTRICTED')) {
        status = 'ACCOUNT_PREVIOUS_BOOKING_RESTRICTED';
        errorCode = 'PREVIOUS_BOOKING_RESTRICTION';
        BookingExecutionGuard.updateLifecycleState(bookingKey, 'ACCOUNT_PREVIOUS_BOOKING_RESTRICTED');
      } else if (codeOrMsg.includes('NOMINEE_DETAILS_MISSING') || codeOrMsg.includes('NOMINEE_VALIDATION_FAILED') || codeOrMsg.includes('NOMINEE_REQUIRED')) {
        status = 'REQUIRES_HUMAN';
        errorCode = 'NOMINEE_DETAILS_MISSING';
        BookingExecutionGuard.updateLifecycleState(bookingKey, 'MANUAL_REVIEW');
      } else if (codeOrMsg.includes('PILGRIM_SELECTION_FAILED')) {
        status = 'REQUIRES_HUMAN';
        errorCode = 'PILGRIM_SELECTION_FAILED';
        BookingExecutionGuard.updateLifecycleState(bookingKey, 'MANUAL_REVIEW');
      } else if (codeOrMsg.includes('BUTTON_DISABLED')) {
        status = 'REQUIRES_HUMAN';
        errorCode = 'FORM_VALIDATION_ERROR';
        BookingExecutionGuard.updateLifecycleState(bookingKey, 'MANUAL_REVIEW');
      } else if (codeOrMsg.includes('SLOT_SELECTION_UNVERIFIED') || codeOrMsg.includes('SLOT_SELECTION_FAILED')) {
        status = 'TEMPORARY_SLOT_LOST';
        errorCode = 'SLOT_SELECTION_UNVERIFIED';
        BookingExecutionGuard.updateLifecycleState(bookingKey, 'RETRYABLE_FAILURE');
      } else if (codeOrMsg.includes('SLOT_UNAVAILABLE')) {
        status = 'TEMPORARY_SLOT_LOST';
        errorCode = 'SLOT_UNAVAILABLE';
        BookingExecutionGuard.updateLifecycleState(bookingKey, 'RETRYABLE_FAILURE');
      } else if (codeOrMsg.includes('RELIEF_FUND_UNVERIFIED') || codeOrMsg.includes('RELIEF_FUND_SELECTION_FAILED') || codeOrMsg.includes('RELIEF_FUND_ERROR')) {
        status = 'REQUIRES_HUMAN';
        errorCode = 'RELIEF_FUND_ERROR';
        BookingExecutionGuard.updateLifecycleState(bookingKey, 'MANUAL_REVIEW');
      } else if (codeOrMsg.includes('WISHLIST_MISMATCH') || codeOrMsg.includes('WISHLIST_VERIFICATION_MISMATCH') || codeOrMsg.includes('CHECKOUT_VERIFICATION_MISMATCH')) {
        status = 'WISHLIST_MISMATCH';
        errorCode = 'WISHLIST_MISMATCH';
        BookingExecutionGuard.updateLifecycleState(bookingKey, 'WISHLIST_MISMATCH');
      } else if (codeOrMsg.includes('WISHLIST_INSERTION_FAILED')) {
        status = 'REQUIRES_HUMAN';
        errorCode = 'WISHLIST_INSERTION_FAILED';
        BookingExecutionGuard.updateLifecycleState(bookingKey, 'MANUAL_REVIEW');
      } else if (codeOrMsg.includes('AUTHENTICATED_DATE_SELECTION_FAILED')) {
        status = 'WORKER_ERROR';
        errorCode = 'AUTHENTICATED_DATE_SELECTION_FAILED';
        BookingExecutionGuard.updateLifecycleState(bookingKey, 'RETRYABLE_FAILURE');
      } else if (codeOrMsg.includes('AUTHENTICATED_ROUTE_SELECTION_FAILED')) {
        status = 'WORKER_ERROR';
        errorCode = 'AUTHENTICATED_ROUTE_SELECTION_FAILED';
        BookingExecutionGuard.updateLifecycleState(bookingKey, 'RETRYABLE_FAILURE');
      } else if (codeOrMsg.includes('PRASADAM_VALIDATION_ERROR')) {
        status = 'REQUIRES_HUMAN';
        errorCode = 'PRASADAM_VALIDATION_ERROR';
        BookingExecutionGuard.updateLifecycleState(bookingKey, 'MANUAL_REVIEW');
      } else if (codeOrMsg.includes('ROUTE_SELECTION_MISMATCH')) {
        status = 'REQUIRES_HUMAN';
        errorCode = 'ROUTE_SELECTION_MISMATCH';
        BookingExecutionGuard.updateLifecycleState(bookingKey, 'MANUAL_REVIEW');
      } else if (codeOrMsg.includes('LOADER_TIMEOUT')) {
        status = 'LOADER_TIMEOUT';
        errorCode = 'LOADER_TIMEOUT';
        BookingExecutionGuard.updateLifecycleState(bookingKey, 'LOADER_TIMEOUT');
      } else if (codeOrMsg.includes('PAYMENT_PAGE_LOAD_FAILED')) {
        status = 'REQUIRES_HUMAN';
        errorCode = 'PAYMENT_PAGE_LOAD_FAILED';
        BookingExecutionGuard.updateLifecycleState(bookingKey, 'MANUAL_REVIEW');
      }

      // Ensure BookingExecutionGuard is transitioned out of active in-flight states on any exception
      const activeLock = BookingExecutionGuard.getActiveLock(bookingKey);
      if (activeLock && !['MANUAL_REVIEW', 'RETRYABLE_FAILURE', 'EXECUTION_FAILED', 'COMPLETED', 'ACCOUNT_PREVIOUS_BOOKING_RESTRICTED', 'WISHLIST_MISMATCH', 'LOADER_TIMEOUT'].includes(activeLock.lifecycleState)) {
        const fallbackLifecycle = status === 'REQUIRES_HUMAN' ? 'MANUAL_REVIEW' : (status || 'RETRYABLE_FAILURE');
        BookingExecutionGuard.updateLifecycleState(bookingKey, fallbackLifecycle);
      }

      await this.reportFail(job, {
        status,
        errorCode,
        errorMessage: err.message || 'Unexpected error communicating with official portal.',
      });
    } finally {
      if (internalLockAcquired) {
        BookingExecutionGuard.release(bookingKey, job.id);
      }
      await adapter.close().catch(() => {});
    }
  }
}
