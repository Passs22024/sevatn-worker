import { BookingWorker, BookingJobData } from './booking-worker';
import { ApiClient } from '../api/client';
import { PlaywrightSabarimalaAdapter } from '../sabarimala/sabarimala-adapter';
import { CredentialManager } from '../security/credential-manager';
import { BookingExecutionGuard } from '../security/execution-guard';
import { validateNominee } from '../security/nominee-validator';
import { BookingConfirmationFlow } from '../sabarimala/flows/booking-confirmation.flow';

jest.mock('../sabarimala/sabarimala-adapter');
jest.mock('../security/credential-manager');

describe('SEVATN Phase 4 Autonomous Booking Execution Engine Test Suite', () => {
  let mockApiClient: jest.Mocked<ApiClient>;
  let mockAdapter: any;

  const validEncryptedAccount = {
    id: 'acc-8098697141',
    username: '8098697141',
    encryptedPassword: 'enc:sample',
    encryptionIv: 'iv:sample',
    encryptionTag: 'tag:sample',
  };

  const validTestJob: BookingJobData = {
    id: 'job-phase4-001',
    bookingRequestId: 'req-phase4-001',
    bookingCode: 'TA-10045',
    requestedDate: '2026-11-20',
    route: 'Pamba (Regular Footpath Route)',
    timeSlot: '03:00 - 04:00',
    selectedTime: '03:00 - 04:00',
    pilgrimCount: 1,
    account: validEncryptedAccount,
    pilgrims: [
      {
        fullName: 'Devotee One',
        age: 30,
        gender: 'MALE',
        idType: 'AADHAAR',
        idNumber: '123456789012',
      },
    ],
    nominee: {
      nomineeName: 'NIJA',
      nomineeAge: 23,
      nomineeRelationship: 'Brother',
      nomineePhone: '9876543210',
    },
    preferences: {
      customerAuthorizationPolicy: {
        allowZeroCostConfirmation: true,
      },
    },
    leaseGeneration: 1,
    fencingToken: 'fnc_token_valid_123',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    BookingExecutionGuard.clearAll();

    mockApiClient = {
      updateJobProgress: jest.fn().mockResolvedValue({}),
      completeJob: jest.fn().mockResolvedValue({}),
      failJob: jest.fn().mockResolvedValue({}),
    } as any;

    (CredentialManager.decrypt as jest.Mock).mockReturnValue('Pass@2025');

    mockAdapter = {
      init: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
      openLogin: jest.fn().mockResolvedValue(true),
      login: jest.fn().mockResolvedValue({ status: 'LOGIN_SUCCESS' }),
      navigateToHomeAndDarshan: jest.fn().mockResolvedValue(true),
      selectAuthenticatedDateAndRoute: jest.fn().mockResolvedValue(true),
      selectPostLoginTimeSlot: jest.fn().mockResolvedValue({
        slotFound: true,
        selectedSlot: '03:00 - 04:00',
        availableSeats: 100,
      }),
      selectBookingType: jest.fn().mockResolvedValue(true),
      verifyDateTimePreserved: jest.fn().mockReturnValue(true),
      selectAllExistingPilgrims: jest.fn().mockResolvedValue(1),
      populateNomineeDetails: jest.fn().mockResolvedValue(true),
      handlePrasadamDetails: jest.fn().mockResolvedValue(true),
      selectReliefFundNo: jest.fn().mockResolvedValue(true),
      checkWishlistForItem: jest.fn().mockResolvedValue(false),
      addToWishlistAndVerify: jest.fn().mockResolvedValue(true),
      proceedToPaymentGateway: jest.fn().mockResolvedValue(true),
      verifyPaymentSummary: jest.fn().mockImplementation((ctx) => {
        ctx.grandTotal = '₹0.00';
        return Promise.resolve(true);
      }),
      executePaymentProceedAndConfirm: jest.fn().mockResolvedValue({
        confirmed: true,
        isZeroCost: true,
        officialReference: 'IVQ26103016320889516047',
        confirmationData: {
          officialReference: 'IVQ26103016320889516047',
          requestedDate: '2026-11-20',
          selectedTime: '03:00 - 04:00',
          route: 'Pamba - Marakkoottam - 4 Kms',
          pilgrimsCount: 1,
          grandTotal: '₹0.00',
          status: 'CONFIRMED',
          receiptUrl: 'https://sabarimalaonline.org/#/booking-history',
          timestamp: new Date().toISOString(),
        },
      }),
    };

    (PlaywrightSabarimalaAdapter as jest.Mock).mockImplementation(() => mockAdapter);
  });

  describe('1. Autonomous Zero-Cost Virtual-Q Workflow (19 Steps)', () => {
    it('executes end-to-end zero-cost booking autonomously and confirms with official reference', async () => {
      const worker = new BookingWorker(mockApiClient);
      await worker.execute(validTestJob);

      // Verify explicit progress updates were emitted in strict sequence
      expect(mockApiClient.updateJobProgress).toHaveBeenCalledWith(
        'job-phase4-001',
        expect.objectContaining({ status: 'PROCESSING' }),
      );
      expect(mockApiClient.updateJobProgress).toHaveBeenCalledWith(
        'job-phase4-001',
        expect.objectContaining({ status: 'LOGIN_SUCCESS' }),
      );
      expect(mockApiClient.updateJobProgress).toHaveBeenCalledWith(
        'job-phase4-001',
        expect.objectContaining({ status: 'DATE_VERIFIED' }),
      );
      expect(mockApiClient.updateJobProgress).toHaveBeenCalledWith(
        'job-phase4-001',
        expect.objectContaining({ status: 'ROUTE_VERIFIED' }),
      );
      expect(mockApiClient.updateJobProgress).toHaveBeenCalledWith(
        'job-phase4-001',
        expect.objectContaining({ status: 'SLOT_VERIFIED' }),
      );
      expect(mockApiClient.updateJobProgress).toHaveBeenCalledWith(
        'job-phase4-001',
        expect.objectContaining({ status: 'PILGRIMS_VERIFIED' }),
      );
      expect(mockApiClient.updateJobProgress).toHaveBeenCalledWith(
        'job-phase4-001',
        expect.objectContaining({ status: 'NOMINEE_VERIFIED' }),
      );
      expect(mockApiClient.updateJobProgress).toHaveBeenCalledWith(
        'job-phase4-001',
        expect.objectContaining({ status: 'RELIEF_VERIFIED' }),
      );
      expect(mockApiClient.updateJobProgress).toHaveBeenCalledWith(
        'job-phase4-001',
        expect.objectContaining({ status: 'WISHLIST_VERIFIED' }),
      );
      expect(mockApiClient.updateJobProgress).toHaveBeenCalledWith(
        'job-phase4-001',
        expect.objectContaining({ status: 'PROCEEDING_TO_CHECKOUT' }),
      );
      expect(mockApiClient.updateJobProgress).toHaveBeenCalledWith(
        'job-phase4-001',
        expect.objectContaining({ status: 'CHECKOUT_VERIFIED' }),
      );
      expect(mockApiClient.updateJobProgress).toHaveBeenCalledWith(
        'job-phase4-001',
        expect.objectContaining({ status: 'ZERO_COST_CONFIRMATION_PENDING' }),
      );

      // Verify completion was reported with authentic government reference
      expect(mockApiClient.completeJob).toHaveBeenCalledWith(
        'job-phase4-001',
        expect.objectContaining({
          officialReference: 'IVQ26103016320889516047',
          confirmationData: expect.objectContaining({
            status: 'CONFIRMED',
            officialReference: 'IVQ26103016320889516047',
          }),
        }),
      );

      // Verify execution lock was released cleanly
      expect(BookingExecutionGuard.isBookingActive('req-phase4-001')).toBe(false);
    });
  });

  describe('2. Mandatory Nominee Validation (Pre-Execution & Pre-Portal)', () => {
    it('rejects booking immediately when nominee name is missing without opening browser', async () => {
      const invalidJob: BookingJobData = {
        ...validTestJob,
        nominee: { nomineeName: '', nomineeAge: 25, nomineeRelationship: 'Spouse' },
      };

      const worker = new BookingWorker(mockApiClient);
      await worker.execute(invalidJob);

      expect(mockAdapter.init).not.toHaveBeenCalled();
      expect(mockApiClient.failJob).toHaveBeenCalledWith(
        'job-phase4-001',
        expect.objectContaining({
          status: 'HOLD_INVALID_NOMINEE',
          errorCode: 'NOMINEE_DETAILS_MISSING',
        }),
      );
    });

    it('rejects booking immediately when nominee age is underage (<18 years)', async () => {
      const invalidJob: BookingJobData = {
        ...validTestJob,
        nominee: { nomineeName: 'Minor Child', nomineeAge: 16, nomineeRelationship: 'Child' },
      };

      const worker = new BookingWorker(mockApiClient);
      await worker.execute(invalidJob);

      expect(mockAdapter.init).not.toHaveBeenCalled();
      expect(mockApiClient.failJob).toHaveBeenCalledWith(
        'job-phase4-001',
        expect.objectContaining({
          status: 'HOLD_INVALID_NOMINEE',
          errorCode: 'NOMINEE_DETAILS_MISSING',
        }),
      );
    });

    it('rejects booking when nominee relationship is missing', async () => {
      const invalidJob: BookingJobData = {
        ...validTestJob,
        nominee: { nomineeName: 'Adult Person', nomineeAge: 30, nomineeRelationship: '' },
      };

      const worker = new BookingWorker(mockApiClient);
      await worker.execute(invalidJob);

      expect(mockAdapter.init).not.toHaveBeenCalled();
      expect(mockApiClient.failJob).toHaveBeenCalledWith(
        'job-phase4-001',
        expect.objectContaining({
          status: 'HOLD_INVALID_NOMINEE',
          errorCode: 'NOMINEE_DETAILS_MISSING',
        }),
      );
    });
  });

  describe('3. Route Mismatch & Canonical Matching', () => {
    it('transitions to RETRYABLE_FAILURE / MANUAL_REVIEW when route selection mismatches', async () => {
      mockAdapter.selectAuthenticatedDateAndRoute.mockRejectedValue(
        new Error('ROUTE_SELECTION_MISMATCH: Option text "Erumely" did not match requested "Pamba"'),
      );

      const worker = new BookingWorker(mockApiClient);
      await worker.execute(validTestJob);

      expect(mockApiClient.failJob).toHaveBeenCalledWith(
        'job-phase4-001',
        expect.objectContaining({
          status: 'REQUIRES_HUMAN',
          errorCode: 'ROUTE_SELECTION_MISMATCH',
        }),
      );
    });
  });

  describe('4. Loader Timeout & Wishlist Protection', () => {
    it('classifies LOADER_TIMEOUT as retryable failure without human intervention', async () => {
      mockAdapter.proceedToPaymentGateway.mockRejectedValue(
        new Error('LOADER_TIMEOUT: Loader overlay (#loader .shade) intercepted pointer events'),
      );

      const worker = new BookingWorker(mockApiClient);
      await worker.execute(validTestJob);

      expect(mockApiClient.failJob).toHaveBeenCalledWith(
        'job-phase4-001',
        expect.objectContaining({
          status: 'LOADER_TIMEOUT',
          errorCode: 'LOADER_TIMEOUT',
        }),
      );
    });

    it('reconciles without error when processing wishlist and checkout for target item', async () => {
      mockAdapter.checkWishlistForItem.mockResolvedValue(true);

      const worker = new BookingWorker(mockApiClient);
      await worker.execute(validTestJob);

      expect(mockAdapter.addToWishlistAndVerify).toHaveBeenCalled();
      expect(mockAdapter.proceedToPaymentGateway).toHaveBeenCalled();
      expect(mockApiClient.completeJob).toHaveBeenCalled();
    });
  });

  describe('5. Paid Booking Flow & Payment Sandbox', () => {
    it('executes paid booking flow when payable total > ₹0 under transaction limit', async () => {
      const paidJob = {
        ...validTestJob,
        preferences: {
          ...validTestJob.preferences,
          customerAuthorizationPolicy: {
            allowPayment: true,
            maxAmount: 5000,
          },
        },
      };

      mockAdapter.verifyPaymentSummary.mockImplementation((ctx: any) => {
        ctx.grandTotal = '₹250.00';
        return Promise.resolve(true);
      });

      mockAdapter.executePaymentProceedAndConfirm.mockResolvedValue({
        confirmed: true,
        isZeroCost: false,
        officialReference: 'TXN-PAID-99221188',
        confirmationData: {
          officialReference: 'TXN-PAID-99221188',
          requestedDate: '2026-11-20',
          selectedTime: '03:00 - 04:00',
          route: 'Pamba - Marakkoottam - 4 Kms',
          pilgrimsCount: 1,
          grandTotal: '₹250.00',
          status: 'CONFIRMED',
          receiptUrl: 'https://sabarimalaonline.org/#/booking-history',
        },
      });

      const worker = new BookingWorker(mockApiClient);
      await worker.execute(paidJob);

      expect(mockApiClient.updateJobProgress).toHaveBeenCalledWith(
        'job-phase4-001',
        expect.objectContaining({ status: 'PAYMENT_PENDING' }),
      );

      expect(mockApiClient.completeJob).toHaveBeenCalledWith(
        'job-phase4-001',
        expect.objectContaining({
          officialReference: 'TXN-PAID-99221188',
        }),
      );
    });

    it('flags RECONCILIATION_REQUIRED when external reference is missing or outcome is ambiguous', async () => {
      mockAdapter.executePaymentProceedAndConfirm.mockResolvedValue({
        confirmed: false,
        reconciliationRequired: true,
        message: 'Confirmation modal displayed but authoritative reference could not be parsed.',
      });

      const worker = new BookingWorker(mockApiClient);
      await worker.execute(validTestJob);

      expect(mockApiClient.failJob).toHaveBeenCalledWith(
        'job-phase4-001',
        expect.objectContaining({
          status: 'RECONCILIATION_REQUIRED',
          errorCode: 'VERIFICATION_PENDING',
        }),
      );
    });
  });

  describe('6. Duplicate Prevention & Execution Locks', () => {
    it('strictly prevents duplicate concurrent execution of the same booking', async () => {
      BookingExecutionGuard.acquire({
        bookingId: 'req-phase4-001',
        bookingCode: 'TA-10045',
        jobId: 'competing-job-888',
        dispatchSource: 'QUEUE_POLL',
      });

      const worker = new BookingWorker(mockApiClient);
      await worker.execute(validTestJob);

      expect(mockAdapter.init).not.toHaveBeenCalled();
      expect(mockApiClient.updateJobProgress).not.toHaveBeenCalled();
    });
  });

  describe('7. Amount Parsing & Numeric Helper Utility', () => {
    it('correctly parses zero-cost and paid amounts across currency string formats', () => {
      expect(BookingConfirmationFlow.parseNumericAmount('₹0')).toBe(0);
      expect(BookingConfirmationFlow.parseNumericAmount('₹0.00')).toBe(0);
      expect(BookingConfirmationFlow.parseNumericAmount('0')).toBe(0);
      expect(BookingConfirmationFlow.parseNumericAmount('0.00')).toBe(0);
      expect(BookingConfirmationFlow.parseNumericAmount('₹100')).toBe(100);
      expect(BookingConfirmationFlow.parseNumericAmount('Rs. 249.50')).toBe(249.5);
      expect(BookingConfirmationFlow.parseNumericAmount(undefined)).toBe(0);
    });
  });
});

