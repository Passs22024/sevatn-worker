import { HeartbeatService } from './heartbeat';
import { ApiClient } from '../api/client';

describe('HeartbeatService Multi-Job Concurrency Tracking', () => {
  let mockApiClient: jest.Mocked<ApiClient>;
  let heartbeat: HeartbeatService;
  let sentHeartbeats: any[] = [];

  beforeEach(() => {
    sentHeartbeats = [];
    mockApiClient = {
      sendHeartbeat: jest.fn().mockImplementation((payload) => {
        sentHeartbeats.push(payload);
        return Promise.resolve({ status: 'OK' });
      }),
    } as any;

    heartbeat = new HeartbeatService(mockApiClient, '1.0.0');
  });

  afterEach(() => {
    heartbeat.stop();
  });

  it('tracks concurrent active jobs independently and preserves active jobs when one completes', () => {
    const jobA = 'job-uuid-111';
    const jobB = 'job-uuid-222';

    // Job A starts
    heartbeat.addActiveJob(jobA);
    expect(heartbeat.getActiveJobs()).toEqual([jobA]);
    expect(sentHeartbeats[sentHeartbeats.length - 1].status).toBe('BUSY');
    expect(sentHeartbeats[sentHeartbeats.length - 1].activeJobIds).toEqual([jobA]);

    // Job B starts while Job A is still running
    heartbeat.addActiveJob(jobB);
    expect(heartbeat.getActiveJobs()).toContain(jobA);
    expect(heartbeat.getActiveJobs()).toContain(jobB);
    expect(heartbeat.getActiveJobs().length).toBe(2);
    expect(sentHeartbeats[sentHeartbeats.length - 1].activeJobIds).toContain(jobA);
    expect(sentHeartbeats[sentHeartbeats.length - 1].activeJobIds).toContain(jobB);

    // Job A completes; Job B is STILL running!
    heartbeat.removeActiveJob(jobA);
    expect(heartbeat.getActiveJobs()).toEqual([jobB]);
    expect(sentHeartbeats[sentHeartbeats.length - 1].status).toBe('BUSY');
    expect(sentHeartbeats[sentHeartbeats.length - 1].activeJobIds).toEqual([jobB]);

    // Job B completes; now worker becomes IDLE
    heartbeat.removeActiveJob(jobB);
    expect(heartbeat.getActiveJobs()).toEqual([]);
    expect(sentHeartbeats[sentHeartbeats.length - 1].status).toBe('IDLE');
    expect(sentHeartbeats[sentHeartbeats.length - 1].activeJobIds).toEqual([]);
  });

  it('deduplicates redundant job additions to the active set', () => {
    heartbeat.addActiveJob('job-1');
    heartbeat.addActiveJob('job-1');
    expect(heartbeat.getActiveJobs()).toEqual(['job-1']);
  });

  it('reconciles server desired administrative state and execution permission', async () => {
    // Initial state is STOPPED
    expect(heartbeat.getDesiredState()).toBe('STOPPED');
    expect(heartbeat.isExecutionPermitted()).toBe(false);

    // Mock API returning RUNNING directive
    mockApiClient.sendHeartbeat.mockResolvedValueOnce({
      status: 'OK',
      desiredState: 'RUNNING',
    });

    heartbeat.setStatus('IDLE');
    // Allow promise tick
    await new Promise(r => setTimeout(r, 10));

    expect(heartbeat.getDesiredState()).toBe('RUNNING');
    expect(heartbeat.isExecutionPermitted()).toBe(true);

    // Mock API returning STOPPED directive
    mockApiClient.sendHeartbeat.mockResolvedValueOnce({
      status: 'OK',
      desiredState: 'STOPPED',
    });

    heartbeat.setStatus('IDLE');
    await new Promise(r => setTimeout(r, 10));

    expect(heartbeat.getDesiredState()).toBe('STOPPED');
    expect(heartbeat.isExecutionPermitted()).toBe(false);
  });
});
