import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { exec, spawn } from 'child_process';
import axios from 'axios';
import { resolveChromiumPath } from '../browser/browser-manager';
import { MachineIdentity } from '../machine/identity';
import { ApiClient } from '../api/client';
import { getControlCenterHtml } from './ui';
import { SanitizedLogger } from '../monitoring/logger';

export class ControlCenterApp {
  private server: http.Server | null = null;
  private port: number = 48290;
  private workerIpcPort: number = 48292;
  private identity: MachineIdentity;

  constructor() {
    this.identity = new MachineIdentity();
    this.detectWorkerIpc();
  }

  private detectWorkerIpc(): void {
    try {
      const dataDir = process.env.PROGRAMDATA
        ? path.resolve(process.env.PROGRAMDATA, 'SEVATN', 'Worker')
        : path.resolve(process.cwd(), '.sevatn');

      const ipcFile = path.join(dataDir, 'worker-ipc.json');
      if (fs.existsSync(ipcFile)) {
        const raw = fs.readFileSync(ipcFile, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && parsed.port) {
          this.workerIpcPort = parsed.port;
        }
      }
    } catch {}
  }

  public async start(): Promise<void> {
    await this.startHttpServer();
    this.launchDesktopWindow();
  }

  private async startHttpServer(): Promise<void> {
    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res).catch((err) => {
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message || 'Control Center server error' }));
          }
        });
      });

      const tryListen = (currentPort: number) => {
        this.server!.listen(currentPort, '127.0.0.1', () => {
          this.port = currentPort;
          console.log(`[SEVATN Control Center] Desktop server listening at http://127.0.0.1:${this.port}`);
          resolve();
        });

        this.server!.once('error', (err: any) => {
          if (err.code === 'EADDRINUSE') {
            tryListen(currentPort + 1);
          } else {
            console.error('[SEVATN Control Center] Server error:', err);
          }
        });
      };

      tryListen(this.port);
    });
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

    // Loopback-only security
    const remoteIp = req.socket.remoteAddress;
    if (remoteIp !== '127.0.0.1' && remoteIp !== '::1' && remoteIp !== '::ffff:127.0.0.1') {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Access denied' }));
      return;
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Serve Desktop UI HTML
    if (url.pathname === '/' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(getControlCenterHtml());
      return;
    }

    // 1. Worker Status (Proxies to worker IPC or falls back to offline disk inspection)
    if (url.pathname === '/api/worker-status' && req.method === 'GET') {
      this.detectWorkerIpc();
      try {
        const ipcRes = await axios.get(`http://127.0.0.1:${this.workerIpcPort}/api/status`, { timeout: 1500 });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(ipcRes.data));
        return;
      } catch {
        // Worker daemon is stopped or not running
        this.identity.loadPersistedCredentials();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            ok: true,
            isOnline: false,
            pid: null,
            machineCode: this.identity.machineCode,
            machineName: this.identity.machineName,
            version: this.identity.version,
            backendUrl: process.env.API_BASE_URL || 'http://localhost:4000',
            paired: !!this.identity.machineToken,
            hasToken: !!this.identity.machineToken,
            desiredState: 'STOPPED',
            runtimeStatus: 'STOPPED',
            activityDetails: 'Worker daemon is not currently active',
            activeJobCount: 0,
            activeJobIds: [],
            cpuUsage: 0,
            memoryUsage: 0,
          })
        );
        return;
      }
    }

    // 2. Control Operations
    if (url.pathname === '/api/worker-control' && req.method === 'POST') {
      const body = await this.readJsonBody(req);
      const action = body.action;
      this.detectWorkerIpc();

      if (action === 'resume' || action === 'start') {
        // Try worker IPC first
        try {
          const ipcRes = await axios.post(`http://127.0.0.1:${this.workerIpcPort}/api/control`, { action }, { timeout: 2000 });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(ipcRes.data));
          return;
        } catch {
          // Worker is not running: spawn worker process in background or start task
          this.spawnWorkerBackground();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, message: 'Worker process launched.' }));
          return;
        }
      }

      // Forward stop/pause/restart to worker IPC
      try {
        const ipcRes = await axios.post(`http://127.0.0.1:${this.workerIpcPort}/api/control`, { action }, { timeout: 3000 });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(ipcRes.data));
      } catch (err: any) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Worker is not running or unreachable' }));
      }
      return;
    }

    // 3. Live Logs Streaming (SSE Proxy)
    if (url.pathname === '/api/logs/stream' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      this.detectWorkerIpc();

      // Connect to Worker IPC SSE stream
      try {
        const sseClient = http.get(`http://127.0.0.1:${this.workerIpcPort}/api/logs/stream`, (ipcStream) => {
          ipcStream.on('data', (chunk) => {
            try { res.write(chunk); } catch {}
          });
          ipcStream.on('end', () => {
            try { res.end(); } catch {}
          });
        });

        sseClient.on('error', () => {
          // Send notice if worker offline
          const fallbackEntry = {
            id: 0,
            timestamp: new Date().toISOString(),
            level: 'WARN',
            message: '[Control Center] Worker daemon is currently offline. Logs will stream when worker starts.',
          };
          res.write(`data: ${JSON.stringify(fallbackEntry)}\n\n`);
        });

        req.on('close', () => {
          sseClient.destroy();
        });
      } catch {
        res.end();
      }
      return;
    }

    // 4. Test Backend Connectivity
    if (url.pathname === '/api/test-backend' && req.method === 'POST') {
      const body = await this.readJsonBody(req);
      const testUrl = (body.backendUrl || process.env.API_BASE_URL || 'http://localhost:4000').trim().replace(/\/+$/, '');

      try {
        const parsed = new URL(testUrl);
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
            message: `Successfully connected to SEVATN Backend (${latencyMs}ms)`,
            latencyMs,
            isHttps: parsed.protocol === 'https:',
          })
        );
      } catch (err: any) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            ok: false,
            message: `Connection failed: ${err.message || 'Backend unreachable'}`,
          })
        );
      }
      return;
    }

    // 5. Save Settings
    if (url.pathname === '/api/save-settings' && req.method === 'POST') {
      const body = await this.readJsonBody(req);
      if (body.backendUrl) {
        const newUrl = body.backendUrl.trim().replace(/\/+$/, '');
        process.env.API_BASE_URL = newUrl;

        // Persist to .env
        const dataDir = process.env.PROGRAMDATA
          ? path.resolve(process.env.PROGRAMDATA, 'SEVATN', 'Worker')
          : process.cwd();
        const envPath = path.join(dataDir, '.env');
        try {
          fs.writeFileSync(envPath, `API_BASE_URL=${newUrl}\n`, 'utf8');
        } catch {}

        // Forward to worker IPC if running
        try {
          await axios.post(`http://127.0.0.1:${this.workerIpcPort}/api/settings`, { backendUrl: newUrl });
        } catch {}
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // 6. Initiate Pairing
    if (url.pathname === '/api/initiate-pairing' && req.method === 'POST') {
      try {
        const backendUrl = process.env.API_BASE_URL || 'http://localhost:4000';
        const client = new ApiClient(backendUrl);
        const reg = await client.registerMachine(
          this.identity.machineCode,
          this.identity.machineName,
          this.identity.version
        );

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            ok: true,
            pairingCode: reg.pairingCode,
            machineCode: reg.machineCode,
          })
        );
      } catch (err: any) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            ok: false,
            message: err?.response?.data?.message || err.message,
          })
        );
      }
      return;
    }

    // 7. Poll Pairing Status
    if (url.pathname === '/api/poll-pairing' && req.method === 'GET') {
      try {
        const backendUrl = process.env.API_BASE_URL || 'http://localhost:4000';
        const client = new ApiClient(backendUrl);
        const resCheck = await client.checkPairingStatus(this.identity.machineCode);

        if (resCheck.paired && resCheck.machineToken) {
          this.identity.saveCredentials(resCheck.machineToken);
          // If worker IPC is running, notify it
          try {
            await axios.get(`http://127.0.0.1:${this.workerIpcPort}/api/pair/status`);
          } catch {}
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ paired: resCheck.paired }));
      } catch (err: any) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ paired: false }));
      }
      return;
    }

    // 8. Open Folder in Explorer
    if (url.pathname === '/api/open-folder' && req.method === 'POST') {
      const body = await this.readJsonBody(req);
      const target = body.target === 'install' ? path.resolve(process.cwd()) : SanitizedLogger.getLogsDir();

      exec(`explorer.exe "${target}"`, () => {});
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Endpoint not found' }));
  }

  private spawnWorkerBackground(): void {
    const installDir = path.resolve(process.cwd());
    const workerBat = path.resolve(installDir, 'sevatn-worker.bat');

    if (fs.existsSync(workerBat)) {
      // Spawn persistent console window
      exec(`start "" "${workerBat}"`, { cwd: installDir });
    } else {
      // Fallback
      exec(`node "${path.resolve(installDir, 'dist', 'index.js')}"`, { cwd: installDir });
    }
  }

  private launchDesktopWindow(): void {
    const targetUrl = `http://127.0.0.1:${this.port}`;
    const chromiumPath = resolveChromiumPath();

    const profileDir = path.resolve(
      process.env.LOCALAPPDATA || process.cwd(),
      'SEVATN',
      'Worker',
      'control-center-profile'
    );

    if (chromiumPath && fs.existsSync(chromiumPath)) {
      console.log(`[SEVATN Control Center] Launching native window via bundled Chromium...`);
      const child = spawn(
        chromiumPath,
        [
          `--app=${targetUrl}`,
          '--window-size=1120,780',
          '--disable-extensions',
          '--no-first-run',
          '--disable-default-apps',
          `--user-data-dir=${profileDir}`,
        ],
        { detached: true, stdio: 'ignore' }
      );
      child.unref();
    } else {
      console.log(`[SEVATN Control Center] Opening Control Center in default browser: ${targetUrl}`);
      exec(`start ${targetUrl}`);
    }
  }
}

// Direct execution entry point
if (require.main === module) {
  const app = new ControlCenterApp();
  app.start().catch((err) => {
    console.error('[SEVATN Control Center] Fatal error:', err);
    process.exit(1);
  });
}
