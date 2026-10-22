import { ApiClient } from './api/client';
import { MachineIdentity } from './machine/identity';
import { HeartbeatService } from './heartbeat/heartbeat';
import { WorkerOrchestrator } from './worker/orchestrator';
import { BrowserManager } from './browser/browser-manager';
import { SanitizedLogger } from './monitoring/logger';
import { IpcServer } from './ipc/ipc-server';
import * as dotenv from 'dotenv';
dotenv.config();

// Initialize persistent rotated disk logging
SanitizedLogger.initLogFile();

// Trap uncaught exceptions and rejections without silent auto-closing
process.on('uncaughtException', (err) => {
  SanitizedLogger.error('FATAL UNCAUGHT RUNTIME EXCEPTION:', err);
  console.error('\n=======================================================');
  console.error('❌ SEVATN WORKER FATAL ERROR:');
  console.error(err.message || err);
  console.error(`Logs recorded in: ${SanitizedLogger.getLogsDir()}`);
  console.error('=======================================================\n');
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  SanitizedLogger.error('UNHANDLED ASYNC PROMISE REJECTION:', reason);
});

async function bootstrap() {
  const isService = process.argv.includes('--service') || process.argv.includes('--headless');
  const isInteractive = process.stdin.isTTY && !isService;

  console.log('=======================================================');
  console.log('⚡ SEVATN WORKER ENGINE INITIALIZING');
  console.log(`Role: Local Distributed Worker Machine Node`);
  console.log(`Mode: ${isService ? 'Windows Background Service / Headless' : 'Console Interactive'}`);
  console.log(`Logs: ${SanitizedLogger.getLogsDir()}`);
  console.log('=======================================================');

  const backendUrl = (process.env.API_BASE_URL || 'http://localhost:4000').replace(/\/+$/, '');
  const apiClient = new ApiClient(backendUrl);
  const machine = new MachineIdentity();

  // 1. Initialize Heartbeat Service early so IPC can reflect state
  const heartbeatInterval = parseInt(process.env.HEARTBEAT_INTERVAL_MS || '10000', 10);
  const heartbeat = new HeartbeatService(apiClient, machine.version);

  // 2. Start IPC Local Management Server for Control Center connectivity
  const ipc = new IpcServer({
    machine,
    heartbeat,
    apiClient,
  });

  try {
    await ipc.start();
  } catch (err: any) {
    SanitizedLogger.warn(`[IPC] Failed to start management IPC server: ${err.message}`);
  }

  // 3. Ensure Machine is Paired and has Valid Machine Token
  let isPaired = !!machine.machineToken;

  if (isPaired) {
    apiClient.setToken(machine.machineToken!);
    try {
      const check = await apiClient.checkPairingStatus(machine.machineCode);
      if (check.paired) {
        SanitizedLogger.info(`[Machine] Reconnected: ${machine.machineCode} is registered and verified.`);
      }
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 401 || status === 403 || status === 404) {
        SanitizedLogger.warn(`[Machine] Worker token revoked or unauthenticated for ${machine.machineCode}. Re-pairing required.`);
        isPaired = false;
        machine.machineToken = null;
      } else {
        SanitizedLogger.warn(`[Machine] Backend unreachable during startup status check. Proceeding in offline retry mode...`);
      }
    }
  }

  // If un-paired: handle interactive vs service/standby mode
  if (!isPaired) {
    if (!isInteractive) {
      SanitizedLogger.warn('=======================================================');
      SanitizedLogger.warn('⚠️ SEVATN WORKER IS NOT YET PAIRED WITH BACKEND');
      SanitizedLogger.warn(`Machine Code : ${machine.machineCode}`);
      SanitizedLogger.warn(`Display Name : ${machine.machineName}`);
      SanitizedLogger.warn(`Backend URL  : ${backendUrl}`);
      SanitizedLogger.warn('-------------------------------------------------------');
      SanitizedLogger.warn('Worker entering standby state. Awaiting pairing from:');
      SanitizedLogger.warn('  1. SEVATN Worker Control Center');
      SanitizedLogger.warn('  2. First-Run Setup & Pairing Wizard (sevatn-setup.bat)');
      SanitizedLogger.warn('=======================================================');
      heartbeat.setStatus('OFFLINE');
    } else {
      console.log('\n[Worker] Unconfigured machine detected. Initiating interactive pairing sequence...');
      const pairedOk = await machine.ensurePaired(apiClient);
      if (!pairedOk) {
        console.log('[Worker] Interactive pairing cancelled or timed out. Entering standby mode.');
        console.log(`[Worker] You can pair anytime using the SEVATN Worker Control Center.\n`);
        heartbeat.setStatus('OFFLINE');
      } else {
        isPaired = true;
      }
    }
  }

  // 4. Start Heartbeat Service
  await heartbeat.init().catch(() => {});
  heartbeat.start(heartbeatInterval);
  SanitizedLogger.info(`💓 Heartbeat service active (Interval: ${heartbeatInterval / 1000}s)`);

  // 5. Start Orchestrator Loop
  const checkInterval = parseInt(process.env.CHECK_INTERVAL_MS || '15000', 10);
  const orchestrator = new WorkerOrchestrator(apiClient, heartbeat, checkInterval);

  // 6. Graceful Shutdown with Idempotent Cleanup
  let isShuttingDown = false;
  const gracefulShutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    SanitizedLogger.info(`[Worker] Received ${signal}. Shutting down gracefully...`);

    // Stop orchestrator and polling
    orchestrator.stop();

    // Mark worker OFFLINE and stop heartbeat
    try {
      heartbeat.setStatus('OFFLINE');
      heartbeat.stop();
    } catch {}

    // Stop IPC server
    try {
      await ipc.stop();
    } catch {}

    // Clean up browser contexts and Chromium
    SanitizedLogger.info('[Worker] Closing active Playwright browser contexts...');
    try {
      await BrowserManager.closeBrowser();
      SanitizedLogger.info('[Worker] Chromium processes closed cleanly.');
    } catch (err: any) {
      SanitizedLogger.warn('[Worker] Warning during Chromium cleanup:', err?.message);
    }

    SanitizedLogger.info('[Worker] Graceful shutdown completed.');
    process.exit(0);
  };

  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

  // Start orchestrator loop
  await orchestrator.start();
}

bootstrap().catch((err) => {
  SanitizedLogger.error('Worker bootstrap unhandled failure:', err);
  console.error('\n[Worker] Fatal startup error:', err.message || err);
  process.exit(1);
});
