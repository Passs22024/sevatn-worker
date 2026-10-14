import { BrowserContext, Page } from 'playwright';
import { ContextManager } from '../browser/context-manager';
import { SabarimalaLoginFlow, LoginResult } from './login';
import {
  SabarimalaDarshanAvailabilityFlow,
  DateAvailabilityCheckResult,
  DiscoveredSlot,
} from './darshan-availability';
import { SabarimalaPostLoginFlow } from './post-login-flow';
import { SABARIMALA_SELECTORS } from './selectors';
import { SanitizedLogger } from '../monitoring/logger';
import { normalizeDate } from './virtual-q';

export class PlaywrightSabarimalaAdapter {
  private context: BrowserContext | null = null;
  private page: Page | null = null;

  async init(): Promise<void> {
    const session = await ContextManager.createIsolatedContext();
    this.context = session.context;
    this.page = session.page;
  }

  // Pre-Login Darshan Availability Flow
  async openDarshanAvailability(): Promise<{ success: boolean; url: string; title: string }> {
    if (!this.page) throw new Error('Browser not initialized');
    return await SabarimalaDarshanAvailabilityFlow.openDarshanAvailability(this.page);
  }

  async checkRequestedDateAvailability(requestedDate: string | Date): Promise<DateAvailabilityCheckResult> {
    if (!this.page) throw new Error('Browser not initialized');
    return await SabarimalaDarshanAvailabilityFlow.checkRequestedDateAvailability(this.page, requestedDate);
  }

  async selectRequestedDate(requestedDate: string | Date): Promise<{ success: boolean; selectedDate: string }> {
    if (!this.page) throw new Error('Browser not initialized');
    return await SabarimalaDarshanAvailabilityFlow.selectDate(this.page, requestedDate);
  }

  async selectRoute(route: string): Promise<{ success: boolean; selectedRoute: string }> {
    if (!this.page) throw new Error('Browser not initialized');
    return await SabarimalaDarshanAvailabilityFlow.selectRoute(this.page, route);
  }

  async discoverAvailableSlots(): Promise<DiscoveredSlot[]> {
    if (!this.page) throw new Error('Browser not initialized');
    return await SabarimalaDarshanAvailabilityFlow.discoverAvailableSlots(this.page);
  }

  async selectAvailableTimeSlot(preferredTimeSlot?: string): Promise<{ success: boolean; selectedSlot: string }> {
    if (!this.page) throw new Error('Browser not initialized');
    return await SabarimalaDarshanAvailabilityFlow.selectTimeSlot(this.page, preferredTimeSlot);
  }

  async proceedToLogin(): Promise<{ success: boolean }> {
    if (!this.page) throw new Error('Browser not initialized');
    return await SabarimalaDarshanAvailabilityFlow.proceedToLogin(this.page);
  }

  // Authentication
  async openLogin(): Promise<boolean> {
    if (!this.page) throw new Error('Browser not initialized');
    try {
      SanitizedLogger.info(`Navigating to official portal: ${SABARIMALA_SELECTORS.urls.login}`);
      await this.page.goto(SABARIMALA_SELECTORS.urls.login, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      return true;
    } catch (err: any) {
      SanitizedLogger.error('Failed to open login page:', err);
      return false;
    }
  }

  async login(username: string, password: string): Promise<LoginResult> {
    if (!this.page) throw new Error('Browser not initialized');
    return await SabarimalaLoginFlow.execute(this.page, username, password);
  }

  // Post-Login Sequence
  async handlePostLoginPopup(): Promise<boolean> {
    if (!this.page) throw new Error('Browser not initialized');
    return await SabarimalaPostLoginFlow.handlePostLoginPopup(this.page);
  }

  verifyDateTimePreserved(ctx: any): boolean {
    return SabarimalaPostLoginFlow.verifyDateTimePreserved(ctx);
  }

  async selectAllExistingPilgrims(ctx: any): Promise<{ success: boolean; count: number }> {
    if (!this.page) throw new Error('Browser not initialized');
    return await SabarimalaPostLoginFlow.selectRegisteredPilgrims(this.page, ctx);
  }

  async selectReliefFundNo(ctx: any): Promise<boolean> {
    if (!this.page) throw new Error('Browser not initialized');
    return await SabarimalaPostLoginFlow.selectReliefFundNo(this.page, ctx);
  }

  async addToWishlistAndVerify(ctx: any): Promise<boolean> {
    if (!this.page) throw new Error('Browser not initialized');
    return await SabarimalaPostLoginFlow.addToWishlistAndVerify(this.page, ctx);
  }

  async proceedToPaymentGateway(ctx: any): Promise<boolean> {
    if (!this.page) throw new Error('Browser not initialized');
    return await SabarimalaPostLoginFlow.proceedToPaymentGateway(this.page, ctx);
  }

  async verifyPaymentSummary(ctx: any): Promise<boolean> {
    if (!this.page) throw new Error('Browser not initialized');
    return await SabarimalaPostLoginFlow.verifyPaymentSummary(this.page, ctx);
  }

  async executePaymentProceedAndConfirm(
    ctx: any,
  ): Promise<{ confirmed: boolean; officialReference?: string; confirmationData?: any; message?: string }> {
    if (!this.page) throw new Error('Browser not initialized');
    return await SabarimalaPostLoginFlow.executePaymentProceedAndConfirm(this.page, ctx);
  }

  async detectCurrentState(): Promise<string> {
    if (!this.page) return 'CLOSED';
    const url = this.page.url();
    if (url.includes('darshanAvailability')) return 'AVAILABILITY_PAGE';
    if (url.includes('login')) return 'LOGIN_PAGE';
    if (url.includes('darshan') || url.includes('virtual-q')) return 'VIRTUAL_Q_PAGE';
    if (url.includes('piligrimServiceMaster')) return 'PILGRIM_SELECTION_PAGE';
    if (url.includes('wishlist')) return 'WISHLIST_PAGE';
    return 'DASHBOARD';
  }

  async close(): Promise<void> {
    if (this.context && this.page) {
      await ContextManager.cleanup(this.context, this.page);
      this.context = null;
      this.page = null;
    }
  }
}

