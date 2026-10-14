import { ApiClient } from '../api/client';
import { PlaywrightSabarimalaAdapter } from '../sabarimala/sabarimala-adapter';
import { CredentialManager } from '../security/credential-manager';
import { SanitizedLogger } from '../monitoring/logger';

export interface VerificationJobData {
  id: string;
  accountId: string;
  username: string;
  encryptedPassword: string;
  encryptionIv: string;
  encryptionTag: string;
  leaseExpiresAt?: string;
}

export class VerificationWorker {
  constructor(private apiClient: ApiClient) {}

  async execute(job: VerificationJobData): Promise<void> {
    SanitizedLogger.info(`Starting official account verification for: ${job.username} (Job ID: ${job.id})`);

    const adapter = new PlaywrightSabarimalaAdapter();

    try {
      // 1. Report BROWSER_STARTING
      await this.apiClient.updateJobProgress(job.id, {
        status: 'BROWSER_STARTING',
        note: 'Launching isolated Playwright browser context',
      });

      await adapter.init();

      // 2. Report OFFICIAL_SITE_OPEN
      await this.apiClient.updateJobProgress(job.id, {
        status: 'OFFICIAL_SITE_OPEN',
        note: 'Connecting to https://sabarimalaonline.org/#/login',
      });

      const opened = await adapter.openLogin();
      if (!opened) {
        await this.apiClient.failJob(job.id, {
          status: 'SITE_UNAVAILABLE',
          errorCode: 'OFFICIAL_SITE_UNAVAILABLE',
          errorMessage: 'Official Sabarimala portal could not be reached.',
        });
        return;
      }

      // 3. Decrypt password only in memory at execution time
      const password = CredentialManager.decrypt(
        job.encryptedPassword,
        job.encryptionIv,
        job.encryptionTag,
      );

      // 4. Report LOGIN_IN_PROGRESS
      await this.apiClient.updateJobProgress(job.id, {
        status: 'LOGIN_IN_PROGRESS',
        note: 'Submitting credentials to official authentication form',
      });

      const loginResult = await adapter.login(job.username, password);

      if (loginResult.status === 'LOGIN_SUCCESS') {
        SanitizedLogger.info(`Official verification SUCCESS for ${job.username}`);
        await this.apiClient.completeJob(job.id, {
          note: 'Official credentials verified successfully on sabarimalaonline.org',
        });
      } else if (loginResult.status === 'OTP_REQUIRED' || loginResult.status === 'CAPTCHA_REQUIRED') {
        SanitizedLogger.warn(`Verification challenge detected for ${job.username}: ${loginResult.status}`);
        await this.apiClient.failJob(job.id, {
          status: 'REQUIRES_HUMAN',
          errorCode: loginResult.status,
          errorMessage: loginResult.message || 'Official portal presented human verification challenge.',
        });
      } else {
        SanitizedLogger.warn(`Official verification FAILED for ${job.username}: ${loginResult.message}`);
        await this.apiClient.failJob(job.id, {
          status: 'FAILED',
          errorCode: loginResult.status,
          errorMessage: loginResult.message || 'Invalid official credentials.',
        });
      }
    } catch (err: any) {
      SanitizedLogger.error(`Error during verification job ${job.id}:`, err);
      await this.apiClient.failJob(job.id, {
        status: 'FAILED',
        errorCode: 'EXECUTION_ERROR',
        errorMessage: err.message || 'Error executing verification in Playwright.',
      });
    } finally {
      await adapter.close();
    }
  }
}
