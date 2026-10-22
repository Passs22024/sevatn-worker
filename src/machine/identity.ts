import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { ApiClient } from '../api/client';

export interface MachineIdentityConfig {
  machineCode?: string;
  machineName?: string;
  version?: string;
  machineToken?: string | null;
  credentialsPath?: string;
  autoConfirm?: boolean;
}

export class MachineIdentity {
  public machineCode: string;
  public machineName: string;
  public version: string;
  public machineToken: string | null;
  public credentialsPath: string;
  private autoConfirm: boolean;

  constructor(config: MachineIdentityConfig = {}) {
    const programDataDir = process.env.PROGRAMDATA
      ? path.resolve(process.env.PROGRAMDATA, 'SEVATN', 'Worker')
      : null;
    const programDataCreds = programDataDir
      ? path.resolve(programDataDir, '.worker-credentials.json')
      : null;

    this.credentialsPath =
      config.credentialsPath ||
      process.env.CREDENTIALS_PATH ||
      (programDataCreds && fs.existsSync(programDataCreds)
        ? programDataCreds
        : (programDataCreds && process.env.NODE_ENV === 'production'
            ? programDataCreds
            : path.resolve(process.cwd(), '.worker-credentials.json')));

    // 1. Initial values from config or environment
    this.machineCode =
      config.machineCode ||
      process.env.MACHINE_CODE ||
      `PC-${os.hostname().slice(0, 4).toUpperCase()}`;

    this.machineName =
      config.machineName ||
      process.env.MACHINE_NAME ||
      `Worker ${os.hostname()}`;

    this.version = config.version || process.env.VERSION || '1.0.0';
    this.machineToken = config.machineToken !== undefined ? config.machineToken : (process.env.MACHINE_TOKEN || null);

    this.autoConfirm =
      config.autoConfirm !== undefined
        ? config.autoConfirm
        : (process.env.AUTO_PAIR === 'true' ||
           process.env.CI === 'true' ||
           process.argv.includes('--yes') ||
           process.argv.includes('-y'));

    // 2. If token is not provided via env, attempt to load previously persisted credentials
    if (!this.machineToken) {
      this.loadPersistedCredentials();
    }
  }

  /**
   * Loads stable machine identity and provisioned token from local persistent storage
   */
  public loadPersistedCredentials(): boolean {
    try {
      if (fs.existsSync(this.credentialsPath)) {
        const raw = fs.readFileSync(this.credentialsPath, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.machineToken === 'string' && parsed.machineToken.trim().length > 0) {
          this.machineToken = parsed.machineToken.trim();
          if (parsed.machineCode && !process.env.MACHINE_CODE) {
            this.machineCode = parsed.machineCode;
          }
          if (parsed.machineName && !process.env.MACHINE_NAME) {
            this.machineName = parsed.machineName;
          }
          return true;
        }
      }
    } catch (err: any) {
      console.warn(`[Machine] Warning: Could not read persisted credentials: ${err.message}`);
    }
    return false;
  }

  /**
   * Persists provisioned machine credentials locally with restricted file permissions
   */
  public saveCredentials(token: string): void {
    try {
      this.machineToken = token;
      const data = {
        machineCode: this.machineCode,
        machineName: this.machineName,
        machineToken: token,
        version: this.version,
        pairedAt: new Date().toISOString(),
      };
      fs.mkdirSync(path.dirname(this.credentialsPath), { recursive: true });
      fs.writeFileSync(this.credentialsPath, JSON.stringify(data, null, 2), {
        encoding: 'utf8',
        mode: 0o600, // Read/write only by owner
      });
      console.log(`[Machine] Secure credentials saved to ${this.credentialsPath}`);
    } catch (err: any) {
      console.warn(`[Machine] Notice: Failed to persist credentials locally: ${err.message}`);
    }
  }

  /**
   * Prompts operator via terminal readline for Yes/No confirmation.
   * Handles invalid inputs, SIGINT, EOF, and automation flags.
   */
  public async promptConfirmation(
    questionFn?: (query: string) => Promise<string>,
  ): Promise<boolean> {
    if (this.autoConfirm) {
      console.log('[Machine] Auto-confirm flag detected. Proceeding with pairing...');
      return true;
    }

    if (!process.stdin.isTTY && !questionFn) {
      console.log('[Machine] Non-interactive environment detected (no TTY). Skipping interactive prompt.');
      return false;
    }

    console.log('=======================================================');
    console.log('⚡ TICKETASSIST WORKER NODE INITIALIZATION');
    console.log(`Host Machine : ${os.hostname()}`);
    console.log(`Machine Code : ${this.machineCode}`);
    console.log(`Display Name : ${this.machineName}`);
    console.log('=======================================================');

    const promptText = 'Are you sure you want to initialize and pair this worker machine? (yes/no): ';

    // Default readline implementation
    const ask =
      questionFn ||
      ((query: string): Promise<string> => {
        return new Promise((resolve) => {
          const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
          });

          rl.question(query, (answer) => {
            rl.close();
            resolve(answer);
          });

          rl.on('SIGINT', () => {
            rl.close();
            resolve('no');
          });
        });
      });

    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const rawInput = await ask(promptText);
        const input = (rawInput || '').trim().toLowerCase();

        if (input === 'yes' || input === 'y') {
          return true;
        }

        if (input === 'no' || input === 'n') {
          return false;
        }

        console.log(`⚠️ Invalid input: "${rawInput}". Please enter 'yes' or 'no'.`);
      } catch (err: any) {
        console.warn(`[Machine] Terminal input interrupted: ${err.message}`);
        return false;
      }
    }

    console.error('[Machine] Exceeded maximum input attempts. Aborting safely.');
    return false;
  }

  /**
   * Ensures the worker machine is paired and authorized with the backend.
   * Prompts for confirmation when unconfigured, generates pairing credentials,
   * polls for admin approval, and securely receives the machine token.
   */
  async ensurePaired(
    apiClient: ApiClient,
    options: {
      questionFn?: (query: string) => Promise<string>;
      pollIntervalMs?: number;
      maxPollAttempts?: number;
    } = {},
  ): Promise<boolean> {
    // 1. If worker already has an active machineToken, verify stability across restarts
    if (this.machineToken) {
      apiClient.setToken(this.machineToken);
      try {
        const check = await apiClient.checkPairingStatus(this.machineCode);
        if (check.paired) {
          console.log(`[Machine] Reconnected: ${this.machineCode} is registered and paired.`);
          return true;
        }
      } catch (err: any) {
        // If 401 or revoked, machineToken is no longer valid
        const statusCode = err?.response?.status;
        if (statusCode === 401 || statusCode === 403 || statusCode === 404) {
          console.warn(`[Machine] Stale or revoked credentials detected for ${this.machineCode}. Re-pairing required.`);
          this.machineToken = null;
        } else {
          // Network issue or offline backend: assume valid token and let heartbeat retry
          console.warn(`[Machine] Backend unreachable during startup status check. Proceeding with stored token...`);
          return true;
        }
      }
    }

    // 2. Ask Yes/No confirmation question before generating new credentials
    const confirmed = await this.promptConfirmation(options.questionFn);
    if (!confirmed) {
      console.log('Pairing cancelled by user. Exiting safely.');
      return false;
    }

    // 3. Register machine and request cryptographically generated pairing code
    console.log(`[Machine] Registering worker ${this.machineCode} with TicketAssist Cloud...`);
    try {
      const reg = await apiClient.registerMachine(this.machineCode, this.machineName, this.version);

      console.log('=======================================================');
      console.log('🔑 WORKER PAIRING CREDENTIALS GENERATED:');
      console.log(`Machine Code : ${reg.machineCode}`);
      console.log(`Machine Name : ${this.machineName}`);
      console.log(`Pairing Key  : ${reg.pairingCode}`);
      console.log(`Protocol     : TicketAssist Machine Pairing v1.0`);
      console.log(`Expires In   : 15 minutes`);
      console.log('───────────────────────────────────────────────────────');
      console.log('👉 Next Steps in Admin Dashboard:');
      console.log('1. Open: http://localhost:3000/admin/fleet');
      console.log('2. Click: "Add / Pair Worker Machine"');
      console.log(`3. Enter Machine Code: ${reg.machineCode}`);
      console.log(`4. Enter Pairing Key: ${reg.pairingCode}`);
      console.log('5. Assign Worker Display Name and submit registration.');
      console.log('=======================================================');

      // 4. Poll until administrator completes registration and authorizes pairing
      console.log('[Machine] Waiting for Admin registration approval on /admin/fleet...');
      const pollInterval = options.pollIntervalMs || 3000;
      const maxAttempts = options.maxPollAttempts || 60;

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
        try {
          const status = await apiClient.checkPairingStatus(this.machineCode);
          if (status.paired && status.machineToken) {
            this.saveCredentials(status.machineToken);
            apiClient.setToken(this.machineToken!);
            console.log('✅ Machine registration approved! Secure worker token provisioned.');
            console.log('⚡ Establishing authenticated connection to TicketAssist Cloud...');
            return true;
          }
        } catch (pollErr: any) {
          // Transient poll error, continue polling
        }
      }

      console.error('❌ Pairing window timed out. Please restart worker to generate a fresh pairing key.');
      return false;
    } catch (err: any) {
      console.error('[Machine] Registration failed:', err?.response?.data || err.message);
      return false;
    }
  }
}
