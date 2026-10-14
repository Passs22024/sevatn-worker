import { ApiClient } from '../api/client';
import { BookingWorker } from '../jobs/booking-worker';
import { SanitizedLogger } from '../monitoring/logger';
import * as dotenv from 'dotenv';
import axios from 'axios';
dotenv.config();

async function runLiveE2EAcceptance() {
  console.log('====================================================');
  console.log('TICKETASSIST — FINAL LIVE E2E ACCEPTANCE TEST');
  console.log('====================================================');

  const apiClient = new ApiClient(process.env.API_BASE_URL || 'http://localhost:4000');
  
  // 1. First attempt to claim an existing queued job from API
  console.log('[1/3] Checking for queued booking jobs on API...');
  let claimRes = await apiClient.claimJob().catch((err) => {
    console.error('Error claiming job:', err.message);
    return null;
  });

  if (!claimRes || !claimRes.hasJob) {
    console.log('[1/3] No job in queue. Creating a new live test booking request...');
    
    // Login as Centre User to create a real booking
    const loginRes = await axios.post('http://localhost:4000/auth/login', {
      identifier: 'muthu.esevai@gmail.com',
      password: 'Admin@123456',
    });
    const centreToken = loginRes.data.accessToken || loginRes.data.token;
    // Attach the official test account
    let accountId = '13af5324-0b7b-4598-80cc-8c3170706d28';

    // Create booking for 2026-10-20
    const createRes = await axios.post(
      'http://localhost:4000/bookings',
      {
        requestedDate: '2026-10-20',
        route: 'Pamba - Marakkoottam - 4 Kms',
        timeSlot: 'Any Slot',
        accountId: accountId,
        pilgrims: [
          {
            fullName: 'GUNASEELAN S',
            age: 27,
            gender: 'MALE',
            idType: 'AADHAAR',
            idNumber: '998877665544',
          },
        ],
      },
      {
        headers: { Authorization: `Bearer ${centreToken}` },
      }
    );

    console.log(`[1/3] Created new test booking #${createRes.data.bookingCode || createRes.data.id}`);

    // Claim the newly created job
    claimRes = await apiClient.claimJob();
  }

  if (!claimRes || !claimRes.hasJob || !claimRes.job) {
    console.error('❌ Could not claim or create booking job. claimRes:', claimRes);
    return;
  }

  const job = claimRes.job;
  console.log(`[2/3] Claimed Job for Booking #${job.bookingCode} (Date: ${job.requestedDate}, Route: ${job.route})`);

  // 2. Execute via BookingWorker
  console.log('[3/3] Executing live BookingWorker against official Sabarimala portal...');
  const worker = new BookingWorker(apiClient);

  const startTime = Date.now();
  try {
    await worker.execute(job);
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\nExecution finished in ${duration}s.`);
  } catch (err: any) {
    console.error('Execution encountered error:', err);
  }

  // 3. Query final booking status from API
  try {
    const statusRes = await axios.get(`http://localhost:4000/workers/status/PC-001`, {
      headers: { 'x-machine-token': process.env.MACHINE_TOKEN || '' },
    }).catch(() => null);
    console.log('Worker final status:', statusRes?.data);
  } catch {}
}

runLiveE2EAcceptance().catch(console.error);
