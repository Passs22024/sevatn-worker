import * as os from 'os';
import { ApiClient } from '../api/client';

export class HeartbeatService {
  private timer: NodeJS.Timeout | null = null;
  private currentStatus: string = 'IDLE';
  private currentJobId: string | null = null;
  private activeJobIds = new Set<string>();
  private serverDesiredState: string = 'STOPPED';
  private currentActivity: string = 'IDLE';
  private activityDetails: string = 'Idle, waiting for assignments';

  constructor(
    private apiClient: ApiClient,
    private version: string,
  ) {}

  setActivity(activity: string, details?: string) {
    this.currentActivity = activity;
    if (details) this.activityDetails = details;
    this.sendImmediate().catch(() => {});
  }

  getDesiredState(): string {
    return this.serverDesiredState;
  }

  isExecutionPermitted(): boolean {
    return this.serverDesiredState === 'RUNNING';
  }

  setExecutionPermitted(permitted: boolean) {
    this.serverDesiredState = permitted ? 'RUNNING' : 'STOPPED';
  }

  addActiveJob(jobId: string) {
    if (jobId) {
      this.activeJobIds.add(jobId);
      this.currentStatus = 'BUSY';
      this.currentJobId = jobId;
      this.sendImmediate().catch(() => {});
    }
  }

  removeActiveJob(jobId: string) {
    if (jobId) {
      this.activeJobIds.delete(jobId);
      if (this.activeJobIds.size === 0) {
        this.currentStatus = 'IDLE';
        this.currentJobId = null;
      } else {
        const remaining = Array.from(this.activeJobIds);
        this.currentJobId = remaining[0];
      }
      this.sendImmediate().catch(() => {});
    }
  }

  getActiveJobs(): string[] {
    return Array.from(this.activeJobIds);
  }

  setStatus(status: string, currentJobId: string | null = null) {
    this.currentStatus = status;
    this.currentJobId = currentJobId;
    if (currentJobId) {
      this.activeJobIds.add(currentJobId);
    } else if (status === 'IDLE' || status === 'OFFLINE') {
      this.activeJobIds.clear();
    }
    this.sendImmediate().catch(() => {});
  }

  async init() {
    await this.sendImmediate();
  }

  start(intervalMs: number = 10000) {
    this.sendImmediate().catch(() => {});
    this.timer = setInterval(() => this.sendImmediate().catch(() => {}), intervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public async sendImmediate() {
    try {
      const freeMem = os.freemem();
      const totalMem = os.totalmem();
      const memoryUsage = Number((((totalMem - freeMem) / totalMem) * 100).toFixed(1));

      // Calculate approximate CPU usage load
      const cpus = os.cpus();
      let totalIdle = 0, totalTick = 0;
      for (const cpu of cpus) {
        for (const type in cpu.times) {
          totalTick += (cpu.times as any)[type];
        }
        totalIdle += cpu.times.idle;
      }
      const cpuUsage = Number((100 - (totalIdle / totalTick) * 100).toFixed(1)) || 15.0;

      const activeList = Array.from(this.activeJobIds);
      const primaryJobId = activeList.length > 0 ? activeList[0] : (this.currentJobId || undefined);

      const deploymentType = process.env.DEPLOYMENT_TYPE
        ? process.env.DEPLOYMENT_TYPE.toUpperCase()
        : (process.platform === 'win32' ? 'LOCAL_PC' : (process.env.DOCKER_CONTAINER ? 'DOCKER' : 'CLOUD_VM'));
      const installationId = process.env.INSTALLATION_ID || os.hostname();
      const maxConcurrentJobs = process.env.MAX_CONCURRENT_JOBS ? parseInt(process.env.MAX_CONCURRENT_JOBS, 10) : undefined;

      const res = await this.apiClient.sendHeartbeat({
        status: this.currentStatus,
        version: this.version,
        deploymentType,
        installationId,
        maxConcurrentJobs,
        currentJobId: primaryJobId,
        activeJobIds: activeList,
        currentActivity: this.currentActivity,
        activityDetails: this.activityDetails,
        cpuUsage: Math.min(100, Math.max(0, cpuUsage)),
        memoryUsage: Math.min(100, Math.max(0, memoryUsage)),
      });

      if (res && res.desiredState) {
        const previousState = this.serverDesiredState;
        this.serverDesiredState = res.desiredState;
        if (previousState !== res.desiredState) {
          if (res.desiredState === 'RUNNING') {
            console.log('[Heartbeat] Super Admin state transitioned to RUNNING. Execution authorized.');
          } else {
            console.log(`[Heartbeat] Super Admin state transitioned to ${res.desiredState}. Execution paused.`);
          }
        }
      }
    } catch (err: any) {
      console.warn('[Heartbeat] Ping failed:', err?.response?.data || err?.message);
    }
  }
}
