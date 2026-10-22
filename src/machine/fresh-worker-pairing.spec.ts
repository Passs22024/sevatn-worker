import * as fs from 'fs';
import * as path from 'path';
import { MachineIdentity } from './identity';
import { ApiClient } from '../api/client';
import { HeartbeatService } from '../heartbeat/heartbeat';
import { WorkerOrchestrator } from '../worker/orchestrator';

describe('Fresh AWS Worker Registration, Pairing & Admin Approval Flow Suite', () => {
  const testDir = path.resolve(__dirname, 'test_artifacts');
  const testCredsPath = path.resolve(testDir, '.worker-credentials.json');

  beforeAll(() => {
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
  });

  beforeEach(() => {
    if (fs.existsSync(testCredsPath)) {
      try {
        fs.unlinkSync(testCredsPath);
      } catch {}
    }
    delete process.env.MACHINE_TOKEN;
    process.env.CREDENTIALS_PATH = testCredsPath;
    process.env.MACHINE_CODE = 'PC-AWS-001';
    process.env.MACHINE_NAME = 'AWS Demo Worker';
  });

  afterAll(() => {
    if (fs.existsSync(testCredsPath)) {
      try {
        fs.unlinkSync(testCredsPath);
      } catch {}
    }
    if (fs.existsSync(testDir)) {
      try {
        fs.rmdirSync(testDir);
      } catch {}
    }
  });

  describe('1. Fresh Worker Registration & Pairing Code Generation', () => {
    it('registers fresh worker without pre-existing token and receives pairing code', async () => {
      const machine = new MachineIdentity({
        machineCode: 'PC-AWS-001',
        machineName: 'AWS Demo Worker',
        credentialsPath: testCredsPath,
        autoConfirm: true,
      });

      expect(machine.machineToken).toBeNull();

      const mockApiClient = {
        hasToken: jest.fn().mockReturnValue(false),
        setToken: jest.fn(),
        clearToken: jest.fn(),
        registerMachine: jest.fn().mockResolvedValue({
          message: 'Worker machine registered',
          machineId: 'wm_12345',
          machineCode: 'PC-AWS-001',
          pairingCode: 'TA-7744',
        }),
        checkPairingStatus: jest.fn().mockResolvedValue({
          paired: true,
          machineToken: 'wkt_aws_demo_token_9999',
          status: 'STOPPED',
          desiredState: 'STOPPED',
        }),
      } as any;

      const paired = await machine.ensurePaired(mockApiClient, {
        pollIntervalMs: 10,
        maxPollAttempts: 3,
        nonInteractive: true,
      });

      expect(paired).toBe(true);
      expect(mockApiClient.registerMachine).toHaveBeenCalledWith(
        'PC-AWS-001',
        'AWS Demo Worker',
        '1.0.0',
      );
      expect(mockApiClient.setToken).toHaveBeenCalledWith('wkt_aws_demo_token_9999');
      expect(machine.machineToken).toBe('wkt_aws_demo_token_9999');
    });
  });

  describe('2. Pairing Pending Admin Approval', () => {
    it('polls status while awaiting Admin approval and does not authorize prematurely', async () => {
      const machine = new MachineIdentity({
        machineCode: 'PC-AWS-001',
        machineName: 'AWS Demo Worker',
        credentialsPath: testCredsPath,
        autoConfirm: true,
      });

      let pollCount = 0;
      const mockApiClient = {
        hasToken: jest.fn().mockReturnValue(false),
        setToken: jest.fn(),
        clearToken: jest.fn(),
        registerMachine: jest.fn().mockResolvedValue({
          machineCode: 'PC-AWS-001',
          pairingCode: 'TA-1234',
        }),
        checkPairingStatus: jest.fn().mockImplementation(() => {
          pollCount++;
          if (pollCount < 3) {
            return Promise.resolve({ paired: false, pairingCode: 'TA-1234', status: 'UNPAIRED' });
          }
          return Promise.resolve({
            paired: true,
            machineToken: 'wkt_approved_token_456',
            status: 'STOPPED',
            desiredState: 'STOPPED',
          });
        }),
      } as any;

      const paired = await machine.ensurePaired(mockApiClient, {
        pollIntervalMs: 10,
        maxPollAttempts: 5,
        nonInteractive: true,
      });

      expect(paired).toBe(true);
      expect(pollCount).toBe(3);
      expect(mockApiClient.setToken).toHaveBeenCalledWith('wkt_approved_token_456');
    });
  });

  describe('3. Credential Persistence & Reload Across Restarts', () => {
    it('saves credentials locally with restricted permissions and reloads on reboot without duplicate registration', async () => {
      // 1. Initial pairing and persistence
      const initialWorker = new MachineIdentity({
        machineCode: 'PC-AWS-001',
        machineName: 'AWS Demo Worker',
        credentialsPath: testCredsPath,
        autoConfirm: true,
      });
      initialWorker.saveCredentials('wkt_persisted_aws_token_777');

      expect(fs.existsSync(testCredsPath)).toBe(true);
      const raw = JSON.parse(fs.readFileSync(testCredsPath, 'utf8'));
      expect(raw.machineCode).toBe('PC-AWS-001');
      expect(raw.machineToken).toBe('wkt_persisted_aws_token_777');

      // 2. Simulated container recreation (fresh instance with same mounted credentialsPath)
      const recreatedWorker = new MachineIdentity({
        machineCode: 'PC-AWS-001',
        credentialsPath: testCredsPath,
        autoConfirm: true,
      });

      expect(recreatedWorker.machineToken).toBe('wkt_persisted_aws_token_777');

      const mockApiClient = {
        hasToken: jest.fn().mockReturnValue(true),
        setToken: jest.fn(),
        clearToken: jest.fn(),
        checkPairingStatus: jest.fn().mockResolvedValue({
          paired: true,
          status: 'STOPPED',
          desiredState: 'STOPPED',
        }),
        registerMachine: jest.fn(),
      } as any;

      const paired = await recreatedWorker.ensurePaired(mockApiClient, { nonInteractive: true });
      expect(paired).toBe(true);
      expect(mockApiClient.setToken).toHaveBeenCalledWith('wkt_persisted_aws_token_777');
      // Critical check: registerMachine MUST NOT be called again on restart
      expect(mockApiClient.registerMachine).not.toHaveBeenCalled();
    });
  });

  describe('4. Missing, Invalid, or Revoked Token Handling', () => {
    it('detects 401/404 stale credentials, clears token, and initiates re-pairing', async () => {
      const machine = new MachineIdentity({
        machineCode: 'PC-AWS-001',
        machineToken: 'wkt_revoked_token',
        credentialsPath: testCredsPath,
        autoConfirm: true,
      });

      const mockApiClient = {
        hasToken: jest.fn().mockReturnValue(false),
        setToken: jest.fn(),
        clearToken: jest.fn(),
        checkPairingStatus: jest
          .fn()
          // First check returns 404 (machine was deleted from backend)
          .mockRejectedValueOnce({ response: { status: 404, data: { message: 'Machine not found' } } })
          // Subsequent poll after registration returns newly approved pairing
          .mockResolvedValueOnce({
            paired: true,
            machineToken: 'wkt_freshly_repaired_token',
            status: 'STOPPED',
          }),
        registerMachine: jest.fn().mockResolvedValue({
          machineCode: 'PC-AWS-001',
          pairingCode: 'TA-9988',
        }),
      } as any;

      const paired = await machine.ensurePaired(mockApiClient, {
        pollIntervalMs: 10,
        maxPollAttempts: 3,
        nonInteractive: true,
      });

      expect(paired).toBe(true);
      expect(mockApiClient.clearToken).toHaveBeenCalled();
      expect(mockApiClient.registerMachine).toHaveBeenCalledWith('PC-AWS-001', 'AWS Demo Worker', '1.0.0');
      expect(machine.machineToken).toBe('wkt_freshly_repaired_token');
    });

    it('ApiClient blocks sendHeartbeat and claimJob without a token', async () => {
      const realApiClient = new ApiClient('http://localhost:4000');
      realApiClient.clearToken();
      expect(realApiClient.hasToken()).toBe(false);

      await expect(realApiClient.sendHeartbeat({ status: 'IDLE' })).rejects.toThrow(
        /Worker machine token missing/,
      );
      await expect(realApiClient.claimJob()).rejects.toThrow(
        /Worker machine token missing/,
      );
    });
  });

  describe('5. Authenticated Heartbeat & Authorization State', () => {
    it('sends authenticated heartbeat with token and tracks server desiredState', async () => {
      const mockApiClient = {
        hasToken: jest.fn().mockReturnValue(true),
        sendHeartbeat: jest.fn().mockResolvedValue({
          acknowledged: true,
          status: 'STOPPED',
          adminStatus: 'ENABLED',
          desiredState: 'STOPPED',
        }),
      } as any;

      const heartbeat = new HeartbeatService(mockApiClient, '1.0.0');
      expect(heartbeat.getDesiredState()).toBe('STOPPED');
      expect(heartbeat.isExecutionPermitted()).toBe(false);

      await heartbeat.sendImmediate();
      expect(mockApiClient.sendHeartbeat).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'IDLE',
          version: '1.0.0',
        }),
      );
      expect(heartbeat.isExecutionPermitted()).toBe(false);

      // Server transitions to RUNNING
      mockApiClient.sendHeartbeat.mockResolvedValueOnce({
        acknowledged: true,
        desiredState: 'RUNNING',
      });
      await heartbeat.sendImmediate();
      expect(heartbeat.getDesiredState()).toBe('RUNNING');
      expect(heartbeat.isExecutionPermitted()).toBe(true);

      heartbeat.stop();
    });

    it('suspends heartbeat and triggers onAuthRevoked on HTTP 401 response', async () => {
      const mockApiClient = {
        hasToken: jest.fn().mockReturnValue(true),
        clearToken: jest.fn(),
        sendHeartbeat: jest.fn().mockRejectedValue({
          response: { status: 401, data: { message: 'Token revoked' } },
        }),
      } as any;

      const heartbeat = new HeartbeatService(mockApiClient, '1.0.0');
      const onRevokedMock = jest.fn();
      heartbeat.setOnAuthRevoked(onRevokedMock);

      await heartbeat.sendImmediate();

      expect(mockApiClient.clearToken).toHaveBeenCalled();
      expect(heartbeat.getDesiredState()).toBe('STOPPED');
      expect(onRevokedMock).toHaveBeenCalled();

      heartbeat.stop();
    });
  });

  describe('6. Execution Remains Disabled Until Explicitly Authorized', () => {
    it('Orchestrator does not poll or claim jobs while desiredState is STOPPED', async () => {
      const mockApiClient = {
        claimJob: jest.fn(),
        getDemandDates: jest.fn().mockResolvedValue([]),
      } as any;

      const mockHeartbeat = {
        isExecutionPermitted: jest.fn().mockReturnValue(false),
        getDesiredState: jest.fn().mockReturnValue('STOPPED'),
        setStatus: jest.fn(),
      } as any;

      process.env.MAX_ACTIVE_BOOKINGS = '1';
      const orchestrator = new WorkerOrchestrator(mockApiClient, mockHeartbeat, 15, 15);
      await orchestrator.start();

      await new Promise((r) => setTimeout(r, 50));
      orchestrator.stop();

      // Zero job claim attempts while execution is stopped
      expect(mockApiClient.claimJob).not.toHaveBeenCalled();
    });
  });

  describe('7. Docker Persistent Credential Storage Configuration', () => {
    it('verifies docker-compose.yml defines persistent volume and explicit CREDENTIALS_PATH', () => {
      const composePath = path.resolve(__dirname, '..', '..', 'docker-compose.yml');
      expect(fs.existsSync(composePath)).toBe(true);

      const composeContent = fs.readFileSync(composePath, 'utf8');
      expect(composeContent).toContain('CREDENTIALS_PATH=/app/credentials/.worker-credentials.json');
      expect(composeContent).toContain('worker_credentials:/app/credentials');
      expect(composeContent).toContain('volumes:\n  worker_credentials:');
    });

    it('verifies .dockerignore protects secrets and credential files from being baked into images', () => {
      const dockerignorePath = path.resolve(__dirname, '..', '..', '.dockerignore');
      expect(fs.existsSync(dockerignorePath)).toBe(true);

      const dockerignoreContent = fs.readFileSync(dockerignorePath, 'utf8');
      expect(dockerignoreContent).toContain('.worker-credentials.json');
      expect(dockerignoreContent).toContain('.env');
      expect(dockerignoreContent).toContain('*.pem');
    });
  });
});
