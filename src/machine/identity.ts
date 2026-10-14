import * as os from 'os';
import { ApiClient } from '../api/client';

export class MachineIdentity {
  public machineCode: string;
  public machineName: string;
  public version: string;
  public machineToken: string | null;

  constructor() {
    this.machineCode = process.env.MACHINE_CODE || `PC-${os.hostname().slice(0, 4).toUpperCase()}`;
    this.machineName = process.env.MACHINE_NAME || `Worker ${os.hostname()}`;
    this.version = process.env.VERSION || '1.0.0';
    this.machineToken = process.env.MACHINE_TOKEN || null;
  }

  async ensurePaired(apiClient: ApiClient): Promise<boolean> {
    if (this.machineToken) {
      apiClient.setToken(this.machineToken);
      return true;
    }

    console.log(`[Machine] Registering worker ${this.machineCode} with TicketAssist Cloud...`);
    try {
      const reg = await apiClient.registerMachine(this.machineCode, this.machineName, this.version);
      console.log(`=======================================================`);
      console.log(`🔑 WORKER PAIRING REQUIRED:`);
      console.log(`Machine Code: ${reg.machineCode}`);
      console.log(`Pairing Code: ${reg.pairingCode}`);
      console.log(`Please approve this code in TicketAssist Admin Dashboard.`);
      console.log(`=======================================================`);

      // Poll until admin approves
      console.log(`[Machine] Waiting for Admin approval...`);
      for (let attempt = 0; attempt < 60; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        const status = await apiClient.checkPairingStatus(this.machineCode);
        if (status.paired && status.machineToken) {
          this.machineToken = status.machineToken;
          apiClient.setToken(this.machineToken);
          console.log(`✅ Machine approved! Worker token received.`);
          return true;
        }
      }

      console.error(`❌ Pairing timeout. Please restart worker to generate new code.`);
      return false;
    } catch (err: any) {
      console.error(`[Machine] Registration failed:`, err?.response?.data || err.message);
      return false;
    }
  }
}
