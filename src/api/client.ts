import axios, { AxiosInstance } from 'axios';
import * as dotenv from 'dotenv';
dotenv.config();

export class ApiClient {
  private client: AxiosInstance;
  private token: string | null = null;

  constructor(baseURL: string = process.env.API_BASE_URL || 'http://localhost:5000') {
    this.token = process.env.MACHINE_TOKEN || null;
    this.client = axios.create({
      baseURL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    this.client.interceptors.request.use((config) => {
      if (this.token) {
        config.headers['x-machine-token'] = this.token;
        config.headers['Authorization'] = `Bearer ${this.token}`;
      }
      return config;
    });
  }

  setToken(token: string) {
    this.token = token ? token.trim() : null;
  }

  getToken(): string | null {
    return this.token;
  }

  hasToken(): boolean {
    return !!this.token && typeof this.token === 'string' && this.token.trim().length > 0;
  }

  clearToken(): void {
    this.token = null;
  }

  getBaseUrl(): string {
    return this.client.defaults.baseURL || '';
  }

  async registerMachine(machineCode: string, machineName: string, version: string) {
    const res = await this.client.post('/workers/register', {
      machineCode,
      machineName,
      version,
    });
    return res.data;
  }

  async checkPairingStatus(machineCode: string) {
    const res = await this.client.get(`/workers/status/${machineCode}`);
    return res.data;
  }

  async sendHeartbeat(data: {
    status: string;
    version?: string;
    deploymentType?: string;
    installationId?: string;
    maxConcurrentJobs?: number;
    currentJobId?: string;
    activeJobIds?: string[];
    currentActivity?: string;
    activityDetails?: string;
    cpuUsage?: number;
    memoryUsage?: number;
  }) {
    if (!this.hasToken()) {
      throw new Error('Worker machine token missing in x-machine-token or Authorization header; heartbeat aborted');
    }
    const res = await this.client.post('/workers/heartbeat', data);
    return res.data;
  }

  async claimJob() {
    if (!this.hasToken()) {
      throw new Error('Worker machine token missing; claim job aborted');
    }
    const res = await this.client.post('/workers/jobs/claim');
    return res.data;
  }

  async getPendingDates(): Promise<{ dates: string[] }> {
    if (!this.hasToken()) {
      throw new Error('Worker machine token missing; getPendingDates aborted');
    }
    const res = await this.client.get('/workers/pending-dates');
    return res.data;
  }

  async matchPending(date: string, route?: string): Promise<{ hasJob: boolean; jobType?: string; job?: any }> {
    if (!this.hasToken()) {
      throw new Error('Worker machine token missing; matchPending aborted');
    }
    const res = await this.client.post('/workers/match-pending', { date, route });
    return res.data;
  }

  async updateJobProgress(jobId: string, data: {
    status: string;
    note?: string;
    logs?: any;
    leaseGeneration?: number;
    fencingToken?: string;
    protocolVersion?: string;
  }) {
    const res = await this.client.post(`/workers/jobs/${jobId}/progress`, {
      ...data,
      protocolVersion: data.protocolVersion || 'v2.0-fenced',
    });
    return res.data;
  }

  async completeJob(jobId: string, data: {
    officialReference?: string;
    cartId?: string;
    officialBookingReference?: string;
    officialReceiptReference?: string;
    portalTransactionReference?: string;
    confirmationEvidence?: any;
    confirmedAt?: string | Date;
    confirmationData?: any;
    note?: string;
    leaseGeneration?: number;
    fencingToken?: string;
    protocolVersion?: string;
  }) {
    const res = await this.client.post(`/workers/jobs/${jobId}/complete`, {
      ...data,
      protocolVersion: data.protocolVersion || 'v2.0-fenced',
    });
    return res.data;
  }

  async failJob(jobId: string, data: {
    status: string;
    errorCode?: string;
    errorMessage?: string;
    leaseGeneration?: number;
    fencingToken?: string;
    protocolVersion?: string;
  }) {
    const res = await this.client.post(`/workers/jobs/${jobId}/fail`, {
      ...data,
      protocolVersion: data.protocolVersion || 'v2.0-fenced',
    });
    return res.data;
  }

  async renewLease(bookingId: string) {
    const res = await this.client.post(`/workers/jobs/${bookingId}/lease-renewal`);
    return res.data;
  }

  async updateJobStatus(bookingId: string, data: {
    status: string;
    note?: string;
    requiresHumanNote?: string;
    executionLogs?: any;
    leaseGeneration?: number;
    fencingToken?: string;
    protocolVersion?: string;
  }) {
    const res = await this.client.post(`/workers/jobs/${bookingId}/status`, {
      ...data,
      protocolVersion: data.protocolVersion || 'v2.0-fenced',
    });
    return res.data;
  }

  async reportJobResult(bookingId: string, data: {
    status: string;
    officialReference?: string;
    confirmationData?: any;
    failureReason?: string;
    executionLogs?: any;
    screenshotUrl?: string;
    leaseGeneration?: number;
    fencingToken?: string;
    protocolVersion?: string;
  }) {
    const res = await this.client.post(`/workers/jobs/${bookingId}/result`, {
      ...data,
      protocolVersion: data.protocolVersion || 'v2.0-fenced',
    });
    return res.data;
  }

  async getDemandDates(): Promise<Array<{
    demandKey?: string;
    date: string;
    route: string;
    pendingCount: number;
    isDue?: boolean;
    status?: string;
    lastCheckedAt?: string | null;
    nextCheckAt?: string | null;
    lockedBy?: string | null;
  }>> {
    const res = await this.client.get('/availability/demand-dates');
    return res.data;
  }

  async claimDemand(demandKey: string, workerId: string): Promise<{ claimed: boolean; message?: string }> {
    const res = await this.client.post('/availability/claim-demand', { demandKey, workerId });
    return res.data;
  }

  async releaseDemand(
    demandKey: string,
    workerId: string,
    status: 'AVAILABLE' | 'UNAVAILABLE' | 'ERROR',
    durationMs?: number,
    errorMessage?: string,
  ): Promise<any> {
    const res = await this.client.post('/availability/release-demand', {
      demandKey,
      workerId,
      status,
      durationMs,
      errorMessage,
    });
    return res.data;
  }

  async getDiscoveryMetrics(): Promise<any> {
    const res = await this.client.get('/availability/metrics');
    return res.data;
  }

  async publishAvailability(data: {
    date: string;
    route: string;
    timeSlot?: string;
    source?: string;
  }) {
    const res = await this.client.post('/availability/events', data);
    return res.data;
  }

  async publishBulkAvailability(opportunities: Array<{
    date: string;
    route: string;
    timeSlot?: string;
    source?: string;
  }>) {
    const res = await this.client.post('/availability/events/bulk', { opportunities });
    return res.data;
  }
}
