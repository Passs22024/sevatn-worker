import { WorkerOrchestrator } from './orchestrator';
import { ApiClient } from '../api/client';
import { HeartbeatService } from '../heartbeat/heartbeat';

describe('WorkerOrchestrator Cloud & Local Concurrency Suite', () => {
  let mockApiClient: jest.Mocked<ApiClient>;
  let mockHeartbeat: jest.Mocked<HeartbeatService>;

  beforeEach(() => {
    delete process.env.MAX_ACTIVE_BOOKINGS;
    delete process.env.MAX_AVAILABILITY_MONITORS;

    mockApiClient = {
      claimJob: jest.fn().mockResolvedValue({ hasJob: false }),
      getDemandDates: jest.fn().mockResolvedValue([]),
    } as any;

    mockHeartbeat = {
      isExecutionPermitted: jest.fn().mockReturnValue(true),
      getDesiredState: jest.fn().mockReturnValue('RUNNING'),
      setExecutionPermitted: jest.fn(),
      setStatus: jest.fn(),
      addActiveJob: jest.fn(),
      removeActiveJob: jest.fn(),
    } as any;
  });

  it('runs in passive monitor-only mode and avoids claim polling when MAX_ACTIVE_BOOKINGS=0', async () => {
    process.env.MAX_ACTIVE_BOOKINGS = '0';

    const orchestrator = new WorkerOrchestrator(mockApiClient, mockHeartbeat, 20, 20);
    await orchestrator.start();

    // Allow multiple loop ticks
    await new Promise((r) => setTimeout(r, 60));
    orchestrator.stop();

    // claimJob should NEVER be called when concurrency is 0
    expect(mockApiClient.claimJob).not.toHaveBeenCalled();
    // Discovery loop still runs
    expect(mockApiClient.getDemandDates).toHaveBeenCalled();
  });

  it('actively polls claimJob when MAX_ACTIVE_BOOKINGS >= 1 and execution is permitted', async () => {
    process.env.MAX_ACTIVE_BOOKINGS = '1';

    const orchestrator = new WorkerOrchestrator(mockApiClient, mockHeartbeat, 20, 20);
    await orchestrator.start();

    await new Promise((r) => setTimeout(r, 60));
    orchestrator.stop();

    expect(mockApiClient.claimJob).toHaveBeenCalled();
  });

  it('suspends claim polling when Super Admin sets desiredState to STOPPED', async () => {
    process.env.MAX_ACTIVE_BOOKINGS = '1';
    mockHeartbeat.isExecutionPermitted.mockReturnValue(false);
    mockHeartbeat.getDesiredState.mockReturnValue('STOPPED');

    const orchestrator = new WorkerOrchestrator(mockApiClient, mockHeartbeat, 20, 20);
    await orchestrator.start();

    await new Promise((r) => setTimeout(r, 60));
    orchestrator.stop();

    expect(mockApiClient.claimJob).not.toHaveBeenCalled();
    expect(mockApiClient.getDemandDates).not.toHaveBeenCalled();
  });
});
