import { Page } from 'playwright';
import { SABARIMALA_SELECTORS } from './selectors';
import { SanitizedLogger } from '../monitoring/logger';

export interface LoginResult {
  status: 'LOGIN_SUCCESS' | 'INVALID_CREDENTIALS' | 'OTP_REQUIRED' | 'CAPTCHA_REQUIRED' | 'SITE_ERROR' | 'UNKNOWN';
  message?: string;
}

export class SabarimalaLoginFlow {
  /**
   * Performs official Sabarimala login
   */
  static async execute(page: Page, username: string, password: string): Promise<LoginResult> {
    SanitizedLogger.info(`Starting Sabarimala login flow for user: ${username.substring(0, 3)}***`);

    try {
      // 1. Navigate to login if not already on it
      const currentUrl = page.url();
      if (!currentUrl.includes('/login')) {
        await page.goto(SABARIMALA_SELECTORS.urls.login, {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });
      }

      // 2. Wait for login page and form to become ready (do not rely only on fixed sleep)
      const formReadySelector = 'input[placeholder*="Mobile"], input[placeholder*="Email"], input[name="username"], input[name="mobileNumber"], input[formcontrolname="username"], input[formcontrolname="mobileNumber"], input[type="password"]';
      await page.waitForSelector(formReadySelector, { state: 'visible', timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(500);

      // 2. Locate and fill username
      let usernameFilled = false;
      try {
        const usernameByLabel = page.getByLabel(/Email ID\/Mobile Number/i).or(page.getByLabel(/Mobile/i)).or(page.getByPlaceholder(/Mobile/i));
        if (await usernameByLabel.count() > 0) {
          await usernameByLabel.first().fill(username);
          usernameFilled = true;
        }
      } catch {}

      if (!usernameFilled) {
        for (const selector of SABARIMALA_SELECTORS.login.usernameSelectors) {
          try {
            const el = page.locator(selector).first();
            if (await el.isVisible({ timeout: 1500 })) {
              await el.fill(username);
              usernameFilled = true;
              break;
            }
          } catch {}
        }
      }

      if (!usernameFilled) {
        SanitizedLogger.warn('Could not locate username input via primary selectors. Trying fallback.');
        const genericInput = page.locator('input[type="text"]').first();
        if (await genericInput.isVisible()) {
          await genericInput.fill(username);
          usernameFilled = true;
        }
      }

      if (!usernameFilled) {
        return { status: 'SITE_ERROR', message: 'Unable to locate username input on login page' };
      }

      // 3. Locate and fill password
      let passwordFilled = false;
      try {
        const passByLabel = page.getByLabel(/Password/i).or(page.getByPlaceholder(/Password/i));
        if (await passByLabel.count() > 0) {
          await passByLabel.first().fill(password);
          passwordFilled = true;
        }
      } catch {}

      if (!passwordFilled) {
        for (const selector of SABARIMALA_SELECTORS.login.passwordSelectors) {
          try {
            const el = page.locator(selector).first();
            if (await el.isVisible({ timeout: 1500 })) {
              await el.fill(password);
              passwordFilled = true;
            }
          } catch {}
        }
      }

      if (!passwordFilled) {
        return { status: 'SITE_ERROR', message: 'Unable to locate password input on login page' };
      }

      // 4. Click login button
      let loginClicked = false;
      try {
        const btnByRole = page.getByRole('button', { name: /Login/i }).or(page.getByRole('button', { name: /Sign In/i }));
        if (await btnByRole.count() > 0) {
          await btnByRole.first().click();
          loginClicked = true;
        }
      } catch {}

      if (!loginClicked) {
        for (const selector of SABARIMALA_SELECTORS.login.loginButtons) {
          try {
            const btn = page.locator(selector).first();
            if (await btn.isVisible({ timeout: 1500 })) {
              await btn.click();
              loginClicked = true;
              break;
            }
          } catch {}
        }
      }

      if (!loginClicked) {
        return { status: 'SITE_ERROR', message: 'Unable to click login button' };
      }

      // 5. Wait for portal request/response processing and allow UI to render post-login state
      await page.waitForTimeout(2000);

      // Retry loop (up to 3 attempts, 2 seconds each) to allow SPA rendering or redirection
      for (let attempt = 1; attempt <= 3; attempt++) {
        // Check OTP challenge
        for (const otpSel of SABARIMALA_SELECTORS.login.otpPrompt) {
          if (await page.locator(otpSel).first().isVisible({ timeout: 500 }).catch(() => false)) {
            return { status: 'OTP_REQUIRED', message: 'Official website requires OTP verification.' };
          }
        }

        // Check CAPTCHA challenge
        for (const capSel of SABARIMALA_SELECTORS.login.captchaContainer) {
          if (await page.locator(capSel).first().isVisible({ timeout: 500 }).catch(() => false)) {
            return { status: 'CAPTCHA_REQUIRED', message: 'Official website presented a CAPTCHA challenge.' };
          }
        }

        // Check explicit error message from portal
        for (const errSel of SABARIMALA_SELECTORS.login.errorMessage) {
          const errEl = page.locator(errSel).first();
          if (await errEl.isVisible({ timeout: 500 }).catch(() => false)) {
            const txt = await errEl.textContent().catch(() => 'Invalid credentials');
            return { status: 'INVALID_CREDENTIALS', message: txt?.trim() || 'Invalid username or password' };
          }
        }

        // Check for successful authentication indicators (Logout button, user profile, dashboard widget)
        for (const welcomeSel of SABARIMALA_SELECTORS.login.welcomeIndicators) {
          if (await page.locator(welcomeSel).first().isVisible({ timeout: 1000 }).catch(() => false)) {
            SanitizedLogger.info(`Login successfully confirmed with indicator: "${welcomeSel}"`);
            return { status: 'LOGIN_SUCCESS', message: 'Authenticated successfully' };
          }
        }

        // Check URL redirection
        const currentUrl = page.url();
        if (!currentUrl.includes('/login')) {
          SanitizedLogger.info(`Login successfully confirmed via URL redirection: ${currentUrl}`);
          return { status: 'LOGIN_SUCCESS', message: 'Authenticated successfully (URL redirected)' };
        }

        if (attempt < 3) {
          await page.waitForTimeout(2000);
        }
      }

      return { status: 'UNKNOWN', message: 'Login state unconfirmed. Please verify credentials.' };
    } catch (err: any) {
      SanitizedLogger.error('Exception during Sabarimala login flow:', err);
      return { status: 'SITE_ERROR', message: err.message };
    }
  }
}
