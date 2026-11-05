import { BookingWorker, BookingJobData } from './booking-worker';
import { ApiClient } from '../api/client';
import { PlaywrightSabarimalaAdapter } from '../sabarimala/sabarimala-adapter';
import { CredentialManager } from '../security/credential-manager';
import { BookingExecutionGuard } from '../security/execution-guard';

jest.mock('../sabarimala/sabarimala-adapter');
jest.mock('../security/credential-manager');

describe('TicketAssist Booking Worker Sequence & Flow Regression Suite', () => {
  let mockApiClient: jest.Mocked<ApiClient>;
  let mockAdapter: any;

  const mockEncryptedAccount = {
    id: 'acc-123',
    username: '9876543210',
    encryptedPassword: 'enc:sample',
    encryptionIv: 'iv:sample',
    encryptionTag: 'tag:sample',
  };

  const sampleJob: BookingJobData = {
    id: 'job-001',
    bookingRequestId: 'req-001',
    bookingCode: 'TA-2026-999',
    requestedDate: '2026-10-20',
    route: 'Pamba - Marakkoottam - 4 Kms',
    timeSlot: 'Any Slot',
    account: mockEncryptedAccount,
    pilgrims: [{ fullName: 'Devotee A', age: 30, gender: 'MALE', idType: 'AADHAAR', idNumber: '111122223333' }],
    nominee: {
      nomineeName: 'Arthi',
      nomineeAge: 25,
      nomineeRelationship: 'Spouse',
      nomineePhone: '9876543210',
    },
    verifiedAvailable: true,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    BookingExecutionGuard.clearAll();

    mockApiClient = {
      updateJobProgress: jest.fn().mockResolvedValue({}),
      failJob: jest.fn().mockResolvedValue({}),
      completeJob: jest.fn().mockResolvedValue({}),
    } as any;

    (CredentialManager.decrypt as jest.Mock).mockReturnValue('DecryptedPassword123');

    mockAdapter = {
      init: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
      openLogin: jest.fn().mockResolvedValue(true),
      login: jest.fn().mockResolvedValue({ status: 'LOGIN_SUCCESS' }),
      navigateToHomeAndDarshan: jest.fn().mockResolvedValue(true),
      selectAuthenticatedDateAndRoute: jest.fn().mockResolvedValue(true),
      handlePostLoginPopup: jest.fn().mockResolvedValue(true),
      ensureBookingPageReady: jest.fn().mockResolvedValue(true),
      selectPostLoginTimeSlot: jest.fn().mockResolvedValue({
        success: true,
        selectedSlot: '05:00 - 06:00',
      }),
      selectBookingType: jest.fn().mockResolvedValue({
        success: true,
        selectedType: 'Others',
      }),
      verifyDateTimePreserved: jest.fn().mockReturnValue(true),
      selectAllExistingPilgrims: jest.fn().mockResolvedValue({ success: true, count: 1 }),
      populateNomineeDetails: jest.fn().mockResolvedValue(true),
      handlePrasadamDetails: jest.fn().mockResolvedValue(true),
      selectReliefFundNo: jest.fn().mockResolvedValue(true),
      checkWishlistForItem: jest.fn().mockResolvedValue(false),
      addToWishlistAndVerify: jest.fn().mockResolvedValue(true),
      proceedToPaymentGateway: jest.fn().mockResolvedValue(true),
      verifyPaymentSummary: jest.fn().mockResolvedValue(true),
      executePaymentProceedAndConfirm: jest.fn().mockResolvedValue({
        confirmed: true,
        officialReference: 'IVQ26100514030705319660',
      }),
      openDarshanAvailability: jest.fn().mockResolvedValue({ success: true }),
      checkRequestedDateAvailability: jest.fn().mockResolvedValue({ available: true }),
    };

    (PlaywrightSabarimalaAdapter as jest.Mock).mockImplementation(() => mockAdapter);
  });

  it('1. Direct login navigation: executes complete official flow without pre-login availability re-check', async () => {
    const worker = new BookingWorker(mockApiClient);
    await worker.execute(sampleJob);

    // Must NOT run pre-login public availability discovery
    expect(mockAdapter.openDarshanAvailability).not.toHaveBeenCalled();
    expect(mockAdapter.checkRequestedDateAvailability).not.toHaveBeenCalled();

    // Step A: Must navigate directly to login and authenticate
    expect(mockAdapter.openLogin).toHaveBeenCalled();
    expect(CredentialManager.decrypt).toHaveBeenCalledWith('enc:sample', 'iv:sample', 'tag:sample');
    expect(mockAdapter.login).toHaveBeenCalledWith('9876543210', 'DecryptedPassword123');

    // Step B: Must navigate home to darshan
    expect(mockAdapter.navigateToHomeAndDarshan).toHaveBeenCalled();

    // Step C: Must select authenticated date & route, then slot
    expect(mockAdapter.selectAuthenticatedDateAndRoute).toHaveBeenCalled();
    expect(mockAdapter.selectPostLoginTimeSlot).toHaveBeenCalled();
    expect(mockAdapter.selectBookingType).toHaveBeenCalled();

    // Step D: Must select pilgrims
    expect(mockAdapter.selectAllExistingPilgrims).toHaveBeenCalled();

    // Step E: Must populate nominee and select relief fund No
    expect(mockAdapter.populateNomineeDetails).toHaveBeenCalled();
    expect(mockAdapter.handlePrasadamDetails).toHaveBeenCalled();
    expect(mockAdapter.selectReliefFundNo).toHaveBeenCalled();

    // Step F: Must add to wishlist and verify
    expect(mockAdapter.addToWishlistAndVerify).toHaveBeenCalled();

    // Step G: Must proceed to payment gateway
    expect(mockAdapter.proceedToPaymentGateway).toHaveBeenCalled();

    // Step H: Must verify payment summary
    expect(mockAdapter.verifyPaymentSummary).toHaveBeenCalled();

    // Step I: Must execute proceed and complete with official reference
    expect(mockAdapter.executePaymentProceedAndConfirm).toHaveBeenCalled();
    expect(mockApiClient.completeJob).toHaveBeenCalledWith('job-001', expect.objectContaining({
      officialReference: 'IVQ26100514030705319660',
    }));

    // Must update progress through finite states
    expect(mockApiClient.updateJobProgress).toHaveBeenCalledWith('job-001', expect.objectContaining({ status: 'PROCESSING' }));
    expect(mockApiClient.updateJobProgress).toHaveBeenCalledWith('job-001', expect.objectContaining({ status: 'LOGIN_SUCCESS' }));
    expect(mockApiClient.updateJobProgress).toHaveBeenCalledWith('job-001', expect.objectContaining({ status: 'WISHLIST_VERIFIED' }));
    expect(mockApiClient.updateJobProgress).toHaveBeenCalledWith('job-001', expect.objectContaining({ status: 'PROCEEDING_TO_CHECKOUT' }));
    expect(mockApiClient.updateJobProgress).toHaveBeenCalledWith('job-001', expect.objectContaining({ status: 'CHECKOUT_VERIFIED' }));
    expect(mockApiClient.updateJobProgress).toHaveBeenCalledWith('job-001', expect.objectContaining({ status: 'ZERO_COST_CONFIRMATION_PENDING' }));
  });

  it('2. Login failure (invalid credentials): reports terminal LOGIN_FAILED without retry loop', async () => {
    mockAdapter.login.mockResolvedValue({
      status: 'INVALID_CREDENTIALS',
      message: 'Incorrect password entered',
    });

    const worker = new BookingWorker(mockApiClient);
    await worker.execute(sampleJob);

    expect(mockAdapter.login).toHaveBeenCalledWith('9876543210', 'DecryptedPassword123');
    expect(mockAdapter.navigateToHomeAndDarshan).not.toHaveBeenCalled();
    expect(mockAdapter.addToWishlistAndVerify).not.toHaveBeenCalled();

    expect(mockApiClient.failJob).toHaveBeenCalledWith('job-001', expect.objectContaining({
      status: 'LOGIN_FAILED',
      errorCode: 'INVALID_CREDENTIALS',
    }));
  });

  it('3. Login verification challenge (OTP/CAPTCHA): safely reports REQUIRES_HUMAN', async () => {
    mockAdapter.login.mockResolvedValue({
      status: 'OTP_REQUIRED',
      message: 'Official portal requested OTP verification',
    });

    const worker = new BookingWorker(mockApiClient);
    await worker.execute(sampleJob);

    expect(mockAdapter.login).toHaveBeenCalledWith('9876543210', 'DecryptedPassword123');
    expect(mockAdapter.navigateToHomeAndDarshan).not.toHaveBeenCalled();
    expect(mockAdapter.addToWishlistAndVerify).not.toHaveBeenCalled();

    expect(mockApiClient.failJob).toHaveBeenCalledWith('job-001', expect.objectContaining({
      status: 'REQUIRES_HUMAN',
      errorCode: 'OTP_REQUIRED',
    }));
  });

  it('4. Site Error: safely handles portal unreachable during direct login navigation', async () => {
    mockAdapter.openLogin.mockResolvedValue(false);

    const worker = new BookingWorker(mockApiClient);
    await worker.execute(sampleJob);

    expect(mockAdapter.openLogin).toHaveBeenCalled();
    expect(mockAdapter.login).not.toHaveBeenCalled();

    expect(mockApiClient.failJob).toHaveBeenCalledWith('job-001', expect.objectContaining({
      status: 'SITE_ERROR',
      errorCode: 'OFFICIAL_SITE_UNAVAILABLE',
    }));
  });

  it('5. Missing Credentials: safely fails with CREDENTIALS_MISSING without leakage', async () => {
    const jobWithoutAccount: BookingJobData = {
      ...sampleJob,
      account: null,
    };

    const worker = new BookingWorker(mockApiClient);
    await worker.execute(jobWithoutAccount);

    expect(mockAdapter.openLogin).toHaveBeenCalled();
    expect(CredentialManager.decrypt).not.toHaveBeenCalled();
    expect(mockAdapter.login).not.toHaveBeenCalled();

    expect(mockApiClient.failJob).toHaveBeenCalledWith('job-001', expect.objectContaining({
      status: 'LOGIN_FAILED',
      errorCode: 'CREDENTIALS_MISSING',
    }));
  });

  it('6. Booking-to-Account Association: uses correct decrypted credentials for specific booking', async () => {
    const anotherJob: BookingJobData = {
      ...sampleJob,
      id: 'job-999',
      bookingCode: 'TA-2026-888',
      account: {
        id: 'acc-999',
        username: '9123456789',
        encryptedPassword: 'enc:custom',
        encryptionIv: 'iv:custom',
        encryptionTag: 'tag:custom',
      },
    };

    (CredentialManager.decrypt as jest.Mock).mockReturnValue('DecryptedCustomPass');

    const worker = new BookingWorker(mockApiClient);
    await worker.execute(anotherJob);

    expect(CredentialManager.decrypt).toHaveBeenCalledWith('enc:custom', 'iv:custom', 'tag:custom');
    expect(mockAdapter.login).toHaveBeenCalledWith('9123456789', 'DecryptedCustomPass');
    expect(mockApiClient.completeJob).toHaveBeenCalledWith('job-999', expect.any(Object));
  });

  it('7. Missing Nominee Details: safely stops with REQUIRES_HUMAN when nominee is mandatory on portal', async () => {
    mockAdapter.populateNomineeDetails.mockRejectedValue(
      new Error('NOMINEE_DETAILS_MISSING: Nominee details are mandatory for pilgrim #1 but not provided in booking data.')
    );

    const worker = new BookingWorker(mockApiClient);
    await worker.execute(sampleJob);

    expect(mockAdapter.populateNomineeDetails).toHaveBeenCalled();
    expect(mockAdapter.addToWishlistAndVerify).not.toHaveBeenCalled();

    expect(mockApiClient.failJob).toHaveBeenCalledWith('job-001', expect.objectContaining({
      status: 'REQUIRES_HUMAN',
      errorCode: 'NOMINEE_DETAILS_MISSING',
    }));
  });

  it('8. Official Portal Restriction: catches previous booking restriction without infinite wait', async () => {
    mockAdapter.addToWishlistAndVerify.mockRejectedValue(
      new Error('PREVIOUS_BOOKING_RESTRICTION: Official portal reports you cannot make transaction until you avail previous booking.')
    );

    const worker = new BookingWorker(mockApiClient);
    await worker.execute(sampleJob);

    expect(mockAdapter.addToWishlistAndVerify).toHaveBeenCalled();
    expect(mockAdapter.proceedToPaymentGateway).not.toHaveBeenCalled();

    expect(mockApiClient.failJob).toHaveBeenCalledWith('job-001', expect.objectContaining({
      status: 'ACCOUNT_PREVIOUS_BOOKING_RESTRICTED',
      errorCode: 'PREVIOUS_BOOKING_RESTRICTION',
    }));
  });

  it('9. Post-login Slot Unavailable: catches slot depletion and marks TEMPORARY_SLOT_LOST', async () => {
    mockAdapter.selectPostLoginTimeSlot.mockRejectedValue(
      new Error('SLOT_UNAVAILABLE: All post-login slots are fully booked or closed on 2026-10-20')
    );

    const worker = new BookingWorker(mockApiClient);
    await worker.execute(sampleJob);

    expect(mockAdapter.selectPostLoginTimeSlot).toHaveBeenCalled();
    expect(mockAdapter.selectAllExistingPilgrims).not.toHaveBeenCalled();

    expect(mockApiClient.failJob).toHaveBeenCalledWith('job-001', expect.objectContaining({
      status: 'TEMPORARY_SLOT_LOST',
      errorCode: 'SLOT_UNAVAILABLE',
    }));
  });

  it('10. Unverified Slot: fails safely with TEMPORARY_SLOT_LOST and does not silently proceed', async () => {
    mockAdapter.selectPostLoginTimeSlot.mockRejectedValue(
      new Error('SLOT_SELECTION_UNVERIFIED: Clicked slot card 05:00 - 06:00 but official portal did not accept the selection (.slot-dar-5 missing).')
    );

    const worker = new BookingWorker(mockApiClient);
    await worker.execute(sampleJob);

    expect(mockAdapter.selectPostLoginTimeSlot).toHaveBeenCalled();
    expect(mockAdapter.selectAllExistingPilgrims).not.toHaveBeenCalled();

    expect(mockApiClient.failJob).toHaveBeenCalledWith('job-001', expect.objectContaining({
      status: 'TEMPORARY_SLOT_LOST',
      errorCode: 'SLOT_SELECTION_UNVERIFIED',
    }));
  });

  it('11. Disabled Add to Wishlist Button (#regi_continue): produces diagnostic error instead of generic timeout', async () => {
    mockAdapter.addToWishlistAndVerify.mockRejectedValue(
      new Error('BUTTON_DISABLED: Add to Wishlist button (#regi_continue) is disabled. Reason: Slot selection unconfirmed on portal.')
    );

    const worker = new BookingWorker(mockApiClient);
    await worker.execute(sampleJob);

    expect(mockAdapter.addToWishlistAndVerify).toHaveBeenCalled();
    expect(mockAdapter.proceedToPaymentGateway).not.toHaveBeenCalled();

    expect(mockApiClient.failJob).toHaveBeenCalledWith('job-001', expect.objectContaining({
      status: 'REQUIRES_HUMAN',
      errorCode: 'FORM_VALIDATION_ERROR',
    }));
  });

  it('12. Relief Fund Verification Failure: safely reports REQUIRES_HUMAN with RELIEF_FUND_ERROR', async () => {
    mockAdapter.selectReliefFundNo.mockRejectedValue(
      new Error('RELIEF_FUND_UNVERIFIED: Relief fund "No" radio could not be verified as checked.')
    );

    const worker = new BookingWorker(mockApiClient);
    await worker.execute(sampleJob);

    expect(mockAdapter.selectReliefFundNo).toHaveBeenCalled();
    expect(mockAdapter.addToWishlistAndVerify).not.toHaveBeenCalled();

    expect(mockApiClient.failJob).toHaveBeenCalledWith('job-001', expect.objectContaining({
      status: 'REQUIRES_HUMAN',
      errorCode: 'RELIEF_FUND_ERROR',
    }));
  });

  it('13. Unexpected Non-Zero Payment Requirement: safely reports REQUIRES_HUMAN with PAYMENT_REQUIRED_OR_AMBIGUOUS', async () => {
    mockAdapter.verifyPaymentSummary.mockRejectedValue(
      new Error('PAYMENT_REQUIRED_OR_AMBIGUOUS: Payment gateway requires payment of ₹250. Automated payment not configured; requires human review.')
    );

    const worker = new BookingWorker(mockApiClient);
    await worker.execute(sampleJob);

    expect(mockAdapter.verifyPaymentSummary).toHaveBeenCalled();
    expect(mockAdapter.executePaymentProceedAndConfirm).not.toHaveBeenCalled();

    expect(mockApiClient.failJob).toHaveBeenCalledWith('job-001', expect.objectContaining({
      status: 'REQUIRES_HUMAN',
      errorCode: 'PAYMENT_REQUIRED_OR_AMBIGUOUS',
    }));
  });

  it('14. Ambiguous confirmation result: routes to UNKNOWN_RESULT rather than completing without reference', async () => {
    mockAdapter.executePaymentProceedAndConfirm.mockResolvedValue({
      confirmed: false,
      message: 'Official confirmation detected but authoritative reference was missing. Requires human reconciliation.',
    });

    const worker = new BookingWorker(mockApiClient);
    await worker.execute(sampleJob);

    expect(mockAdapter.executePaymentProceedAndConfirm).toHaveBeenCalled();
    expect(mockApiClient.completeJob).not.toHaveBeenCalled();

    expect(mockApiClient.failJob).toHaveBeenCalledWith('job-001', expect.objectContaining({
      status: expect.stringMatching(/RECONCILIATION_REQUIRED|UNKNOWN_RESULT/),
      errorCode: 'VERIFICATION_PENDING',
    }));
  });

  it('15. Duplicate Execution Guard: rejects concurrent second dispatch for the same active booking', async () => {
    // Acquire lock for sampleJob to simulate an ongoing execution
    const lockAcquired = BookingExecutionGuard.acquire({
      bookingId: 'req-001',
      bookingCode: 'TA-2026-999',
      jobId: 'job-001',
      dispatchSource: 'PENDING_MONITOR',
      owner: 'FIRST_WORKER_THREAD',
    });
    expect(lockAcquired.acquired).toBe(true);

    const worker = new BookingWorker(mockApiClient);
    // Attempt second execution for the same booking
    await worker.execute({
      ...sampleJob,
      id: 'job-duplicate',
    });

    // Must NOT start second adapter or proceed with login
    expect(mockAdapter.init).not.toHaveBeenCalled();
    expect(mockAdapter.openLogin).not.toHaveBeenCalled();
    expect(mockApiClient.completeJob).not.toHaveBeenCalled();
  });

  it('16. Missing Slot Cards: stops workflow before pilgrim submission and marks TEMPORARY_SLOT_LOST', async () => {
    mockAdapter.selectPostLoginTimeSlot.mockRejectedValue(
      new Error('SLOT_CARDS_MISSING: No slot cards appeared on authenticated booking page for date 2026-10-20. Stopping before pilgrim submission.')
    );

    const worker = new BookingWorker(mockApiClient);
    await worker.execute(sampleJob);

    expect(mockAdapter.selectPostLoginTimeSlot).toHaveBeenCalled();
    expect(mockAdapter.selectAllExistingPilgrims).not.toHaveBeenCalled();
    expect(mockAdapter.addToWishlistAndVerify).not.toHaveBeenCalled();

    expect(mockApiClient.failJob).toHaveBeenCalledWith('job-001', expect.objectContaining({
      status: 'TEMPORARY_SLOT_LOST',
      errorCode: 'SLOT_CARDS_MISSING',
    }));
  });

  it('17. Executes wishlist addition and verification without assuming pre-existing items match', async () => {
    const worker = new BookingWorker(mockApiClient);
    await worker.execute(sampleJob);

    // Must call addToWishlistAndVerify to ensure exact match of the target submission
    expect(mockAdapter.addToWishlistAndVerify).toHaveBeenCalled();
    // Must proceed directly to payment gateway
    expect(mockAdapter.proceedToPaymentGateway).toHaveBeenCalled();
    expect(mockApiClient.completeJob).toHaveBeenCalledWith('job-001', expect.any(Object));
  });

  it('18. Pre-flight check: aborts login early if unverified date is unavailable on portal', async () => {
    mockAdapter.checkRequestedDateAvailability.mockResolvedValue({
      available: false,
      state: 'FULL',
    });

    const unverifiedJob: BookingJobData = {
      ...sampleJob,
      id: 'job-unverified',
      verifiedAvailable: false,
    };

    const worker = new BookingWorker(mockApiClient);
    await worker.execute(unverifiedJob);

    // Pre-flight check must be performed
    expect(mockAdapter.openDarshanAvailability).toHaveBeenCalled();
    expect(mockAdapter.checkRequestedDateAvailability).toHaveBeenCalledWith('2026-10-20');

    // Login must NOT be called
    expect(mockAdapter.openLogin).not.toHaveBeenCalled();
    expect(mockAdapter.login).not.toHaveBeenCalled();

    // Job must fail with DATE_UNAVAILABLE
    expect(mockApiClient.failJob).toHaveBeenCalledWith('job-unverified', expect.objectContaining({
      status: 'DATE_UNAVAILABLE',
      errorCode: 'DATE_UNAVAILABLE',
    }));
  });
});
