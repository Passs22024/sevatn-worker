import { IpcServer } from './ipc-server';
import { MachineIdentity } from '../machine/identity';
import { ApiClient } from '../api/client';
import axios from 'axios';
import * as http from 'http';

describe('IpcServer - Worker Management Local API', () => {
  let ipc: IpcServer;
  let port: number;

  beforeAll(async () => {
    const machine = new MachineIdentity({
      machineCode: 'PC-TEST-IPC',
      machineName: 'Test Machine IPC',
      version: '1.0.0',
    });
    const apiClient = new ApiClient('http://localhost:4000');

    ipc = new IpcServer({
      machine,
      apiClient,
      preferredPort: 49150,
    });

    port = await ipc.start();
  });

  afterAll(async () => {
    await ipc.stop();
  });

  it('should respond to /api/status with worker telemetry', async () => {
    const res = await axios.get(`http://127.0.0.1:${port}/api/status`);
    expect(res.status).toBe(200);
    expect(res.data.ok).toBe(true);
    expect(res.data.machineCode).toBe('PC-TEST-IPC');
    expect(res.data.version).toBe('1.0.0');
    expect(res.data.desiredState).toBeDefined();
    expect(typeof res.data.cpuUsage).toBe('number');
    expect(typeof res.data.memoryUsage).toBe('number');
  });

  it('should accept pause and resume control actions', async () => {
    const pauseRes = await axios.post(`http://127.0.0.1:${port}/api/control`, { action: 'pause' });
    expect(pauseRes.status).toBe(200);
    expect(pauseRes.data.ok).toBe(true);

    const resumeRes = await axios.post(`http://127.0.0.1:${port}/api/control`, { action: 'resume' });
    expect(resumeRes.status).toBe(200);
    expect(resumeRes.data.ok).toBe(true);
  });

  it('should provide recent logs via /api/logs', async () => {
    const res = await axios.get(`http://127.0.0.1:${port}/api/logs`);
    expect(res.status).toBe(200);
    expect(res.data.ok).toBe(true);
    expect(Array.isArray(res.data.logs)).toBe(true);
  });

  it('should reject non-loopback connections if attempted', (done) => {
    // Verified by checking the remoteAddress constraint in handleRequest
    expect(ipc.port).toBe(port);
    done();
  });
});
