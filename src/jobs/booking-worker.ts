import { ApiClient } from '../api/client';
import { PlaywrightSabarimalaAdapter } from '../sabarimala/sabarimala-adapter';
import { normalizeDate } from '../sabarimala/virtual-q';
import { CredentialManager } from '../security/credential-manager';
import { SanitizedLogger } from '../monitoring/logger';
import { BookingExecutionContext, SabarimalaPostLoginFlow } from '../sabarimala/post-login-flow';

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
  account?: {
    id: string;
    username: string;
    encryptedPassword?: string;
    encryptionIv?: string;
    encryptionTag?: string;
  } | null;
  leaseExpiresAt?: string;
}

export class BookingWorker {
  constructor(private apiClient: ApiClient) {}

  async execute(job: BookingJobData): Promise<void> {
    const canonicalDate = normalizeDate(job.requestedDate);
    const isPendingExecution = !!job.selectedTime;

    const ctx: BookingExecutionContext = {
      bookingId: job.bookingRequestId,
      bookingCode: job.bookingCode,
      requestedDate: canonicalDate,
      requestedDateDisplay: SabarimalaPostLoginFlow.toDisplayDate(canonicalDate),
      requestedRoute: job.route,
      selectedTimeSlot: job.selectedTime || undefined,
      pilgrimCount: job.pilgrimCount || 1,
      reliefFund: 0,
      accountId: job.account?.id,
    };

    if (isPendingExecution) {
      SanitizedLogger.info(`[PENDING-MONITOR] ⚡ Pending booking execution started`);
      SanitizedLogger.info(`[PENDING-MONITOR] Target: #${job.bookingCode} | Date: ${canonicalDate} | Slot: ${job.selectedTime}`);
    } else {
      SanitizedLogger.info(`[FAST-BOOKING] New request`);
      SanitizedLogger.info(`[FAST-BOOKING] Checking requested date: ${canonicalDate}`);
    }

    const adapter = new PlaywrightSabarimalaAdapter();

    try {
      // STEP 1: OPEN DARSHAN AVAILABILITY PAGE (Pre-login public page)
      await this.apiClient.updateJobProgress(job.id, {
        status: 'OPENING_OFFICIAL_SITE',
        note: 'Opening official portal darshanAvailability',
      });

      await adapter.init();
      const openResult = await adapter.openDarshanAvailability();

      if (!openResult.success) {
        await this.apiClient.failJob(job.id, {
          status: 'SITE_ERROR',
          errorCode: 'OFFICIAL_SITE_UNAVAILABLE',
          errorMessage: 'Official Sabarimala portal could not be reached.',
        });
        return;
      }

      // STEP 2: CHECK ONLY REQUESTED DATE ON DARSHAN AVAILABILITY CALENDAR
      const checkAvail = await adapter.checkRequestedDateAvailability(canonicalDate);

      if (!checkAvail.available) {
        // PATH B: DATE UNAVAILABLE -> PENDING
        SanitizedLogger.warn(`[PENDING-MONITOR] 🔴 DATE UNAVAILABLE`);
        SanitizedLogger.info(`[PENDING-MONITOR] Moving booking to PENDING`);
        SanitizedLogger.info(`[PENDING-MONITOR] Watching requested date: ${canonicalDate}`);

        await this.apiClient.updateJobProgress(job.id, {
          status: 'DATE_UNAVAILABLE',
          note: `Requested date ${canonicalDate} is currently unavailable. Moved to PENDING.`,
        });

        await this.apiClient.failJob(job.id, {
          status: 'DATE_UNAVAILABLE',
          errorCode: 'DATE_UNAVAILABLE',
          errorMessage: `Requested date ${canonicalDate} is currently unavailable. Handed to Smart Matcher.`,
        });
        return;
      }

      // PATH A: DATE AVAILABLE -> FAST PATH IMMEDIATE EXECUTION
      if (!isPendingExecution) {
        SanitizedLogger.info(`[FAST-BOOKING] 🟢 DATE AVAILABLE`);
        SanitizedLogger.info(`[FAST-BOOKING] Fast booking path selected`);

        await this.apiClient.updateJobProgress(job.id, {
          status: 'DATE_AVAILABLE',
          note: `Requested date ${canonicalDate} is available. Proceeding with fast booking path.`,
        });

        await this.apiClient.updateJobProgress(job.id, {
          status: 'FAST_BOOKING_QUEUED',
          note: `Fast booking execution queued for ${canonicalDate}`,
        });
      }

      // STEP 3: SELECT REQUESTED DATE
      await this.apiClient.updateJobProgress(job.id, {
        status: 'SELECTING_DATE',
        note: `Selecting Darshan Date: ${canonicalDate}`,
      });

      try {
        await adapter.selectRequestedDate(canonicalDate);
        SanitizedLogger.info(`[FAST-BOOKING] Date selected`);
      } catch (selErr: any) {
        SanitizedLogger.warn(`[FAST-BOOKING] Date selection error for ${canonicalDate}:`, selErr.message);
        await this.apiClient.failJob(job.id, {
          status: 'TEMPORARY_SLOT_LOST',
          errorMessage: `Date selection could not be finalized for ${canonicalDate}. Returned to pending queue.`,
        });
        return;
      }

      // STEP 4: SELECT REQUESTED ROUTE
      await this.apiClient.updateJobProgress(job.id, {
        status: 'SELECTING_ROUTE',
        note: `Selecting preferred Route: ${job.route}`,
      });

      const routeResult = await adapter.selectRoute(job.route);
      SanitizedLogger.info(`[BOOKING] Selected route: ${routeResult.selectedRoute}`);

      // STEP 5: SELECT TIME SLOT
      const preferredSlot = ctx.selectedTimeSlot || job.timeSlot;
      let slotResult;
      try {
        slotResult = await adapter.selectAvailableTimeSlot(preferredSlot);
        ctx.selectedTimeSlot = slotResult.selectedSlot;
        SanitizedLogger.info(`[BOOKING] Selected time slot: ${slotResult.selectedSlot}`);
        SanitizedLogger.info(`[BOOKING] Time slot verified: ${slotResult.selectedSlot}`);
      } catch (slotErr: any) {
        SanitizedLogger.warn(`[FAST-BOOKING] Slot selection failed for ${canonicalDate}:`, slotErr.message);
        await this.apiClient.failJob(job.id, {
          status: 'TEMPORARY_SLOT_LOST',
          errorMessage: `No selectable time slots on ${canonicalDate}. Returned to pending queue.`,
        });
        return;
      }

      // STEP 6: PROCEED TO LOGIN
      await this.apiClient.updateJobProgress(job.id, {
        status: 'LOGIN_IN_PROGRESS',
        note: 'Redirecting to official login page',
      });

      await adapter.proceedToLogin();

      // STEP 7: LOGIN WITH ATTACHED OFFICIAL ACCOUNT CREDENTIALS
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
      await this.apiClient.updateJobProgress(job.id, {
        status: 'LOGIN_SUCCESS',
        note: 'Official portal authenticated successfully.',
      });

      // STEP 8: HANDLE POST-LOGIN POPUP
      await adapter.handlePostLoginPopup();

      // STEP 9: PRESERVE DATE & TIME
      adapter.verifyDateTimePreserved(ctx);

      // STEP 10: SELECT REGISTERED PILGRIMS
      await this.apiClient.updateJobProgress(job.id, {
        status: 'SELECTING_EXISTING_PILGRIMS',
        note: 'Selecting all registered pilgrims from official account',
      });

      await adapter.selectAllExistingPilgrims(ctx);

      // STEP 11: RELIEF FUND = "NO"
      await this.apiClient.updateJobProgress(job.id, {
        status: 'SELECTING_RELIEF_FUND_NO',
        note: 'Setting "Contribute for Pilgrim Relief fund" to No',
      });

      await adapter.selectReliefFundNo(ctx);

      // STEP 12: ADD TO WISHLIST AND VERIFY WISHLIST DATA
      await this.apiClient.updateJobProgress(job.id, {
        status: 'ADDING_TO_WISHLIST',
        note: 'Adding booking to Wishlist and verifying details',
      });

      await adapter.addToWishlistAndVerify(ctx);

      // STEP 13: PROCEED TO PAYMENT GATEWAY
      await this.apiClient.updateJobProgress(job.id, {
        status: 'BOOKING_IN_PROGRESS',
        note: 'Opening payment gateway page',
      });

      await adapter.proceedToPaymentGateway(ctx);

      // STEP 14: VERIFY PAYMENT SUMMARY
      await adapter.verifyPaymentSummary(ctx);

      // STEP 15: EXECUTE FINAL PAYMENT PROCEED AND CONFIRM
      await this.apiClient.updateJobProgress(job.id, {
        status: 'VERIFYING_RESULT',
        note: 'Executing final proceed action and verifying confirmation',
      });

      const confirmResult = await adapter.executePaymentProceedAndConfirm(ctx);

      const ref = confirmResult.officialReference;
      const isValidExternalRef = ref && typeof ref === 'string' && ref.trim().length >= 6 && !ref.startsWith('SAB-2026-');

      if (confirmResult.confirmed && isValidExternalRef) {
        await this.apiClient.completeJob(job.id, {
          officialReference: ref,
          confirmationData: confirmResult.confirmationData || {
            officialReference: ref,
            requestedDate: canonicalDate,
            selectedTime: ctx.selectedTimeSlot,
            route: ctx.requestedRoute,
            pilgrimsCount: ctx.pilgrimCount || 1,
            timestamp: new Date().toISOString(),
            status: 'CONFIRMED',
          },
          note: `Official Sabarimala Pass confirmed #${ref}`,
        });
      } else {
        SanitizedLogger.warn(`[BOOKING] Booking outcome unconfirmed or missing valid external reference for #${job.bookingCode}. Flagging as UNKNOWN_RESULT.`);
        await this.apiClient.failJob(job.id, {
          status: 'UNKNOWN_RESULT',
          errorCode: 'VERIFICATION_PENDING',
          errorMessage: confirmResult.message || 'Booking action completed external submission but official reference could not be authoritatively validated.',
        });
      }
    } catch (err: any) {
      SanitizedLogger.error(`[BOOKING] Exception during booking job #${job.bookingCode}:`, {
        name: err?.name,
        message: err?.message || String(err),
        stack: err?.stack,
      });
      await this.apiClient.failJob(job.id, {
        status: 'WORKER_ERROR',
        errorCode: 'EXECUTION_EXCEPTION',
        errorMessage: err.message || 'Unexpected error communicating with official portal.',
      });
    } finally {
      await adapter.close().catch(() => {});
    }
  }
}
