import { ApiClient } from './api/client';
import { MachineIdentity } from './machine/identity';
import { HeartbeatService } from './heartbeat/heartbeat';
import { WorkerOrchestrator } from './worker/orchestrator';
import { BrowserManager } from './browser/browser-manager';
import * as dotenv from 'dotenv';
dotenv.config();

async function bootstrap() {
  console.log('=======================================================');
  console.log('⚡ TICKETASSIST WORKER NODE INITIALIZING');
  console.log('Role: Registered Local Worker Machine (PC-00X)');
  console.log('=======================================================');

  const apiClient = new ApiClient(process.env.API_BASE_URL || 'http://localhost:4000');
  const machine = new MachineIdentity();

  // 1. Ensure Machine is Paired and has Valid Machine Token
  const paired = await machine.ensurePaired(apiClient);
  if (!paired) {
    console.error('Worker cannot start without machine pairing approval.');
    process.exit(1);
  }

  // 2. Start Heartbeat Service
  const heartbeat = new HeartbeatService(apiClient, machine.version);
  const heartbeatInterval = parseInt(process.env.HEARTBEAT_INTERVAL_MS || '10000');
  heartbeat.start(heartbeatInterval);
  console.log(`💓 Heartbeat service active (Interval: ${heartbeatInterval / 1000}s)`);

  // 3. Start Orchestrator Loop
  const checkInterval = parseInt(process.env.CHECK_INTERVAL_MS || '15000');
  const orchestrator = new WorkerOrchestrator(apiClient, heartbeat, checkInterval);

  // Graceful shutdown with idempotent cleanup
  let isShuttingDown = false;
  const gracefulShutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`\n[Worker] Received ${signal}. Shutting down gracefully...`);

    // 1. Stop polling and accepting new jobs
    orchestrator.stop();

    // 2. Mark worker as OFFLINE and stop heartbeat pings
    try {
      heartbeat.setStatus('OFFLINE');
      heartbeat.stop();
    } catch {}

    // 3. Clean up browser instances to prevent zombie Chromium processes
    console.log('[Worker] Closing active browser contexts and Chromium...');
    try {
      await BrowserManager.closeBrowser();
      console.log('[Worker] Chromium processes closed cleanly.');
    } catch (err: any) {
      console.warn('[Worker] Warning during Chromium cleanup:', err?.message);
    }

    console.log('[Worker] Graceful shutdown completed.');
    process.exit(0);
  };

  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

  await orchestrator.start();
}

bootstrap().catch((err) => {
  console.error('Worker startup error:', err);
  process.exit(1);
});
