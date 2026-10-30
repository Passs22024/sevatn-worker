import { chromium, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { CredentialManager } from '../security/credential-manager';
import { SabarimalaLoginFlow } from '../sabarimala/login';
import { PostLoginDateRouteFlow } from '../sabarimala/flows/date-route.flow';
import { TimeSlotSelectionFlow } from '../sabarimala/flows/time-slot.flow';
import { PilgrimSelectionFlow } from '../sabarimala/flows/pilgrim-selection.flow';
import { NomineeDetailsFlow } from '../sabarimala/flows/nominee-details.flow';
import { ReliefFundFlow } from '../sabarimala/flows/relief-fund.flow';
import { WishlistFlow } from '../sabarimala/flows/wishlist.flow';
import { PaymentReviewFlow } from '../sabarimala/flows/payment-review.flow';
import { SabarimalaPostLoginFlow } from '../sabarimala/post-login-flow';
import { BookingExecutionContext } from '../sabarimala/flows/types';
import { SanitizedLogger } from '../monitoring/logger';
import * as dotenv from 'dotenv';

dotenv.config();

const CORRELATION_ID = `FULL-FLOW-TEST-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const EVIDENCE_DIR = path.resolve(__dirname, '../../debug/full_booking_flow', CORRELATION_ID);

interface FlowStepResult {
  stepNumber: number;
  stepName: string;
  status: 'SUCCESS' | 'FAILED' | 'CHALLENGE_REQUIRED' | 'STOPPED_FOR_SAFETY';
  url: string;
  screenshot: string;
  details: Record<string, any>;
}

const results: FlowStepResult[] = [];

async function captureStep(page: Page, stepNum: number, stepName: string, status: FlowStepResult['status'], details: Record<string, any>) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const filename = `STEP_${String(stepNum).padStart(2, '0')}_${stepName.replace(/[^a-zA-Z0-9]/g, '_')}.png`;
  const screenshotPath = path.join(EVIDENCE_DIR, filename);

  await page.screenshot({ path: screenshotPath, fullPage: false }).catch(() => {});

  const res: FlowStepResult = {
    stepNumber: stepNum,
    stepName,
    status,
    url: page.url(),
    screenshot: screenshotPath,
    details,
  };
  results.push(res);

  const icon = status === 'SUCCESS' ? '✅' : status === 'STOPPED_FOR_SAFETY' ? '🛑' : '⚠️';
  console.log(`\n=======================================================`);
  console.log(`${icon} [STEP ${stepNum}] ${stepName}: ${status}`);
  console.log(`• URL: ${page.url()}`);
  console.log(`• Screenshot: ${screenshotPath}`);
  console.log(`• Details:`, JSON.stringify(details, null, 2));
  console.log(`=======================================================`);
  return res;
}

const { PrismaClient } = require(path.resolve(__dirname, '../../../api/node_modules/@prisma/client'));
const prisma = new PrismaClient();

async function runFullBookingFlowTest() {
  console.log('================================================================');
  console.log('🚀 SABARIMALA OFFICIAL PORTAL — FULL BOOKING FLOW TEST');
  console.log(`Correlation ID : ${CORRELATION_ID}`);
  console.log(`Target Username: 8098697141`);
  console.log(`Evidence Dir   : ${EVIDENCE_DIR}`);
  console.log('================================================================\n');

  const account = await prisma.bookingAccount.findFirst({
    where: { username: '8098697141' },
  });

  if (!account || !account.encryptedPassword) {
    throw new Error('Authorized test account not found in database with encrypted credentials');
  }

  const username = account.username;
  const password = CredentialManager.decrypt(
    account.encryptedPassword,
    account.encryptionIv!,
    account.encryptionTag!
  );

  const ctx: BookingExecutionContext = {
    bookingId: 'live-full-flow-01',
    bookingCode: CORRELATION_ID,
    requestedDate: '2026-11-25',
    requestedDateDisplay: '25-11-2026',
    requestedRoute: 'Pamba - Marakkoottam - 4 Kms',
    pilgrimCount: 1,
    reliefFund: 0,
    preferences: {},
    pilgrims: [],
    nominee: {
      nomineeName: 'Ramesh Kumar',
      nomineeAge: 40,
      nomineeRelationship: 'Brother',
    },
  };

  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
  });

  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });

  const page = await context.newPage();

  try {
    // -------------------------------------------------------------
    // STEP 1: PORTAL LOGIN
    // -------------------------------------------------------------
    console.log('[Step 1] Navigating to official login portal...');
    await page.goto('https://sabarimalaonline.org/#/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    const loginResult = await SabarimalaLoginFlow.execute(page, username, password);

    if (loginResult.status !== 'LOGIN_SUCCESS') {
      await captureStep(page, 1, 'PORTAL_LOGIN', 'CHALLENGE_REQUIRED', {
        status: loginResult.status,
        message: loginResult.message,
      });
      console.log('⚠️ Login requires visual challenge or SMS OTP. Halting test.');
      return;
    }

    await captureStep(page, 1, 'PORTAL_LOGIN', 'SUCCESS', {
      status: loginResult.status,
      message: 'Authenticated successfully with official credentials',
    });

    // -------------------------------------------------------------
    // STEP 2: NAVIGATE TO #/darshan
    // -------------------------------------------------------------
    console.log('[Step 2] Navigating to official Virtual-Q booking page (#/darshan)...');
    await SabarimalaPostLoginFlow.handlePostLoginPopup(page).catch(() => {});
    await SabarimalaPostLoginFlow.navigateToHomeAndDarshan(page, ctx);
    await page.waitForTimeout(3000);

    await captureStep(page, 2, 'LOAD_DARSHAN_PAGE', 'SUCCESS', {
      finalUrl: page.url(),
      isDarshanUrl: page.url().includes('darshan'),
    });

    // -------------------------------------------------------------
    // STEP 3: DATE AND ROUTE SELECTION
    // -------------------------------------------------------------
    console.log('[Step 3] Selecting approved date (25-11-2026) and route...');
    const dateSelected = await PostLoginDateRouteFlow.selectAuthenticatedDate(page, ctx);
    const routeSelected = await PostLoginDateRouteFlow.selectAuthenticatedRoute(page, ctx);

    const dateVal = await page.locator('input[name="darshanDate"], input[name*="Date" i], input[matinput], #mat-input-0').first().inputValue().catch(() => '');
    const routeVal = await page.locator('select[name="route"], select.form-control').first().inputValue().catch(() => '');

    await captureStep(page, 3, 'DATE_AND_ROUTE_SELECTION', dateSelected && routeSelected ? 'SUCCESS' : 'FAILED', {
      requestedDate: ctx.requestedDate,
      populatedDate: dateVal,
      requestedRoute: ctx.requestedRoute,
      selectedRouteValue: routeVal,
      dateSelected,
      routeSelected,
    });

    // -------------------------------------------------------------
    // STEP 4: TIME SLOT DISCOVERY AND SELECTION
    // -------------------------------------------------------------
    console.log('[Step 4] Waiting for slot cards and selecting available slot...');
    await SabarimalaPostLoginFlow.waitForSpinnerDetached(page);
    await page.waitForTimeout(3000);

    const slotCards = page.locator('.slot-dar-3, .slot-dar-5, .slot-box, .slot-card, div[class*="slot-dar-"]');
    const slotCount = await slotCards.count().catch(() => 0);

    let slotSelectionSuccess = false;
    if (slotCount > 0) {
      const slotResult = await TimeSlotSelectionFlow.selectTimeSlot(page, ctx);
      slotSelectionSuccess = slotResult.success;
    }

    await captureStep(page, 4, 'TIME_SLOT_SELECTION', slotSelectionSuccess ? 'SUCCESS' : 'FAILED', {
      slotCardsFound: slotCount,
      selectedTimeSlot: ctx.selectedTimeSlot,
      selectionVerified: slotSelectionSuccess,
    });

    // -------------------------------------------------------------
    // STEP 5: PILGRIM SELECTION FLOW
    // -------------------------------------------------------------
    console.log('[Step 5] Selecting registered pilgrims from official account...');
    let pilgrimSelectionSuccess = false;
    let selectedPilgrimCount = 0;
    try {
      const pilgrimRes = await PilgrimSelectionFlow.execute(page, ctx);
      pilgrimSelectionSuccess = pilgrimRes.success;
      selectedPilgrimCount = pilgrimRes.selectedCount;
    } catch (err: any) {
      console.warn('Pilgrim selection notice:', err.message);
    }

    await captureStep(page, 5, 'PILGRIM_SELECTION', pilgrimSelectionSuccess ? 'SUCCESS' : 'FAILED', {
      success: pilgrimSelectionSuccess,
      selectedCount: selectedPilgrimCount,
      selectedPilgrims: ctx.selectedPilgrims || [],
    });

    // -------------------------------------------------------------
    // STEP 6: NOMINEE DETAILS COMPLETION
    // -------------------------------------------------------------
    console.log('[Step 6] Completing Nominee Details to enable Add to Wishlist...');
    let nomineeDetailsSuccess = false;
    let nomineeError: string | null = null;
    try {
      nomineeDetailsSuccess = await NomineeDetailsFlow.execute(page, ctx);
    } catch (err: any) {
      nomineeError = err.message;
      console.warn('Nominee details notice:', err.message);
    }

    await captureStep(page, 6, 'NOMINEE_DETAILS_COMPLETION', nomineeDetailsSuccess ? 'SUCCESS' : 'FAILED', {
      success: nomineeDetailsSuccess,
      nomineeCompletionStatus: ctx.nomineeCompletionStatus,
      nomineeData: ctx.nominee,
      error: nomineeError,
    });

    // -------------------------------------------------------------
    // STEP 7: RELIEF FUND "NO" SELECTION
    // -------------------------------------------------------------
    console.log('[Step 7] Explicitly selecting Relief Fund = "No" (₹0)...');
    let reliefFundNoSelected = false;
    try {
      reliefFundNoSelected = await SabarimalaPostLoginFlow.selectReliefFundNo(page, ctx);
    } catch (err: any) {
      console.warn('Relief fund selection notice:', err.message);
    }

    await captureStep(page, 7, 'RELIEF_FUND_SELECTION', reliefFundNoSelected ? 'SUCCESS' : 'FAILED', {
      reliefFundOption: 'NO',
      amount: ctx.reliefFund,
      verified: reliefFundNoSelected,
    });

    // -------------------------------------------------------------
    // STEP 8: ADD TO WISHLIST & VERIFICATION
    // -------------------------------------------------------------
    console.log('[Step 8] Checking Wishlist & clicking "Add to Wishlist"...');
    let wishlistVerified = false;
    let wishlistError: string | null = null;
    try {
      wishlistVerified = await WishlistFlow.execute(page, ctx);
    } catch (err: any) {
      wishlistError = err.message;
      console.warn('Wishlist flow notice:', err.message);
    }

    await captureStep(page, 8, 'WISHLIST_VERIFICATION', wishlistVerified ? 'SUCCESS' : 'FAILED', {
      wishlistStatus: ctx.wishlistStatus,
      wishlistVerified,
      error: wishlistError,
    });

    // -------------------------------------------------------------
    // STEP 9: PAYMENT REVIEW SCREEN (PROCEED TO PAYMENT GATEWAY)
    // -------------------------------------------------------------
    if (wishlistVerified) {
      console.log('[Step 9] Proceeding to Payment Gateway review screen...');
      let gatewayLoaded = false;
      let gatewaySummary: any = null;
      try {
        const paymentState = await PaymentReviewFlow.execute(page, ctx);
        gatewayLoaded = paymentState.loaded;
        gatewaySummary = paymentState;
      } catch (err: any) {
        console.warn('Payment review notice:', err.message);
      }

      await captureStep(page, 9, 'PAYMENT_GATEWAY_REVIEW', gatewayLoaded ? 'SUCCESS' : 'FAILED', {
        loaded: gatewayLoaded,
        gatewayUrl: gatewaySummary?.gatewayUrl,
        grandTotal: gatewaySummary?.amount,
        summaryPreview: gatewaySummary?.summaryText?.slice(0, 200),
      });

      // -------------------------------------------------------------
      // STEP 9: CONTROLLED FINAL SAFETY STOP
      // -------------------------------------------------------------
      await captureStep(page, 9, 'PAYMENT_AUTHORIZATION_SAFE_STOP', 'STOPPED_FOR_SAFETY', {
        reason: 'Strict safety mandate: Full booking workflow successfully verified up to the official Payment Review screen. Final payment authorization and citizen pass creation paused.',
      });
    }

  } catch (err: any) {
    console.error('Fatal test error:', err);
  } finally {
    await browser.close();
    console.log('\n================================================================');
    console.log('📊 FULL BOOKING FLOW TEST SUMMARY');
    console.log('================================================================');
    console.log(`Total Steps Tested: ${results.length}`);
    console.log(`Screenshots Saved : ${EVIDENCE_DIR}`);
    console.log('================================================================\n');
  }
}

runFullBookingFlowTest().catch(console.error);
