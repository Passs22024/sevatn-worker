import { MachineIdentity } from './identity';
import * as fs from 'fs';
import * as path from 'path';

describe('MachineIdentity — Terminal Startup, Yes/No Confirmation & Pairing Protocol', () => {
  const testCredsPath = path.resolve(__dirname, 'test-worker-credentials.json');

  beforeEach(() => {
    if (fs.existsSync(testCredsPath)) {
      fs.unlinkSync(testCredsPath);
    }
  });

  afterEach(() => {
    if (fs.existsSync(testCredsPath)) {
      try {
        fs.unlinkSync(testCredsPath);
      } catch {}
    }
  });

  describe('1. Terminal Confirmation Prompt', () => {
    it('should return true when operator confirms with "yes" or "y"', async () => {
      const machine = new MachineIdentity({
        credentialsPath: testCredsPath,
        autoConfirm: false,
      });

      const questionYes = jest.fn().mockResolvedValue('yes');
      const confirmed = await machine.promptConfirmation(questionYes);
      expect(confirmed).toBe(true);

      const questionY = jest.fn().mockResolvedValue('Y');
      const confirmedY = await machine.promptConfirmation(questionY);
      expect(confirmedY).toBe(true);
    });

    it('should return false when operator confirms with "no" or "n"', async () => {
      const machine = new MachineIdentity({
        credentialsPath: testCredsPath,
        autoConfirm: false,
      });

      const questionNo = jest.fn().mockResolvedValue('no');
      const confirmed = await machine.promptConfirmation(questionNo);
      expect(confirmed).toBe(false);

      const questionN = jest.fn().mockResolvedValue('N');
      const confirmedN = await machine.promptConfirmation(questionN);
      expect(confirmedN).toBe(false);
    });

    it('should re-prompt on invalid input and accept a subsequent "yes"', async () => {
      const machine = new MachineIdentity({
        credentialsPath: testCredsPath,
        autoConfirm: false,
      });

      const question = jest
        .fn()
        .mockResolvedValueOnce('maybe')
        .mockResolvedValueOnce('invalid-command')
        .mockResolvedValueOnce('yes');

      const confirmed = await machine.promptConfirmation(question);
      expect(confirmed).toBe(true);
      expect(question).toHaveBeenCalledTimes(3);
    });

    it('should safely abort if maximum invalid input attempts are exceeded', async () => {
      const machine = new MachineIdentity({
        credentialsPath: testCredsPath,
        autoConfirm: false,
      });

      const question = jest
        .fn()
        .mockResolvedValueOnce('invalid-1')
        .mockResolvedValueOnce('invalid-2')
        .mockResolvedValueOnce('invalid-3');

      const confirmed = await machine.promptConfirmation(question);
      expect(confirmed).toBe(false);
      expect(question).toHaveBeenCalledTimes(3);
    });

    it('should bypass interactive prompt when autoConfirm is enabled', async () => {
      const machine = new MachineIdentity({
        credentialsPath: testCredsPath,
        autoConfirm: true,
      });

      const question = jest.fn();
      const confirmed = await machine.promptConfirmation(question);
      expect(confirmed).toBe(true);
      expect(question).not.toHaveBeenCalled();
    });
  });

  describe('2. Credential Persistence Across Restarts', () => {
    it('should persist provisioned machine credentials locally with restricted mode', () => {
      const machine = new MachineIdentity({
        machineCode: 'PC-TEST-99',
        machineName: 'Persisted Worker Node',
        credentialsPath: testCredsPath,
      });

      machine.saveCredentials('wkt_secret_token_123456');

      expect(fs.existsSync(testCredsPath)).toBe(true);
      const content = JSON.parse(fs.readFileSync(testCredsPath, 'utf8'));
      expect(content.machineCode).toBe('PC-TEST-99');
      expect(content.machineName).toBe('Persisted Worker Node');
      expect(content.machineToken).toBe('wkt_secret_token_123456');
      expect(content.pairedAt).toBeDefined();
    });

    it('should reload existing credentials on restart without needing re-pairing', async () => {
      // 1. Initial pair and save
      const initial = new MachineIdentity({
        machineCode: 'PC-TEST-99',
        machineName: 'Persisted Worker Node',
        credentialsPath: testCredsPath,
      });
      initial.saveCredentials('wkt_secret_token_123456');

      // 2. Worker restarts
      const restarted = new MachineIdentity({
        credentialsPath: testCredsPath,
      });

      expect(restarted.machineToken).toBe('wkt_secret_token_123456');
      expect(restarted.machineCode).toBe('PC-TEST-99');

      const mockApiClient = {
        setToken: jest.fn(),
        checkPairingStatus: jest.fn().mockResolvedValue({ paired: true }),
        registerMachine: jest.fn(),
      } as any;

      const paired = await restarted.ensurePaired(mockApiClient);
      expect(paired).toBe(true);
      expect(mockApiClient.setToken).toHaveBeenCalledWith('wkt_secret_token_123456');
      expect(mockApiClient.registerMachine).not.toHaveBeenCalled();
    });
  });

  describe('3. Full Pairing Flow & Cancellation Safeguards', () => {
    it('should exit safely without calling registration API when user answers "no"', async () => {
      const machine = new MachineIdentity({
        machineCode: 'PC-TEST-01',
        credentialsPath: testCredsPath,
        autoConfirm: false,
      });

      const mockApiClient = {
        setToken: jest.fn(),
        checkPairingStatus: jest.fn(),
        registerMachine: jest.fn(),
      } as any;

      const paired = await machine.ensurePaired(mockApiClient, {
        questionFn: jest.fn().mockResolvedValue('no'),
      });

      expect(paired).toBe(false);
      expect(mockApiClient.registerMachine).not.toHaveBeenCalled();
      expect(machine.machineToken).toBeNull();
    });

    it('should generate pairing code, poll status, and store token on successful admin approval', async () => {
      const machine = new MachineIdentity({
        machineCode: 'PC-TEST-01',
        machineName: 'Salem Booking Node',
        credentialsPath: testCredsPath,
        autoConfirm: false,
      });

      const mockApiClient = {
        setToken: jest.fn(),
        registerMachine: jest.fn().mockResolvedValue({
          machineCode: 'PC-TEST-01',
          pairingCode: 'TA-5829',
        }),
        checkPairingStatus: jest
          .fn()
          .mockResolvedValueOnce({ paired: false })
          .mockResolvedValueOnce({
            paired: true,
            machineToken: 'wkt_newly_provisioned_token_7788',
          }),
      } as any;

      const paired = await machine.ensurePaired(mockApiClient, {
        questionFn: jest.fn().mockResolvedValue('yes'),
        pollIntervalMs: 10,
        maxPollAttempts: 5,
      });

      expect(paired).toBe(true);
      expect(mockApiClient.registerMachine).toHaveBeenCalledWith(
        'PC-TEST-01',
        'Salem Booking Node',
        '1.0.0',
      );
      expect(mockApiClient.setToken).toHaveBeenCalledWith(
        'wkt_newly_provisioned_token_7788',
      );
      expect(machine.machineToken).toBe('wkt_newly_provisioned_token_7788');
      expect(fs.existsSync(testCredsPath)).toBe(true);
    });

    it('should prompt for re-pairing if existing credentials are confirmed invalid/revoked', async () => {
      const machine = new MachineIdentity({
        machineCode: 'PC-TEST-01',
        machineToken: 'wkt_revoked_token',
        credentialsPath: testCredsPath,
        autoConfirm: false,
      });

      const mockApiClient = {
        setToken: jest.fn(),
        checkPairingStatus: jest.fn().mockRejectedValue({
          response: { status: 401, data: { message: 'Invalid or revoked token' } },
        }),
        registerMachine: jest.fn().mockResolvedValue({
          machineCode: 'PC-TEST-01',
          pairingCode: 'TA-9912',
        }),
      } as any;

      // User says 'no' to re-pairing
      const paired = await machine.ensurePaired(mockApiClient, {
        questionFn: jest.fn().mockResolvedValue('no'),
      });

      expect(paired).toBe(false);
      expect(machine.machineToken).toBeNull();
    });
  });
});
