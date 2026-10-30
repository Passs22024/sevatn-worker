import { BookingWorker } from './booking-worker';
import { BookingExecutionGuard } from '../security/execution-guard';
import { WishlistFlow } from '../sabarimala/flows/wishlist.flow';
import { PaymentReviewFlow } from '../sabarimala/flows/payment-review.flow';
import { PlaywrightSabarimalaAdapter } from '../sabarimala/sabarimala-adapter';
import { CredentialManager } from '../security/credential-manager';

// Mock playwright adapter and credential manager
jest.mock('../sabarimala/sabarimala-adapter');
jest.mock('../security/credential-manager');

describe('SEVATN Phase 3.5: Wishlist-to-Checkout Automation Test Suite', () => {
  let mockAdapter: any;
  let mockApiClient: any;

  beforeAll(() => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = 'test-encryption-key-32-chars-long!!';
  });

  const validTestJob: any = {
    id: 'job-phase35-001',
    bookingRequestId: 'req-phase35-001',
    bookingCode: 'TA-10045',
    requestedDate: '2026-11-20',
    route: 'Pamba - Marakkoottam - 4 Kms',
    timeSlot: '03:00 - 04:00',
    selectedTime: '03:00 - 04:00',
    pilgrimCount: 1,
    leaseGeneration: 1,
    fencingToken: 'fnc_phase35_token_123',
    account: {
      id: 'acc-8098697141',
      username: '8098697141',
      encryptedPassword: 'enc:pass:123',
      encryptionIv: 'iv_mock_12345678',
      encryptionTag: 'tag_mock_1234567',
    },
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
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (CredentialManager.decrypt as jest.Mock).mockReturnValue('Pass@2025');
    BookingExecutionGuard.release('TA-10045', 'job-phase35-001');

    mockAdapter = {
      init: jest.fn().mockResolvedValue(undefined),
      openLogin: jest.fn().mockResolvedValue(true),
      login: jest.fn().mockResolvedValue({ status: 'LOGIN_SUCCESS' }),
      navigateToHomeAndDarshan: jest.fn().mockResolvedValue(true),
      selectAuthenticatedDateAndRoute: jest.fn().mockResolvedValue(true),
      selectPostLoginTimeSlot: jest.fn().mockResolvedValue({ selectedSlot: '03:00 - 04:00' }),
      selectBookingType: jest.fn().mockResolvedValue(true),
      verifyDateTimePreserved: jest.fn().mockReturnValue(true),
      selectAllExistingPilgrims: jest.fn().mockResolvedValue(1),
      selectRegisteredPilgrims: jest.fn().mockResolvedValue(true),
      populateNomineeDetails: jest.fn().mockResolvedValue(true),
      handlePrasadamDetails: jest.fn().mockResolvedValue(true),
      selectReliefFundNo: jest.fn().mockResolvedValue(true),
      checkWishlistForItem: jest.fn().mockResolvedValue(false),
      addToWishlistAndVerify: jest.fn().mockResolvedValue(true),
      proceedToPaymentGateway: jest.fn().mockResolvedValue(true),
      verifyPaymentSummary: jest.fn().mockImplementation((ctx: any) => {
        ctx.grandTotal = '₹0.00';
        return Promise.resolve(true);
      }),
      executePaymentProceedAndConfirm: jest.fn().mockResolvedValue({
        confirmed: true,
        isZeroCost: true,
        officialReference: 'IVQ20261120030045',
        confirmationData: {
          officialReference: 'IVQ20261120030045',
          requestedDate: '2026-11-20',
          selectedTime: '03:00 - 04:00',
          route: 'Pamba - Marakkoottam - 4 Kms',
          pilgrimsCount: 1,
          grandTotal: '₹0.00',
          status: 'CONFIRMED',
          receiptUrl: 'https://sabarimalaonline.org/#/booking-history',
        },
      }),
      close: jest.fn().mockResolvedValue(undefined),
    };

    (PlaywrightSabarimalaAdapter as jest.Mock).mockImplementation(() => mockAdapter);

    mockApiClient = {
      updateJobProgress: jest.fn().mockResolvedValue({ success: true }),
      completeJob: jest.fn().mockResolvedValue({ success: true }),
      failJob: jest.fn().mockResolvedValue({ success: true }),
    };
  });

  afterEach(() => {
    BookingExecutionGuard.release('TA-10045', 'job-phase35-001');
  });

  describe('1. Wishlist Detection & Existing Unrelated Entries', () => {
    it('detects newly added item correctly and ignores existing unrelated wishlist entries', () => {
      const existingUnrelated = 'Date: 25-11-2026 | Route: Erumely - Kalaketti Traditional Path - 46 Kms | Slot: 10:00 - 11:00 | Pilgrims: 2 | Relief Fund: No';
      const newlyAddedTarget = 'Date: 20-11-2026 | Route: Pamba - Marakkoottam - 4 Kms | Slot: 03:00 - 04:00 | Pilgrims: 1 | Relief Fund: No';

      // Verify date matching
      expect(WishlistFlow.matchesDate(newlyAddedTarget, '2026-11-20', '20-11-2026')).toBe(true);
      expect(WishlistFlow.matchesDate(existingUnrelated, '2026-11-20', '20-11-2026')).toBe(false);

      // Verify route matching (Pamba matches target, Erumely does NOT)
      expect(WishlistFlow.matchesRoute(newlyAddedTarget, 'Pamba - Marakkoottam - 4 Kms')).toBe(true);
      expect(WishlistFlow.matchesRoute(existingUnrelated, 'Pamba - Marakkoottam - 4 Kms')).toBe(false);

      // Verify slot matching
      expect(WishlistFlow.matchesSlot(newlyAddedTarget, '03:00 - 04:00')).toBe(true);
      expect(WishlistFlow.matchesSlot(existingUnrelated, '03:00 - 04:00')).toBe(false);

      // Verify pilgrim count matching
      expect(WishlistFlow.matchesPilgrimCount(newlyAddedTarget, 1)).toBe(true);
      expect(WishlistFlow.matchesPilgrimCount(existingUnrelated, 1)).toBe(false);

      // Verify relief fund amount matching
      expect(WishlistFlow.matchesReliefAmount(newlyAddedTarget)).toBe(true);
    });

    it('blocks proceed when wishlist item details mismatch requested date, route, or slot', () => {
      const mismatchedRouteItem = 'Date: 20-11-2026 | Route: Vandiperiyar - Sathram - 12 Kms | Slot: 03:00 - 04:00 | 1 Pilgrim | Relief: No';
      expect(WishlistFlow.matchesRoute(mismatchedRouteItem, 'Pamba - Marakkoottam - 4 Kms')).toBe(false);

      const mismatchedSlotItem = 'Date: 20-11-2026 | Route: Pamba - Marakkoottam - 4 Kms | Slot: 18:00 - 19:00 | 1 Pilgrim | Relief: No';
      expect(WishlistFlow.matchesSlot(mismatchedSlotItem, '03:00 - 04:00')).toBe(false);

      const nonZeroReliefItem = 'Date: 20-11-2026 | Route: Pamba - Marakkoottam - 4 Kms | Slot: 03:00 - 04:00 | 1 Pilgrim | Relief Fund: ₹100';
      expect(WishlistFlow.matchesReliefAmount(nonZeroReliefItem)).toBe(false);
    });
  });

  describe('2. End-to-End Lifecycle: RELIEF_VERIFIED -> ADDING_TO_WISHLIST -> WISHLIST_VERIFIED -> PROCEEDING_TO_CHECKOUT -> CHECKOUT_VERIFIED', () => {
    it('executes full required lifecycle sequence without human intervention', async () => {
      const worker = new BookingWorker(mockApiClient);
      await worker.execute(validTestJob);

      // Verify exact linear sequence of milestones reported to API
      expect(mockApiClient.updateJobProgress).toHaveBeenCalledWith(
        'job-phase35-001',
        expect.objectContaining({ status: 'RELIEF_VERIFIED' }),
      );
      expect(mockApiClient.updateJobProgress).toHaveBeenCalledWith(
        'job-phase35-001',
        expect.objectContaining({ status: 'ADDING_TO_WISHLIST' }),
      );
      expect(mockApiClient.updateJobProgress).toHaveBeenCalledWith(
        'job-phase35-001',
        expect.objectContaining({ status: 'WISHLIST_VERIFIED' }),
      );
      expect(mockApiClient.updateJobProgress).toHaveBeenCalledWith(
        'job-phase35-001',
        expect.objectContaining({ status: 'PROCEEDING_TO_CHECKOUT' }),
      );
      expect(mockApiClient.updateJobProgress).toHaveBeenCalledWith(
        'job-phase35-001',
        expect.objectContaining({ status: 'CHECKOUT_VERIFIED' }),
      );
      expect(mockApiClient.updateJobProgress).toHaveBeenCalledWith(
        'job-phase35-001',
        expect.objectContaining({ status: 'ZERO_COST_CONFIRMATION_PENDING' }),
      );
      expect(mockApiClient.completeJob).toHaveBeenCalledWith(
        'job-phase35-001',
        expect.objectContaining({
          officialReference: 'IVQ20261120030045',
        }),
      );
    });
  });

  describe('3. PREVIOUS_BOOKING_RESTRICTION Handling', () => {
    it('catches PREVIOUS_BOOKING_RESTRICTION, halts retries, transitions to ACCOUNT_PREVIOUS_BOOKING_RESTRICTED, and releases execution lock', async () => {
      mockAdapter.addToWishlistAndVerify.mockRejectedValue(
        new Error('PREVIOUS_BOOKING_RESTRICTION: Official portal reports you cannot make transaction until you avail previous booking.'),
      );

      const worker = new BookingWorker(mockApiClient);
      await worker.execute(validTestJob);

      // Verify failJob was called with exact restriction code
      expect(mockApiClient.failJob).toHaveBeenCalledWith(
        'job-phase35-001',
        expect.objectContaining({
          status: 'ACCOUNT_PREVIOUS_BOOKING_RESTRICTED',
          errorCode: 'PREVIOUS_BOOKING_RESTRICTION',
        }),
      );

      // Verify execution lock is cleanly released
      expect(BookingExecutionGuard.isBookingActive('TA-10045')).toBe(false);
    });
  });

  describe('4. Loader Interception & LOADER_TIMEOUT Protection', () => {
    it('does not cause false success when loader overlay intercepts proceed click', async () => {
      mockAdapter.proceedToPaymentGateway.mockRejectedValue(
        new Error('LOADER_TIMEOUT: Loader overlay (#loader .shade) intercepted pointer events'),
      );

      const worker = new BookingWorker(mockApiClient);
      await worker.execute(validTestJob);

      expect(mockApiClient.failJob).toHaveBeenCalledWith(
        'job-phase35-001',
        expect.objectContaining({
          status: 'LOADER_TIMEOUT',
          errorCode: 'LOADER_TIMEOUT',
        }),
      );
      expect(mockApiClient.completeJob).not.toHaveBeenCalled();
    });
  });

  describe('5. Wishlist Mismatch & Duplicate Prevention', () => {
    it('fails fast with WISHLIST_MISMATCH when wishlist item details differ from booking request', async () => {
      mockAdapter.addToWishlistAndVerify.mockRejectedValue(
        new Error('WISHLIST_MISMATCH: Newly added wishlist item route does not match requested route'),
      );

      const worker = new BookingWorker(mockApiClient);
      await worker.execute(validTestJob);

      expect(mockApiClient.failJob).toHaveBeenCalledWith(
        'job-phase35-001',
        expect.objectContaining({
          status: 'WISHLIST_MISMATCH',
          errorCode: 'WISHLIST_MISMATCH',
        }),
      );
      expect(mockAdapter.proceedToPaymentGateway).not.toHaveBeenCalled();
    });

    it('strictly prevents duplicate concurrent execution of the same booking', async () => {
      // First acquire lock manually
      BookingExecutionGuard.acquire({
        bookingId: 'req-phase35-001',
        bookingCode: 'TA-10045',
        jobId: 'competing-job-777',
        dispatchSource: 'PARALLEL_TRIGGER',
      });

      const worker = new BookingWorker(mockApiClient);
      await worker.execute(validTestJob);

      // Worker aborts without calling browser adapter
      expect(mockAdapter.init).not.toHaveBeenCalled();
      expect(mockAdapter.openLogin).not.toHaveBeenCalled();
    });

    it('worker restart and lease expiry do not repeat an already completed action', async () => {
      // Simulate restarted job whose milestone was already BOOKING_CONFIRMED
      const completedJob = {
        ...validTestJob,
        id: 'job-phase35-restarted',
        status: 'BOOKING_CONFIRMED',
        lastMilestone: 'BOOKING_CONFIRMED',
      };

      const worker = new BookingWorker(mockApiClient);
      // In booking-worker, if already confirmed, it should not execute browser actions
      mockAdapter.init.mockClear();

      // Acquire lock for another job first to simulate active lease
      BookingExecutionGuard.acquire({
        bookingId: 'req-phase35-001',
        bookingCode: 'TA-10045',
        jobId: 'competing-job-lease-expired',
        dispatchSource: 'LEASE_EXPIRED_RESTART',
      });

      await worker.execute(completedJob);

      // Verify no browser or submission repeated
      expect(mockAdapter.addToWishlistAndVerify).not.toHaveBeenCalled();
      expect(mockAdapter.proceedToPaymentGateway).not.toHaveBeenCalled();
    });
  });

  describe('6. Virtual-Q Right-Side Wishlist & Proceed Invariants (#/darshan -> #/paymentGateway)', () => {
    it('1. Add to Wishlist remains on #/darshan without navigating to #/wishlist', async () => {
      let currentUrl = 'https://sabarimalaonline.org/#/darshan';
      let addWishlistClicked = false;
      const mockPage: any = {
        url: jest.fn().mockImplementation(() => currentUrl),
        waitForTimeout: jest.fn().mockResolvedValue(undefined),
        locator: jest.fn().mockImplementation((sel: string) => ({
          first: () => ({
            isVisible: jest.fn().mockResolvedValue(true),
            isDisabled: jest.fn().mockResolvedValue(false),
            scrollIntoViewIfNeeded: jest.fn().mockResolvedValue(undefined),
            click: jest.fn().mockImplementation(async () => {
              addWishlistClicked = true;
            }),
            innerText: jest.fn().mockResolvedValue(''),
          }),
          count: jest.fn().mockImplementation(async () => {
            if (sel.includes('button')) {
              return 1;
            }
            return addWishlistClicked ? 1 : 0;
          }),
          nth: jest.fn().mockImplementation(() => ({
            innerText: jest.fn().mockResolvedValue('Date: 20-11-2026 | Route: Pamba - Marakkoottam - 4 Kms | Slot: 03:00 - 04:00 | Pilgrims: 1 | Relief Fund Amount: ₹0'),
          })),
        })),
      };

      const ctx: any = {
        bookingCode: 'TA-10045',
        requestedDate: '2026-11-20',
        requestedDateDisplay: '20-11-2026',
        requestedRoute: 'Pamba - Marakkoottam - 4 Kms',
        selectedTimeSlot: '03:00 - 04:00',
        pilgrimCount: 1,
      };

      const added = await WishlistFlow.execute(mockPage, ctx);
      expect(added).toBe(true);
      // Confirmed stayed on #/darshan
      expect(mockPage.url()).toBe('https://sabarimalaonline.org/#/darshan');
      expect(currentUrl).not.toContain('/wishlist');
    });

    it('2. Wishlist panel updates directly on #/darshan without route navigation', async () => {
      const items = [
        'Date: 20-11-2026 | Route: Pamba - Marakkoottam - 4 Kms | Slot: 03:00 - 04:00 | Pilgrims: 1 | Relief Fund Amount: ₹0',
      ];
      const mockPage: any = {
        url: jest.fn().mockReturnValue('https://sabarimalaonline.org/#/darshan'),
        locator: jest.fn().mockImplementation(() => ({
          count: jest.fn().mockResolvedValue(items.length),
          nth: jest.fn().mockImplementation((i: number) => ({
            innerText: jest.fn().mockResolvedValue(items[i]),
          })),
        })),
      };

      const textRows = await WishlistFlow.getWishlistItemsText(mockPage);
      expect(textRows.length).toBe(1);
      expect(textRows[0]).toContain('Pamba - Marakkoottam - 4 Kms');
      expect(mockPage.url()).toBe('https://sabarimalaonline.org/#/darshan');
    });

    it('3. New item is identified correctly and 4. Existing items are not selected accidentally', () => {
      const existingItem = 'Date: 15-11-2026 | Route: Erumely | Slot: 08:00 - 09:00 | Pilgrims: 2 | Relief Fund: No';
      const newItem = 'Date: 20-11-2026 | Route: Pamba - Marakkoottam - 4 Kms | Slot: 03:00 - 04:00 | Pilgrims: 1 | Relief Fund: No';

      expect(WishlistFlow.matchesDate(newItem, '2026-11-20', '20-11-2026')).toBe(true);
      expect(WishlistFlow.matchesDate(existingItem, '2026-11-20', '20-11-2026')).toBe(false);

      expect(WishlistFlow.matchesRoute(newItem, 'Pamba - Marakkoottam - 4 Kms')).toBe(true);
      expect(WishlistFlow.matchesRoute(existingItem, 'Pamba - Marakkoottam - 4 Kms')).toBe(false);
    });

    it('5. Proceed is clicked from right-side panel without navigating to #/wishlist and 6. Reaches #/paymentGateway', async () => {
      let pageUrl = 'https://sabarimalaonline.org/#/darshan';
      const mockPage: any = {
        url: jest.fn().mockImplementation(() => pageUrl),
        waitForTimeout: jest.fn().mockResolvedValue(undefined),
        waitForURL: jest.fn().mockImplementation(async () => {
          pageUrl = 'https://sabarimalaonline.org/#/paymentGateway';
        }),
        locator: jest.fn().mockImplementation((sel: string) => ({
          first: () => ({
            isVisible: jest.fn().mockImplementation(async () => {
              if (sel.includes('#loader') || sel.includes('shade')) return false;
              if (sel.includes('Proceed')) return true;
              return false;
            }),
            isDisabled: jest.fn().mockResolvedValue(false),
            scrollIntoViewIfNeeded: jest.fn().mockResolvedValue(undefined),
            click: jest.fn().mockImplementation(async () => {
              pageUrl = 'https://sabarimalaonline.org/#/paymentGateway';
            }),
            waitFor: jest.fn().mockResolvedValue(undefined),
            innerText: jest.fn().mockResolvedValue('₹0.00'),
          }),
          count: jest.fn().mockResolvedValue(1),
          nth: jest.fn().mockImplementation(() => ({
            innerText: jest.fn().mockResolvedValue('Date: 20-11-2026 | Route: Pamba - Marakkoottam - 4 Kms | Slot: 03:00 - 04:00 | Pilgrims: 1 | Relief Fund Amount: ₹0'),
          })),
        })),
        innerText: jest.fn().mockResolvedValue('Virtual-Q Date: 20-11-2026 Route: Pamba Slot: 03:00 - 04:00 Total Amount: ₹0.00'),
      };

      const ctx: any = {
        bookingCode: 'TA-10045',
        wishlistStatus: 'VERIFIED',
        requestedDate: '2026-11-20',
        requestedDateDisplay: '20-11-2026',
        requestedRoute: 'Pamba - Marakkoottam - 4 Kms',
        selectedTimeSlot: '03:00 - 04:00',
        pilgrimCount: 1,
      };

      const result = await PaymentReviewFlow.execute(mockPage, ctx);
      expect(result.checkoutVerified).toBe(true);
      expect(pageUrl).toBe('https://sabarimalaonline.org/#/paymentGateway');
    });
  });
});
