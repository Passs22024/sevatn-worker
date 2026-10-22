import axios, { AxiosInstance } from 'axios';
import * as dotenv from 'dotenv';
dotenv.config();

export class ApiClient {
  private client: AxiosInstance;
  private token: string | null = null;

  constructor(baseURL: string = process.env.API_BASE_URL || 'http://localhost:4000') {
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

  async updateJobProgress(jobId: string, data: { status: string; note?: string; logs?: any }) {
    const res = await this.client.post(`/workers/jobs/${jobId}/progress`, data);
    return res.data;
  }

  async completeJob(jobId: string, data: { officialReference?: string; confirmationData?: any; note?: string }) {
    const res = await this.client.post(`/workers/jobs/${jobId}/complete`, data);
    return res.data;
  }

  async failJob(jobId: string, data: { status: string; errorCode?: string; errorMessage?: string }) {
    const res = await this.client.post(`/workers/jobs/${jobId}/fail`, data);
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
  }) {
    const res = await this.client.post(`/workers/jobs/${bookingId}/status`, data);
    return res.data;
  }

  async reportJobResult(bookingId: string, data: {
    status: string;
    officialReference?: string;
    confirmationData?: any;
    failureReason?: string;
    executionLogs?: any;
    screenshotUrl?: string;
  }) {
    const res = await this.client.post(`/workers/jobs/${bookingId}/result`, data);
    return res.data;
  }

  async getDemandDates() {
    const res = await this.client.get('/availability/demand-dates');
    return res.data;
  }

  async publishAvailability(data: {
    date: string;
    route: string;
    timeSlot: string;
    source?: string;
  }) {
    const res = await this.client.post('/availability/events', data);
    return res.data;
  }

  async publishBulkAvailability(opportunities: Array<{
    date: string;
    route: string;
    timeSlot: string;
    source?: string;
  }>) {
    const res = await this.client.post('/availability/events/bulk', { opportunities });
    return res.data;
  }
}
