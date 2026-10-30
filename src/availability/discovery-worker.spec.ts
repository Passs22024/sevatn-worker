import { AvailabilityDiscoveryWorker } from './discovery-worker';
import { ApiClient } from '../api/client';
import { PlaywrightSabarimalaAdapter } from '../sabarimala/sabarimala-adapter';

jest.mock('../sabarimala/sabarimala-adapter');

describe('AvailabilityDiscoveryWorker Pre-Login Date-Only Discovery Suite', () => {
  let mockApiClient: jest.Mocked<ApiClient>;
  let mockAdapter: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockApiClient = {
      getDemandDates: jest.fn().mockResolvedValue([
        { date: '2026-10-20', route: 'Pamba - Marakkoottam - 4 Kms', pendingCount: 1 },
      ]),
      publishBulkAvailability: jest.fn().mockResolvedValue([
        { matched: true, bookingId: 'b-001', bookingCode: 'TA-2026-001', message: 'Matched' },
      ]),
    } as any;

    mockAdapter = {
      init: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
      openDarshanAvailability: jest.fn().mockResolvedValue({
        success: true,
        url: 'https://sabarimalaonline.org/#/darshanAvailability',
      }),
      checkRequestedDateAvailability: jest.fn().mockResolvedValue({
        available: true,
        state: 'AVAILABLE',
      }),
      selectRequestedDate: jest.fn().mockResolvedValue({
        success: true,
        selectedDate: '2026-10-20',
      }),
      selectRoute: jest.fn().mockResolvedValue({
        success: true,
        selectedRoute: 'Pamba - Marakkoottam - 4 Kms',
      }),
      discoverAvailableSlots: jest.fn(),
      selectAvailableTimeSlot: jest.fn(),
    };

    (PlaywrightSabarimalaAdapter as jest.Mock).mockImplementation(() => mockAdapter);
  });

  it('1. Available Date: checks date, selects date & route, publishes date/route event without querying time slots', async () => {
    const discoveryWorker = new AvailabilityDiscoveryWorker(mockApiClient);
    await discoveryWorker.runDiscoveryPass();

    // 1. Must open darshanAvailability
    expect(mockAdapter.openDarshanAvailability).toHaveBeenCalled();

    // 2. Must check calendar for requested date
    expect(mockAdapter.checkRequestedDateAvailability).toHaveBeenCalledWith('2026-10-20');

    // 3. Must select and verify date
    expect(mockAdapter.selectRequestedDate).toHaveBeenCalledWith('2026-10-20');

    // 4. Must select and verify route
    expect(mockAdapter.selectRoute).toHaveBeenCalledWith('Pamba - Marakkoottam - 4 Kms');

    // 5. CRITICAL: Must NOT query or inspect time slots pre-login
    expect(mockAdapter.discoverAvailableSlots).not.toHaveBeenCalled();
    expect(mockAdapter.selectAvailableTimeSlot).not.toHaveBeenCalled();

    // 6. Must publish date-and-route event without fabricating any time slots
    expect(mockApiClient.publishBulkAvailability).toHaveBeenCalledWith([
      expect.objectContaining({
        date: '2026-10-20',
        route: 'Pamba - Marakkoottam - 4 Kms',
      }),
    ]);

    const publishedEvent = mockApiClient.publishBulkAvailability.mock.calls[0][0][0];
    expect((publishedEvent as any).timeSlot).toBeUndefined();
  });

  it('2. Unavailable Date: does not publish an event and leaves request pending', async () => {
    mockAdapter.checkRequestedDateAvailability.mockResolvedValue({
      available: false,
      state: 'DISABLED',
      message: 'Date full',
    });

    const discoveryWorker = new AvailabilityDiscoveryWorker(mockApiClient);
    await discoveryWorker.runDiscoveryPass();

    expect(mockAdapter.checkRequestedDateAvailability).toHaveBeenCalledWith('2026-10-20');

    // Must NOT select date or route
    expect(mockAdapter.selectRequestedDate).not.toHaveBeenCalled();
    expect(mockAdapter.selectRoute).not.toHaveBeenCalled();

    // Must NOT query time slots
    expect(mockAdapter.discoverAvailableSlots).not.toHaveBeenCalled();

    // Must NOT publish any availability events
    expect(mockApiClient.publishBulkAvailability).not.toHaveBeenCalled();
  });

  it('3. Idle Demand: exits cleanly when there are no pending bookings', async () => {
    mockApiClient.getDemandDates.mockResolvedValue([]);

    const discoveryWorker = new AvailabilityDiscoveryWorker(mockApiClient);
    await discoveryWorker.runDiscoveryPass();

    // Should not initialize browser if there are no demand dates
    expect(mockAdapter.init).not.toHaveBeenCalled();
    expect(mockApiClient.publishBulkAvailability).not.toHaveBeenCalled();
  });

  it('4. Matcher Acceptance & Outcome: processes matcher response and logs job creation outcome', async () => {
    mockApiClient.publishBulkAvailability.mockResolvedValue([
      {
        matched: true,
        bookingId: 'book-999',
        bookingCode: 'TA-999',
        message: 'Successfully matched Booking #TA-999 to 2026-10-20 / Pamba',
      },
    ]);

    const discoveryWorker = new AvailabilityDiscoveryWorker(mockApiClient);
    await discoveryWorker.runDiscoveryPass();

    expect(mockApiClient.publishBulkAvailability).toHaveBeenCalled();
    // Verifies browser cleanup is performed
    expect(mockAdapter.close).toHaveBeenCalled();
  });

  it('5. Missing or Unselectable Date: handles selection exception safely without publishing', async () => {
    mockAdapter.checkRequestedDateAvailability.mockResolvedValue({
      available: true,
      state: 'AVAILABLE',
    });
    mockAdapter.selectRequestedDate.mockRejectedValue(new Error('Date cell missing or not clickable'));

    const discoveryWorker = new AvailabilityDiscoveryWorker(mockApiClient);
    await discoveryWorker.runDiscoveryPass();

    expect(mockAdapter.selectRequestedDate).toHaveBeenCalledWith('2026-10-20');
    expect(mockAdapter.selectRoute).not.toHaveBeenCalled();
    expect(mockApiClient.publishBulkAvailability).not.toHaveBeenCalled();
    expect(mockAdapter.close).toHaveBeenCalled();
  });

  it('6. Route Selection Failure: handles route failure safely without publishing', async () => {
    mockAdapter.checkRequestedDateAvailability.mockResolvedValue({
      available: true,
      state: 'AVAILABLE',
    });
    mockAdapter.selectRoute.mockRejectedValue(new Error('Route dropdown missing'));

    const discoveryWorker = new AvailabilityDiscoveryWorker(mockApiClient);
    await discoveryWorker.runDiscoveryPass();

    expect(mockAdapter.selectRequestedDate).toHaveBeenCalledWith('2026-10-20');
    expect(mockAdapter.selectRoute).toHaveBeenCalledWith('Pamba - Marakkoottam - 4 Kms');
    expect(mockApiClient.publishBulkAvailability).not.toHaveBeenCalled();
    expect(mockAdapter.close).toHaveBeenCalled();
  });

  it('7. Multiple Demand Dates: publishes only verified dates and skips unavailable ones', async () => {
    mockApiClient.getDemandDates.mockResolvedValue([
      { date: '2026-10-20', route: 'Pamba - Marakkoottam - 4 Kms', pendingCount: 1 },
      { date: '2026-10-25', route: 'Erumeli Route', pendingCount: 2 },
    ]);

    mockAdapter.checkRequestedDateAvailability.mockImplementation(async (date: string) => {
      if (date === '2026-10-20') return { available: true, state: 'AVAILABLE' };
      return { available: false, state: 'DISABLED' };
    });

    const discoveryWorker = new AvailabilityDiscoveryWorker(mockApiClient);
    await discoveryWorker.runDiscoveryPass();

    expect(mockApiClient.publishBulkAvailability).toHaveBeenCalledTimes(1);
    const publishedList = mockApiClient.publishBulkAvailability.mock.calls[0][0];
    expect(publishedList).toHaveLength(1);
    expect(publishedList[0].date).toBe('2026-10-20');
    expect(publishedList[0].timeSlot).toBeUndefined();
    expect(mockAdapter.close).toHaveBeenCalled();
  });
});

