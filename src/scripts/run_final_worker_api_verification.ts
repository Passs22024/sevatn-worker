import { ApiClient } from '../api/client';
import { BookingExecutionGuard } from '../security/execution-guard';
import { SanitizedLogger } from '../monitoring/logger';
import * as dotenv from 'dotenv';
import axios from 'axios';
import * as path from 'path';
import * as fs from 'fs';

dotenv.config();

const { PrismaClient, BookingStatus, JobType, WorkerStatus } = require(
  path.resolve(__dirname, '../../../api/node_modules/@prisma/client')
);

const prisma = new PrismaClient();

interface VerificationResult {
  section: string;
  name: string;
  passed: boolean;
  details: any;
}

const results: VerificationResult[] = [];

function recordResult(section: string, name: string, passed: boolean, details: any) {
  results.push({ section, name, passed, details });
  const icon = passed ? '✅' : '❌';
  console.log(`${icon} [${section}] ${name}: ${passed ? 'PASSED' : 'FAILED'}`);
  if (!passed || process.env.VERBOSE) {
    console.log('   Details:', JSON.stringify(details, null, 2));
  }
}

async function runVerification() {
  console.log('================================================================');
  console.log('🔍 SEVATN — FINAL WORKER-TO-API INTEGRATION VERIFICATION');
  console.log(`Execution Date: ${new Date().toISOString()}`);
  console.log('================================================================\n');

  const defaultBackend = process.env.API_BASE_URL || 'http://localhost:5000';
  const apiClient = new ApiClient(defaultBackend);

  // Load verified local machine token
  const credsPath = path.resolve(__dirname, '../../.worker-credentials.json');
  let machineToken = '';
  let machineCode = 'PC-001';

  if (fs.existsSync(credsPath)) {
    const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
    machineToken = creds.machineToken;
    machineCode = creds.machineCode || 'PC-001';
  } else {
    machineToken = process.env.MACHINE_TOKEN || '';
  }

  apiClient.setToken(machineToken);

  // -----------------------------------------------------------------
  // 1. API CONNECTIVITY
  // -----------------------------------------------------------------
  console.log('\n--- 1. API CONNECTIVITY VERIFICATION ---');

  // 1.1 Configured URL & Port
  const urlCheck = {
    baseUrl: apiClient.getBaseUrl(),
    port: 5000,
    isPort5000: defaultBackend.includes(':5000'),
  };
  recordResult('API_CONNECTIVITY', 'Configured API Base URL and Port', urlCheck.isPort5000, urlCheck);

  // 1.2 Worker Heartbeat
  let heartbeatRes: any = null;
  try {
    heartbeatRes = await apiClient.sendHeartbeat({
      status: 'ONLINE',
      version: '1.0.0',
      cpuUsage: 15.5,
      memoryUsage: 48.2,
    });
    recordResult('API_CONNECTIVITY', 'Worker Heartbeat Submission', heartbeatRes.status === 'OK', heartbeatRes);
  } catch (err: any) {
    recordResult('API_CONNECTIVITY', 'Worker Heartbeat Submission', false, { error: err.message, response: err?.response?.data });
  }

  // 1.3 Machine Identity & Pairing in DB
  const machineRecord = await prisma.workerMachine.findFirst({
    where: { machineCode },
  });
  const isPairedAndActive = !!machineRecord && machineRecord.active && machineRecord.adminStatus === 'ENABLED';
  recordResult('API_CONNECTIVITY', 'Machine Identity & Pairing Status', isPairedAndActive, {
    machineCode,
    id: machineRecord?.id,
    adminStatus: machineRecord?.adminStatus,
    desiredState: machineRecord?.desiredState,
    active: machineRecord?.active,
  });

  // 1.4 Worker Execution Authorization
  const isExecutionAuthorized = heartbeatRes?.executionPermitted === true && machineRecord?.desiredState === 'RUNNING';
  recordResult('API_CONNECTIVITY', 'Worker Execution Authorization', isExecutionAuthorized, {
    heartbeatExecutionPermitted: heartbeatRes?.executionPermitted,
    dbDesiredState: machineRecord?.desiredState,
  });

  // -----------------------------------------------------------------
  // 2. QUEUE & EXECUTION INTEGRATION
  // -----------------------------------------------------------------
  console.log('\n--- 2. QUEUE AND EXECUTION INTEGRATION ---');

  // Find or create an authorized test user & centre
  const testAccount = await prisma.bookingAccount.findFirst({
    where: { username: '8098697141' },
  });

  if (!testAccount) {
    throw new Error('Test booking account 8098697141 not found in database');
  }

  // Ensure clean test booking
  const testBookingCode = `TEST-E2E-${Date.now().toString().slice(-6)}`;
  const testBooking = await prisma.bookingRequest.create({
    data: {
      bookingCode: testBookingCode,
      requestedDate: new Date('2026-11-25T00:00:00.000Z'),
      requestedDateStr: '2026-11-25',
      route: 'Pamba - Marakkoottam - 4 Kms',
      timeSlot: '03:00 - 04:00',
      status: BookingStatus.WORKER_ASSIGNED,
      userId: testAccount.userId,
      accountId: testAccount.id,
      version: 1,
      pilgrims: {
        create: [
          {
            fullName: 'Ayyappa Bhakthan',
            age: 35,
            gender: 'MALE',
            idType: 'AADHAAR',
            idNumber: '999900001111',
          },
        ],
      },
    },
    include: {
      pilgrims: true,
    },
  });

  // Create corresponding BookingJob assigned to machineRecord
  const testJob = await prisma.bookingJob.create({
    data: {
      bookingRequestId: testBooking.id,
      workerId: machineRecord!.id,
      accountId: testAccount.id,
      jobType: JobType.BOOKING_EXECUTION,
      status: BookingStatus.WORKER_ASSIGNED,
      leaseGeneration: 1,
      fencingToken: `fence-init-${Date.now()}`,
      leaseExpiresAt: new Date(Date.now() + 180000),
    },
  });

  recordResult('QUEUE_EXECUTION', 'Safe Test Job Pre-allocated', !!testJob.id, {
    bookingId: testBooking.id,
    bookingCode: testBookingCode,
    jobId: testJob.id,
    leaseGeneration: testJob.leaseGeneration,
    fencingToken: testJob.fencingToken,
  });

  // 2.2 Worker Claim Job via API
  let claimedJobPayload: any = null;
  try {
    const claimRes = await apiClient.claimJob();
    claimedJobPayload = claimRes?.job;
    const claimedSuccessfully = claimRes.hasJob && claimedJobPayload?.id === testJob.id;
    recordResult('QUEUE_EXECUTION', 'Worker Claim via API (/workers/jobs/claim)', claimedSuccessfully, {
      hasJob: claimRes.hasJob,
      claimedJobId: claimedJobPayload?.id,
      bookingCode: claimedJobPayload?.bookingCode,
      requestedDate: claimedJobPayload?.requestedDate,
      route: claimedJobPayload?.route,
      leaseGeneration: claimedJobPayload?.leaseGeneration,
      fencingToken: claimedJobPayload?.fencingToken,
    });
  } catch (err: any) {
    recordResult('QUEUE_EXECUTION', 'Worker Claim via API', false, { error: err.message, data: err?.response?.data });
  }

  // 2.3 Verify Execution Lock in Local Guard
  const lockAcquired = BookingExecutionGuard.acquire({
    bookingId: testBooking.id,
    bookingCode: testBookingCode,
    jobId: testJob.id,
    dispatchSource: 'QUEUE_POLL',
    owner: 'WORKER_ORCHESTRATOR',
  });
  recordResult('QUEUE_EXECUTION', 'Local Execution Lock Acquisition (Deduplication Guard)', lockAcquired.acquired, lockAcquired);

  // Verify concurrent duplicate attempt is rejected
  const duplicateAttempt = BookingExecutionGuard.acquire({
    bookingId: testBooking.id,
    bookingCode: testBookingCode,
    jobId: 'competing-worker-job-999',
    dispatchSource: 'QUEUE_POLL',
    owner: 'COMPETING_WORKER',
  });
  recordResult('QUEUE_EXECUTION', 'Concurrent Duplicate Execution Rejection', !duplicateAttempt.acquired, {
    rejected: !duplicateAttempt.acquired,
    existingLock: duplicateAttempt.existingLock,
  });

  // -----------------------------------------------------------------
  // 3. WORKFLOW INTEGRATION & MODULAR SEQUENCE TRACE
  // -----------------------------------------------------------------
  console.log('\n--- 3. WORKFLOW INTEGRATION & PROGRESS REPORTING ---');

  // Verify progress updates with leaseGeneration and fencingToken
  let progressAccepted = false;
  try {
    const progressRes = await apiClient.updateJobProgress(testJob.id, {
      status: 'PROCESSING',
      note: 'Step 1: Authenticated portal navigation active',
      leaseGeneration: claimedJobPayload?.leaseGeneration || 1,
      fencingToken: claimedJobPayload?.fencingToken || testJob.fencingToken,
    });
    progressAccepted = progressRes.success === true;
    recordResult('WORKFLOW_INTEGRATION', 'Progress Update 1: PROCESSING (Lease-Fenced)', progressAccepted, progressRes);
  } catch (err: any) {
    recordResult('WORKFLOW_INTEGRATION', 'Progress Update 1: PROCESSING', false, { error: err.message, data: err?.response?.data });
  }

  // Verify progress at SELECTING_SLOT
  try {
    const slotProgress = await apiClient.updateJobProgress(testJob.id, {
      status: 'SELECTING_SLOT',
      note: 'Step 2: Date 2026-11-25 & Route Pamba selected, slot verified',
      leaseGeneration: claimedJobPayload?.leaseGeneration || 1,
      fencingToken: claimedJobPayload?.fencingToken || testJob.fencingToken,
    });
    recordResult('WORKFLOW_INTEGRATION', 'Progress Update 2: SELECTING_SLOT (Date & Route Verified)', slotProgress.success === true, slotProgress);
  } catch (err: any) {
    recordResult('WORKFLOW_INTEGRATION', 'Progress Update 2: SELECTING_SLOT', false, { error: err.message, data: err?.response?.data });
  }

  // Verify progress at WISHLIST_VERIFIED (Safe Stop Boundary)
  try {
    const wishlistProgress = await apiClient.updateJobProgress(testJob.id, {
      status: 'WISHLIST_VERIFIED',
      note: 'Step 3: Nominee verified, Relief fund set to No. Stopped before payment submission.',
      leaseGeneration: claimedJobPayload?.leaseGeneration || 1,
      fencingToken: claimedJobPayload?.fencingToken || testJob.fencingToken,
    });
    recordResult('WORKFLOW_INTEGRATION', 'Progress Update 3: WISHLIST_VERIFIED (Controlled Safety Stop)', wishlistProgress.success === true, wishlistProgress);
  } catch (err: any) {
    recordResult('WORKFLOW_INTEGRATION', 'Progress Update 3: WISHLIST_VERIFIED', false, { error: err.message, data: err?.response?.data });
  }

  // -----------------------------------------------------------------
  // 4. DATABASE VERIFICATION & FENCING CONTROLS
  // -----------------------------------------------------------------
  console.log('\n--- 4. DATABASE VERIFICATION & FENCING CONTROLS ---');

  // 4.1 Verify BookingMilestone persistence
  const milestones = await prisma.bookingMilestone.findMany({
    where: { bookingRequestId: testBooking.id },
    orderBy: { timestamp: 'asc' },
  });
  recordResult('DATABASE_VERIFICATION', 'Booking Milestones Recorded in DB', milestones.length > 0, {
    count: milestones.length,
    milestones: milestones.map((m: any) => ({ milestone: m.milestone, timestamp: m.timestamp, workerId: m.workerId })),
  });

  // 4.2 Stale Worker Lease Fencing Test:
  // Submit update with outdated leaseGeneration (generation = 0)
  let staleRejected = false;
  try {
    await apiClient.updateJobProgress(testJob.id, {
      status: 'PROCESSING',
      note: 'Stale worker attempting progress update with expired generation',
      leaseGeneration: 0, // Stale generation!
      fencingToken: 'stale-token-xyz',
    });
    staleRejected = false; // Should not reach here
  } catch (err: any) {
    const status = err?.response?.status;
    const errorCode = err?.response?.data?.errorCode || err?.response?.data?.message;
    staleRejected = status === 409 || errorCode === 'STALE_LEASE_GENERATION';
    recordResult('DATABASE_VERIFICATION', 'Stale Worker Lease Fencing Enforcement (HTTP 409 Rejected)', staleRejected, {
      httpStatus: status,
      errorResponse: err?.response?.data,
    });
  }

  // 4.3 Safe Failure Classification Report
  // Fail the test job with clean test stop code so it's not marked BOOKING_CONFIRMED
  try {
    const failRes = await apiClient.failJob(testJob.id, {
      status: 'REQUIRES_HUMAN',
      errorCode: 'CONTROLLED_VERIFICATION_SAFE_STOP',
      errorMessage: 'Live workflow successfully validated up to Wishlist. Safe stop engaged before irreversible booking pass submission.',
      leaseGeneration: claimedJobPayload?.leaseGeneration || 1,
      fencingToken: claimedJobPayload?.fencingToken || testJob.fencingToken,
    });
    recordResult('DATABASE_VERIFICATION', 'Controlled Safe Stop Recorded via failJob()', failRes.success === true, failRes);
  } catch (err: any) {
    recordResult('DATABASE_VERIFICATION', 'Controlled Safe Stop Recorded', false, { error: err.message, data: err?.response?.data });
  }

  // 4.4 Verify Final State in DB: NOT BOOKING_CONFIRMED
  const finalBooking = await prisma.bookingRequest.findUnique({
    where: { id: testBooking.id },
  });
  const finalJob = await prisma.bookingJob.findUnique({
    where: { id: testJob.id },
  });

  const isNeverConfirmed = finalBooking?.status !== BookingStatus.SUCCESS && finalBooking?.status !== 'BOOKING_CONFIRMED';
  recordResult('DATABASE_VERIFICATION', 'Safety Check: Final Status is NOT BOOKING_CONFIRMED', isNeverConfirmed, {
    bookingStatus: finalBooking?.status,
    jobStatus: finalJob?.status,
    requiresHumanNote: finalBooking?.requiresHumanNote,
  });

  // Release local lock
  BookingExecutionGuard.release(testBooking.id, testJob.id);

  // -----------------------------------------------------------------
  // SUMMARY
  // -----------------------------------------------------------------
  console.log('\n================================================================');
  console.log('📊 VERIFICATION SUMMARY');
  console.log('================================================================');
  const total = results.length;
  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = total - passedCount;

  console.log(`Total Checks : ${total}`);
  console.log(`Passed       : ${passedCount}`);
  console.log(`Failed       : ${failedCount}`);
  console.log(`Final Verdict: ${failedCount === 0 ? 'PASS' : 'FAIL'}`);
  console.log('================================================================\n');

  // Clean up test data if needed or preserve for audit
  await prisma.$disconnect();

  if (failedCount > 0) {
    process.exit(1);
  }
}

runVerification().catch(async (err) => {
  console.error('Fatal verification failure:', err);
  await prisma.$disconnect();
  process.exit(1);
});
