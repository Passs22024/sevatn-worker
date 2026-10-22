import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';
import axios from 'axios';
import { MachineIdentity } from '../machine/identity';
import { HeartbeatService } from '../heartbeat/heartbeat';
import { WorkerOrchestrator } from '../worker/orchestrator';
import { ApiClient } from '../api/client';
import { SanitizedLogger } from '../monitoring/logger';
import { randomBytes } from 'crypto';

export interface IpcServerConfig {
  machine: MachineIdentity;
  heartbeat?: HeartbeatService;
  orchestrator?: WorkerOrchestrator;
  apiClient: ApiClient;
  preferredPort?: number;
}

export class IpcServer {
  private server: http.Server | null = null;
  public port: number = 48292;
  private token: string;
  private sseClients: Set<http.ServerResponse> = new Set();
  private unsubscribeLogger?: () => void;
  private ipcFilePath: string;

  constructor(private config: IpcServerConfig) {
    this.port = config.preferredPort || 48292;
    this.token = randomBytes(16).toString('hex');

    const dataDir = process.env.PROGRAMDATA
      ? path.resolve(process.env.PROGRAMDATA, 'SEVATN', 'Worker')
      : path.resolve(process.cwd(), '.sevatn');

    if (!fs.existsSync(dataDir)) {
      try {
        fs.mkdirSync(dataDir, { recursive: true });
      } catch {}
    }
    this.ipcFilePath = path.join(dataDir, 'worker-ipc.json');
  }

  public async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res).catch((err) => {
          SanitizedLogger.error('[IPC] Request handler error:', err);
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message || 'Internal server error' }));
          }
        });
      });

      const tryListen = (currentPort: number) => {
        this.server!.listen(currentPort, '127.0.0.1', () => {
          this.port = currentPort;
          this.writeIpcFile();
          SanitizedLogger.info(`[IPC] Worker Management API listening at http://127.0.0.1:${this.port}`);

          // Subscribe to live log streaming
          this.unsubscribeLogger = SanitizedLogger.subscribe((entry) => {
            this.broadcastLogEntry(entry);
          });

          resolve(this.port);
        });

        this.server!.once('error', (err: any) => {
          if (err.code === 'EADDRINUSE') {
            tryListen(currentPort + 1);
          } else {
            reject(err);
          }
        });
      };

      tryListen(this.port);
    });
  }

  public async stop(): Promise<void> {
    if (this.unsubscribeLogger) {
      this.unsubscribeLogger();
      this.unsubscribeLogger = undefined;
    }

    for (const client of this.sseClients) {
      try {
        client.end();
      } catch {}
    }
    this.sseClients.clear();

    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => resolve());
      });
      this.server = null;
    }

    this.removeIpcFile();
  }

  private writeIpcFile(): void {
    try {
      const data = {
        port: this.port,
        pid: process.pid,
        token: this.token,
        backendUrl: process.env.API_BASE_URL || 'http://localhost:4000',
        startedAt: new Date().toISOString(),
      };
      fs.writeFileSync(this.ipcFilePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (err: any) {
      SanitizedLogger.warn(`[IPC] Could not write discovery file: ${err.message}`);
    }
  }

  private removeIpcFile(): void {
    try {
      if (fs.existsSync(this.ipcFilePath)) {
        fs.unlinkSync(this.ipcFilePath);
      }
    } catch {}
  }

  private broadcastLogEntry(entry: any): void {
    if (this.sseClients.size === 0) return;
    const payload = `data: ${JSON.stringify(entry)}\n\n`;
    for (const client of this.sseClients) {
      try {
        client.write(payload);
      } catch {
        this.sseClients.delete(client);
      }
    }
  }

  private async readJsonBody(req: http.IncomingMessage): Promise<any> {
    return new Promise((resolve) => {
      let data = '';
      req.on('data', (chunk) => (data += chunk));
      req.on('end', () => {
        try {
          resolve(data ? JSON.parse(data) : {});
        } catch {
          resolve({});
        }
      });
    });
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url || '/', `http://127.0.0.1:${this.port}`);

    // Loopback-only security check
    const remoteIp = req.socket.remoteAddress;
    if (remoteIp !== '127.0.0.1' && remoteIp !== '::1' && remoteIp !== '::ffff:127.0.0.1') {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Access denied: loopback interface only' }));
      return;
    }

    // CORS for local loopback
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-ipc-token');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // 1. Health & Status Check
    if (url.pathname === '/api/status' && req.method === 'GET') {
      const freeMem = os.freemem();
      const totalMem = os.totalmem();
      const memoryUsage = Number((((totalMem - freeMem) / totalMem) * 100).toFixed(1));

      let cpuUsage = 0;
      const cpus = os.cpus();
      let totalIdle = 0, totalTick = 0;
      for (const cpu of cpus) {
        for (const type in cpu.times) {
          totalTick += (cpu.times as any)[type];
        }
        totalIdle += cpu.times.idle;
      }
      cpuUsage = totalTick > 0 ? Number((100 - (totalIdle / totalTick) * 100).toFixed(1)) : 0;

      const activeJobs = this.config.heartbeat ? this.config.heartbeat.getActiveJobs() : [];
      const desiredState = this.config.heartbeat ? this.config.heartbeat.getDesiredState() : 'STOPPED';

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: true,
          pid: process.pid,
          machineCode: this.config.machine.machineCode,
          machineName: this.config.machine.machineName,
          version: this.config.machine.version,
          backendUrl: process.env.API_BASE_URL || 'http://localhost:4000',
          paired: !!this.config.machine.machineToken,
          hasToken: !!this.config.machine.machineToken,
          desiredState,
          runtimeStatus: desiredState === 'STOPPED' ? 'STOPPED' : activeJobs.length > 0 ? 'BUSY' : 'IDLE',
          activeJobCount: activeJobs.length,
          activeJobIds: activeJobs,
          cpuUsage,
          memoryUsage,
          uptime: Math.floor(process.uptime()),
          logsDir: SanitizedLogger.getLogsDir(),
          credentialsPath: this.config.machine.credentialsPath,
        })
      );
      return;
    }

    // 2. Control Operations (Pause, Resume, Stop, Restart)
    if (url.pathname === '/api/control' && req.method === 'POST') {
      const body = await this.readJsonBody(req);
      const action = body.action;

      if (action === 'pause') {
        if (this.config.heartbeat) {
          this.config.heartbeat.setExecutionPermitted(false);
        }
        SanitizedLogger.info('[IPC] Worker paused via Control Center.');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, message: 'Worker job claims paused.' }));
        return;
      }

      if (action === 'resume') {
        if (this.config.heartbeat) {
          this.config.heartbeat.setExecutionPermitted(true);
        }
        SanitizedLogger.info('[IPC] Worker resumed via Control Center.');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, message: 'Worker execution resumed.' }));
        return;
      }

      if (action === 'stop') {
        SanitizedLogger.info('[IPC] Controlled worker shutdown requested via Control Center.');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, message: 'Worker is stopping gracefully...' }));

        setTimeout(() => {
          process.kill(process.pid, 'SIGTERM');
        }, 800);
        return;
      }

      if (action === 'restart') {
        SanitizedLogger.info('[IPC] Worker restart requested via Control Center.');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, message: 'Worker is restarting...' }));

        setTimeout(() => {
          process.exit(0);
        }, 800);
        return;
      }

      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Unknown action' }));
      return;
    }

    // 3. Historical Logs API
    if (url.pathname === '/api/logs' && req.method === 'GET') {
      const limit = parseInt(url.searchParams.get('limit') || '200', 10);
      const level = url.searchParams.get('level') || undefined;
      const search = url.searchParams.get('search') || undefined;

      const logs = SanitizedLogger.getRecentLogs(limit, level, search);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, logs }));
      return;
    }

    // 4. Real-time Live Log Stream (Server-Sent Events)
    if (url.pathname === '/api/logs/stream' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      // Send initial backlog
      const initialLogs = SanitizedLogger.getRecentLogs(50);
      for (const log of initialLogs) {
        res.write(`data: ${JSON.stringify(log)}\n\n`);
      }

      this.sseClients.add(res);
      req.on('close', () => {
        this.sseClients.delete(res);
      });
      return;
    }

    // 5. Test Backend Connectivity
    if (url.pathname === '/api/test-backend' && req.method === 'POST') {
      const body = await this.readJsonBody(req);
      const testUrl = (body.backendUrl || process.env.API_BASE_URL || 'http://localhost:4000').trim().replace(/\/+$/, '');

      try {
        const parsed = new URL(testUrl);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, message: 'Invalid URL scheme. Must start with http:// or https://' }));
          return;
        }

        const start = Date.now();
        const client = axios.create({ timeout: 10000 });
        await client.get(`${testUrl}/workers/summary`).catch(async (e) => {
          if (e.response && (e.response.status === 401 || e.response.status === 403 || e.response.status === 200)) {
            return e.response;
          }
          return await client.get(`${testUrl}/`);
        });

        const latencyMs = Date.now() - start;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            ok: true,
            message: `Successfully connected to backend (${latencyMs}ms)`,
            latencyMs,
            isHttps: parsed.protocol === 'https:',
          })
        );
      } catch (err: any) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            ok: false,
            message: `Connection failed: ${err.message || 'Host unreachable'}`,
          })
        );
      }
      return;
    }

    // 6. Update Server Settings (without wiping machine credentials)
    if (url.pathname === '/api/settings' && req.method === 'POST') {
      const body = await this.readJsonBody(req);
      if (body.backendUrl) {
        const newUrl = body.backendUrl.trim().replace(/\/+$/, '');
        process.env.API_BASE_URL = newUrl;
        SanitizedLogger.info(`[IPC] Backend URL updated to: ${newUrl}`);

        // Persist to .env in data directory
        const dataDir = process.env.PROGRAMDATA
          ? path.resolve(process.env.PROGRAMDATA, 'SEVATN', 'Worker')
          : process.cwd();
        const envPath = path.join(dataDir, '.env');
        try {
          fs.writeFileSync(envPath, `API_BASE_URL=${newUrl}\n`, { encoding: 'utf8', flag: 'w' });
        } catch {}
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, message: 'Settings saved successfully.' }));
      return;
    }

    // 7. Initiate Machine Pairing
    if (url.pathname === '/api/pair/initiate' && req.method === 'POST') {
      try {
        const reg = await this.config.apiClient.registerMachine(
          this.config.machine.machineCode,
          this.config.machine.machineName,
          this.config.machine.version
        );

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            ok: true,
            machineCode: reg.machineCode,
            pairingCode: reg.pairingCode,
            message: 'Pairing key generated successfully.',
          })
        );
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            ok: false,
            message: `Registration failed: ${err?.response?.data?.message || err.message}`,
          })
        );
      }
      return;
    }

    // 8. Poll Pairing Status
    if (url.pathname === '/api/pair/status' && req.method === 'GET') {
      try {
        const resCheck = await this.config.apiClient.checkPairingStatus(this.config.machine.machineCode);
        if (resCheck.paired && resCheck.machineToken) {
          this.config.machine.saveCredentials(resCheck.machineToken);
          this.config.apiClient.setToken(resCheck.machineToken);
          if (this.config.heartbeat) {
            this.config.heartbeat.setExecutionPermitted(true);
            this.config.heartbeat.sendImmediate().catch(() => {});
          }
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ paired: resCheck.paired, machineToken: resCheck.machineToken }));
      } catch (err: any) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ paired: false, error: err.message }));
      }
      return;
    }

    // 9. Open Folders in Windows Explorer
    if (url.pathname === '/api/open-folder' && req.method === 'POST') {
      const body = await this.readJsonBody(req);
      const target = body.target === 'install' ? path.resolve(process.cwd()) : SanitizedLogger.getLogsDir();

      exec(`explorer.exe "${target}"`, () => {});
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, path: target }));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Endpoint not found' }));
  }
}
