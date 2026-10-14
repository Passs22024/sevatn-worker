import * as os from 'os';
import { ApiClient } from '../api/client';

export class HeartbeatService {
  private timer: NodeJS.Timeout | null = null;
  private currentStatus: string = 'IDLE';
  private currentJobId: string | null = null;
  private activeJobIds = new Set<string>();

  constructor(
    private apiClient: ApiClient,
    private version: string,
  ) {}

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

  private async sendImmediate() {
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

      await this.apiClient.sendHeartbeat({
        status: this.currentStatus,
        version: this.version,
        currentJobId: primaryJobId,
        activeJobIds: activeList,
        cpuUsage: Math.min(100, Math.max(0, cpuUsage)),
        memoryUsage: Math.min(100, Math.max(0, memoryUsage)),
      });
    } catch (err: any) {
      // Non-fatal logging for network hiccups
      // console.warn('[Heartbeat] Ping failed:', err?.message);
    }
  }
}
