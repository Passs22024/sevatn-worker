import * as http from 'http';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { exec, spawn } from 'child_process';
import axios from 'axios';
import { ApiClient } from '../api/client';
import { MachineIdentity } from '../machine/identity';
import { resolveChromiumPath } from '../browser/browser-manager';
import { SanitizedLogger } from '../monitoring/logger';

interface WizardState {
  backendUrl: string;
  machineCode: string;
  machineName: string;
  version: string;
  pairingCode: string | null;
  paired: boolean;
  machineToken: string | null;
  serviceInstalled: boolean;
  isRegistered: boolean;
  autoStartService: boolean;
}

export class SetupWizard {
  private server: http.Server | null = null;
  private port: number = 48291;
  private state: WizardState;
  private identity: MachineIdentity;

  constructor() {
    this.identity = new MachineIdentity();
    const defaultBackend = (process.env.API_BASE_URL || 'http://localhost:4000').replace(/\/+$/, '');

    this.state = {
      backendUrl: defaultBackend,
      machineCode: this.identity.machineCode,
      machineName: this.identity.machineName,
      version: this.identity.version,
      pairingCode: null,
      paired: !!this.identity.machineToken,
      machineToken: this.identity.machineToken,
      serviceInstalled: false,
      isRegistered: false,
      autoStartService: true,
    };
  }

  public async start(): Promise<void> {
    const isCli = process.argv.includes('--cli') || process.argv.includes('--headless');

    if (isCli) {
      await this.runCliSetup();
      return;
    }

    await this.startHttpServer();
    this.launchBrowserWindow();
  }

  private async startHttpServer(): Promise<void> {
    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => {
        this.handleHttpRequest(req, res).catch((err) => {
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message || 'Setup wizard server error' }));
          }
        });
      });

      const tryListen = (currentPort: number) => {
        this.server!.listen(currentPort, '127.0.0.1', () => {
          this.port = currentPort;
          console.log(`[SEVATN Setup] Local setup wizard active at: http://127.0.0.1:${this.port}`);
          resolve();
        });

        this.server!.once('error', (err: any) => {
          if (err.code === 'EADDRINUSE') {
            tryListen(currentPort + 1);
          } else {
            console.error('[SEVATN Setup] HTTP server error:', err);
          }
        });
      };

      tryListen(this.port);
    });
  }

  private async handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url || '/', `http://127.0.0.1:${this.port}`);

    // Loopback only
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (url.pathname === '/' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(this.getHtmlInterface());
      return;
    }

    if (url.pathname === '/api/state' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(this.state));
      return;
    }

    if (url.pathname === '/api/test-backend' && req.method === 'POST') {
      const body = await this.readJsonBody(req);
      const testUrl = (body.backendUrl || '').trim().replace(/\/+$/, '');
      const result = await this.testBackendConnectivity(testUrl);
      if (result.ok) {
        this.state.backendUrl = testUrl;
        process.env.API_BASE_URL = testUrl;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }

    if (url.pathname === '/api/request-pairing' && req.method === 'POST') {
      const body = await this.readJsonBody(req);
      if (body.backendUrl) this.state.backendUrl = body.backendUrl.trim().replace(/\/+$/, '');
      if (body.machineCode) this.state.machineCode = body.machineCode.trim();
      if (body.machineName) this.state.machineName = body.machineName.trim();

      const result = await this.initiateBackendPairing();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }

    if (url.pathname === '/api/poll-status' && req.method === 'GET') {
      const status = await this.pollPairingStatus();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(status));
      return;
    }

    if (url.pathname === '/api/install-service' && req.method === 'POST') {
      const result = await this.registerWindowsService();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }

    // Launch Control Center and finish setup
    if (url.pathname === '/api/launch-control-center' && req.method === 'POST') {
      const installDir = path.resolve(process.cwd());
      const ccBat = path.resolve(installDir, 'sevatn-control-center.bat');

      if (fs.existsSync(ccBat)) {
        exec(`start "" "${ccBat}"`, { cwd: installDir });
      } else {
        const nodeExe = path.resolve(installDir, 'runtime', 'node.exe');
        const ccScript = path.resolve(installDir, 'dist', 'control-center', 'index.js');
        exec(`"${fs.existsSync(nodeExe) ? nodeExe : 'node'}" "${ccScript}"`, { cwd: installDir });
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, message: 'Launching SEVATN Worker Control Center...' }));

      setTimeout(() => {
        this.server?.close();
        process.exit(0);
      }, 1000);
      return;
    }

    // Launch Console Terminal
    if (url.pathname === '/api/launch-worker-console' && req.method === 'POST') {
      const installDir = path.resolve(process.cwd());
      const workerBat = path.resolve(installDir, 'sevatn-worker.bat');

      if (fs.existsSync(workerBat)) {
        exec(`start "" "${workerBat}"`, { cwd: installDir });
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // Explicit exit/finish
    if (url.pathname === '/api/finish' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, message: 'Setup completed.' }));

      setTimeout(() => {
        this.server?.close();
        process.exit(0);
      }, 1000);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Endpoint not found' }));
  }

  private readJsonBody(req: http.IncomingMessage): Promise<any> {
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

  private async testBackendConnectivity(urlStr: string): Promise<{ ok: boolean; message: string; isHttps?: boolean; latencyMs?: number }> {
    try {
      const parsed = new URL(urlStr);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { ok: false, message: 'Invalid URL scheme. Must start with http:// or https://' };
      }

      const start = Date.now();
      const client = axios.create({ timeout: 10000 });
      await client.get(`${urlStr}/workers/summary`).catch(async (e) => {
        if (e.response && (e.response.status === 401 || e.response.status === 403 || e.response.status === 200)) {
          return e.response;
        }
        return await client.get(`${urlStr}/`);
      });

      const latencyMs = Date.now() - start;
      return {
        ok: true,
        message: `Successfully connected to SEVATN Backend (${latencyMs}ms)`,
        isHttps: parsed.protocol === 'https:',
        latencyMs,
      };
    } catch (err: any) {
      return {
        ok: false,
        message: `Backend connection failed: ${err.message || 'Host unreachable'}. Verify API server is running.`,
      };
    }
  }

  private async initiateBackendPairing(): Promise<{ ok: boolean; pairingCode?: string; machineCode?: string; message: string }> {
    try {
      const apiClient = new ApiClient(this.state.backendUrl);
      const reg = await apiClient.registerMachine(
        this.state.machineCode,
        this.state.machineName,
        this.state.version
      );

      this.state.pairingCode = reg.pairingCode;
      this.state.isRegistered = true;
      return {
        ok: true,
        pairingCode: reg.pairingCode,
        machineCode: reg.machineCode,
        message: 'Pairing key generated successfully.',
      };
    } catch (err: any) {
      return {
        ok: false,
        message: `Failed to register with backend: ${err?.response?.data?.message || err.message}`,
      };
    }
  }

  private async pollPairingStatus(): Promise<{ paired: boolean; machineToken?: string }> {
    if (!this.state.machineCode) {
      return { paired: false };
    }

    try {
      const apiClient = new ApiClient(this.state.backendUrl);
      const res = await apiClient.checkPairingStatus(this.state.machineCode);
      if (res.paired && res.machineToken) {
        this.state.paired = true;
        this.state.machineToken = res.machineToken;
        this.identity.saveCredentials(res.machineToken);
        return { paired: true, machineToken: res.machineToken };
      }
    } catch {}

    return { paired: false };
  }

  private async registerWindowsService(): Promise<{ ok: boolean; message: string }> {
    return new Promise((resolve) => {
      const installDir = path.resolve(process.cwd());
      const runnerBat = path.resolve(installDir, 'sevatn-worker.bat');

      // Register Scheduled Task to auto-run at Windows startup
      const cmd = `schtasks /create /tn "SEVATN Worker" /tr "\\"${runnerBat}\\"" /sc onstart /ru SYSTEM /rl HIGHEST /f`;

      exec(cmd, (err, stdout, stderr) => {
        if (err) {
          const userCmd = `schtasks /create /tn "SEVATN Worker" /tr "\\"${runnerBat}\\"" /sc onlogon /rl HIGHEST /f`;
          exec(userCmd, (userErr) => {
            if (userErr) {
              resolve({
                ok: false,
                message: `Could not register task: ${stderr || userErr.message}. You can run sevatn-worker.bat manually.`,
              });
            } else {
              this.state.serviceInstalled = true;
              resolve({
                ok: true,
                message: 'SEVATN Worker registered for automatic Windows logon startup.',
              });
            }
          });
        } else {
          this.state.serviceInstalled = true;
          resolve({
            ok: true,
            message: 'SEVATN Worker registered as a high-privilege Windows background service.',
          });
        }
      });
    });
  }

  private launchBrowserWindow(): void {
    const targetUrl = `http://127.0.0.1:${this.port}`;
    const chromiumPath = resolveChromiumPath();

    if (chromiumPath && fs.existsSync(chromiumPath)) {
      console.log(`[SEVATN Setup] Launching dedicated setup window using bundled Chromium...`);
      const child = spawn(
        chromiumPath,
        [
          `--app=${targetUrl}`,
          '--window-size=740,820',
          '--disable-extensions',
          '--no-first-run',
          '--disable-default-apps',
        ],
        { detached: true, stdio: 'ignore' }
      );
      child.unref();
    } else {
      console.log(`[SEVATN Setup] Opening setup interface in default browser: ${targetUrl}`);
      exec(`start ${targetUrl}`);
    }
  }

  private async runCliSetup(): Promise<void> {
    console.log('=======================================================');
    console.log('⚡ SEVATN WORKER SETUP (CLI MODE)');
    console.log('=======================================================');
    console.log(`Machine Code : ${this.state.machineCode}`);
    console.log(`Backend URL  : ${this.state.backendUrl}`);
    console.log('───────────────────────────────────────────────────────');

    const apiClient = new ApiClient(this.state.backendUrl);
    await this.identity.ensurePaired(apiClient);
  }

  private getHtmlInterface(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>SEVATN Worker — Setup &amp; Pairing Wizard</title>
  <style>
    :root {
      --bg: #0f172a;
      --card-bg: #1e293b;
      --card-border: #334155;
      --accent: #3b82f6;
      --accent-hover: #2563eb;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --success: #10b981;
      --error: #ef4444;
      --warning: #f59e0b;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; user-select: none; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 24px;
    }

    .container {
      width: 100%;
      max-width: 620px;
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 14px;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.4);
      overflow: hidden;
    }

    .header {
      padding: 22px 28px;
      background: linear-gradient(135deg, rgba(37, 99, 235, 0.2), rgba(30, 41, 59, 0.9));
      border-bottom: 1px solid var(--card-border);
      display: flex;
      align-items: center;
      gap: 14px;
    }

    .logo-badge {
      width: 40px;
      height: 40px;
      background: var(--accent);
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
      font-weight: bold;
      box-shadow: 0 4px 12px rgba(59, 130, 246, 0.35);
    }

    .header-text h1 { font-size: 16px; font-weight: 800; letter-spacing: 0.5px; }
    .header-text p { font-size: 11px; color: var(--text-muted); }

    .stepper {
      display: flex;
      border-bottom: 1px solid var(--card-border);
      background: rgba(15, 23, 42, 0.5);
    }

    .step-item {
      flex: 1;
      padding: 10px 8px;
      text-align: center;
      font-size: 11px;
      font-weight: 600;
      color: var(--text-muted);
      border-bottom: 2px solid transparent;
      transition: all 0.2s;
    }

    .step-item.active {
      color: #60a5fa;
      border-bottom-color: var(--accent);
      background: rgba(59, 130, 246, 0.05);
    }

    .step-item.completed { color: var(--success); }

    .content { padding: 24px 28px; }

    .form-group { margin-bottom: 18px; }
    .form-label { display: block; font-size: 11.5px; font-weight: 600; color: var(--text-muted); margin-bottom: 6px; }

    .form-input {
      width: 100%;
      padding: 10px 14px;
      background: #0f172a;
      border: 1px solid var(--card-border);
      border-radius: 7px;
      color: var(--text);
      font-size: 13px;
      font-family: ui-monospace, monospace;
      outline: none;
    }

    .form-input:focus { border-color: var(--accent); box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.25); }

    .code-box {
      font-family: ui-monospace, monospace;
      font-size: 32px;
      font-weight: 900;
      letter-spacing: 6px;
      color: #60a5fa;
      background: #0b0f19;
      border: 1px dashed rgba(96, 165, 250, 0.4);
      padding: 16px;
      border-radius: 8px;
      text-align: center;
      margin: 16px 0;
      user-select: text;
    }

    .btn {
      padding: 9px 18px;
      border-radius: 7px;
      font-size: 12px;
      font-weight: 600;
      border: none;
      cursor: pointer;
      transition: all 0.15s ease;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      text-decoration: none;
    }

    .btn-primary { background: var(--accent); color: white; }
    .btn-primary:hover { background: var(--accent-hover); }
    .btn-success { background: #059669; color: white; }
    .btn-success:hover { background: var(--success); }
    .btn-secondary { background: var(--card-border); color: var(--text); }
    .btn-secondary:hover { background: #475569; }

    .alert {
      padding: 10px 14px;
      border-radius: 6px;
      font-size: 11.5px;
      margin-bottom: 16px;
      display: none;
    }

    .alert-success { background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); }
    .alert-error { background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); }

    .footer {
      padding: 16px 28px;
      background: rgba(15, 23, 42, 0.6);
      border-top: 1px solid var(--card-border);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
  </style>
</head>
<body>

  <div class="container">
    <div class="header">
      <div class="logo-badge">⚡</div>
      <div class="header-text">
        <h1>SEVATN Worker Setup Wizard</h1>
        <p>First-Run Machine Registration &amp; Cloud Pairing</p>
      </div>
    </div>

    <div class="stepper">
      <div id="step-nav-1" class="step-item active">1. Server URL</div>
      <div id="step-nav-2" class="step-item">2. Machine Pairing</div>
      <div id="step-nav-3" class="step-item">3. Service Config</div>
      <div id="step-nav-4" class="step-item">4. Complete</div>
    </div>

    <div class="content">
      <div id="alert-box" class="alert"></div>

      <!-- Step 1: Server URL -->
      <div id="step-1">
        <h2 style="font-size:14px; font-weight:700; margin-bottom:6px;">Connect to SEVATN Platform</h2>
        <p style="font-size:11.5px; color:var(--text-muted); margin-bottom:18px;">
          Specify the API base URL of your TicketAssist / SEVATN cloud or local server.
        </p>

        <div class="form-group">
          <label class="form-label">Backend API URL</label>
          <input type="text" id="inp-backend-url" class="form-input" value="${this.state.backendUrl}">
          <p style="font-size:10.5px; color:var(--text-muted); margin-top:5px;">
            Example: <code>http://localhost:4000</code> or your cloud devtunnel URL.
          </p>
        </div>

        <button class="btn btn-secondary" onclick="testConnection()">🧪 Test Connection</button>
      </div>

      <!-- Step 2: Machine Pairing -->
      <div id="step-2" style="display:none;">
        <h2 style="font-size:14px; font-weight:700; margin-bottom:6px;">Pair Machine with Super Admin</h2>
        <p style="font-size:11.5px; color:var(--text-muted); margin-bottom:14px;">
          This node requires one-time cryptographic pairing authorization from <code>/admin/fleet</code>.
        </p>

        <div style="background:#0f172a; padding:10px 14px; border-radius:6px; border:1px solid var(--card-border); margin-bottom:14px;">
          <p style="font-size:10.5px; color:var(--text-muted);">Unique Machine Identifier:</p>
          <p style="font-size:16px; font-weight:800; font-family:ui-monospace; color:#38bdf8;" id="txt-machine-code">${this.state.machineCode}</p>
        </div>

        <div id="box-pairing-ready" style="display:none;">
          <p style="font-size:11px; color:var(--text-muted); text-align:center;">Enter this 15-minute Pairing Key on /admin/fleet:</p>
          <div id="display-pairing-code" class="code-box">------</div>
          <p style="font-size:11px; color:#fbbf24; text-align:center;" id="poll-indicator">
            ⏳ Waiting for Super Admin approval on /admin/fleet...
          </p>
        </div>

        <button id="btn-request-pair" class="btn btn-primary" onclick="requestPairing()">
          Generate Pairing Code
        </button>
      </div>

      <!-- Step 3: Windows Service -->
      <div id="step-3" style="display:none;">
        <h2 style="font-size:14px; font-weight:700; margin-bottom:6px;">Background Service Registration</h2>
        <p style="font-size:11.5px; color:var(--text-muted); margin-bottom:18px;">
          Configure whether SEVATN Worker starts automatically with Windows.
        </p>

        <div style="background:#0f172a; padding:14px; border-radius:8px; border:1px solid var(--card-border); margin-bottom:16px;">
          <label style="display:flex; align-items:flex-start; gap:10px; cursor:pointer;">
            <input type="checkbox" id="chk-auto-service" checked style="margin-top:2px;">
            <div>
              <p style="font-weight:700; font-size:12.5px;">Register as Automatic Windows Background Service</p>
              <p style="font-size:11px; color:var(--text-muted); margin-top:2px;">
                Worker will auto-start with Windows and recover execution leases safely on reboot.
              </p>
            </div>
          </label>
        </div>
      </div>

      <!-- Step 4: Completion -->
      <div id="step-4" style="display:none; text-align:center;">
        <div style="font-size:42px; margin-bottom:12px;">🎉</div>
        <h2 style="font-size:16px; font-weight:800; color:#34d399; margin-bottom:6px;">Setup &amp; Pairing Completed!</h2>
        <p style="font-size:12px; color:var(--text-muted); margin-bottom:20px;">
          Your SEVATN Worker machine is fully authenticated, persistent, and ready for job allocation.
        </p>

        <div style="background:#0f172a; padding:14px; border-radius:8px; border:1px solid var(--card-border); text-align:left; margin-bottom:20px; font-size:12px;">
          <p><strong>Machine:</strong> <span id="summary-code" style="font-family:ui-monospace; color:#38bdf8;">${this.state.machineCode}</span></p>
          <p style="margin-top:4px;"><strong>Endpoint:</strong> <span id="summary-url" style="font-family:ui-monospace;">${this.state.backendUrl}</span></p>
          <p style="margin-top:4px;"><strong>Status:</strong> <span style="color:#34d399; font-weight:bold;">Verified &amp; Paired</span></p>
        </div>

        <div style="display:flex; flex-direction:column; gap:10px; max-width:320px; margin:0 auto;">
          <button class="btn btn-success" style="justify-content:center; padding:12px;" onclick="launchControlCenter()">
            🚀 Launch Worker Control Center
          </button>
          <button class="btn btn-secondary" style="justify-content:center;" onclick="launchConsole()">
            📟 Open Worker Console (Terminal)
          </button>
        </div>
      </div>
    </div>

    <div class="footer">
      <button id="btn-back" class="btn btn-secondary" style="display:none;" onclick="prevStep()">Back</button>
      <div></div>
      <button id="btn-next" class="btn btn-primary" onclick="nextStep()">Next &rarr;</button>
    </div>
  </div>

  <script>
    let currentStep = 1;
    let pollInterval = null;

    function showAlert(msg, isError = false) {
      const box = document.getElementById('alert-box');
      box.style.display = 'block';
      box.className = 'alert ' + (isError ? 'alert-error' : 'alert-success');
      box.innerText = msg;
    }

    function hideAlert() {
      document.getElementById('alert-box').style.display = 'none';
    }

    async function testConnection() {
      hideAlert();
      const url = document.getElementById('inp-backend-url').value.trim();
      try {
        const res = await fetch('/api/test-backend', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ backendUrl: url }),
        });
        const data = await res.json();
        if (data.ok) {
          showAlert(data.message + ' (Latency: ' + data.latencyMs + 'ms)');
        } else {
          showAlert(data.message, true);
        }
      } catch (err) {
        showAlert('Could not test connection: ' + err.message, true);
      }
    }

    async function requestPairing() {
      hideAlert();
      const url = document.getElementById('inp-backend-url').value.trim();
      const btn = document.getElementById('btn-request-pair');
      btn.disabled = true;
      btn.innerText = 'Registering with backend...';

      try {
        const res = await fetch('/api/request-pairing', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ backendUrl: url }),
        });
        const data = await res.json();
        if (data.ok && data.pairingCode) {
          document.getElementById('box-pairing-ready').style.display = 'block';
          document.getElementById('display-pairing-code').innerText = data.pairingCode;
          btn.style.display = 'none';
          showAlert('Pairing code generated! Enter this code on /admin/fleet.');

          if (pollInterval) clearInterval(pollInterval);
          pollInterval = setInterval(checkPairingStatus, 3000);
        } else {
          showAlert(data.message || 'Pairing request failed.', true);
          btn.disabled = false;
          btn.innerText = 'Generate Pairing Code';
        }
      } catch (err) {
        showAlert('Pairing error: ' + err.message, true);
        btn.disabled = false;
        btn.innerText = 'Generate Pairing Code';
      }
    }

    async function checkPairingStatus() {
      try {
        const res = await fetch('/api/poll-status');
        const data = await res.json();
        if (data.paired) {
          clearInterval(pollInterval);
          pollInterval = null;
          showAlert('✅ Registration approved by Super Admin!');
          setTimeout(() => { goToStep(3); }, 1000);
        }
      } catch {}
    }

    function goToStep(step) {
      currentStep = step;
      hideAlert();
      for (let i = 1; i <= 4; i++) {
        document.getElementById('step-' + i).style.display = (i === step) ? 'block' : 'none';
        const nav = document.getElementById('step-nav-' + i);
        nav.classList.remove('active');
        if (i < step) nav.classList.add('completed');
        if (i === step) nav.classList.add('active');
      }

      document.getElementById('btn-back').style.display = (step > 1 && step < 4) ? 'inline-flex' : 'none';
      document.getElementById('btn-next').style.display = (step < 4) ? 'inline-flex' : 'none';

      if (step === 4) {
        document.getElementById('summary-url').innerText = document.getElementById('inp-backend-url').value;
      }
    }

    function nextStep() {
      if (currentStep === 1) {
        goToStep(2);
      } else if (currentStep === 2) {
        goToStep(3);
      } else if (currentStep === 3) {
        const autoService = document.getElementById('chk-auto-service').checked;
        if (autoService) {
          fetch('/api/install-service', { method: 'POST' }).catch(() => {});
        }
        goToStep(4);
      }
    }

    function prevStep() {
      if (currentStep > 1) {
        goToStep(currentStep - 1);
      }
    }

    async function launchControlCenter() {
      try {
        await fetch('/api/launch-control-center', { method: 'POST' });
      } catch {}
    }

    async function launchConsole() {
      try {
        await fetch('/api/launch-worker-console', { method: 'POST' });
      } catch {}
    }
  </script>
</body>
</html>`;
  }
}

if (require.main === module) {
  const wizard = new SetupWizard();
  wizard.start().catch((err) => {
    console.error('[SEVATN Setup] Wizard fatal error:', err);
    process.exit(1);
  });
}
