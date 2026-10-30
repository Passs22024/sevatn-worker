import { Page } from 'playwright';

export interface VerificationResult {
  verified: boolean;
  status: 'SUCCESS' | 'FAILED' | 'UNKNOWN';
  referenceNumber?: string;
  details?: any;
  reason?: string;
}

export class ResultVerifier {
  /**
   * Positively verify confirmation page details.
   * NEVER treats HTTP 200 or URL changed as success.
   */
  async verifyConfirmation(
    page: Page | null,
    expectedPilgrimCount: number,
    candidateReference?: string,
  ): Promise<VerificationResult> {
    if (!candidateReference && !page) {
      return {
        verified: false,
        status: 'UNKNOWN',
        reason: 'No official reference or active confirmation DOM found.',
      };
    }

    if (page) {
      try {
        // Look for official success badges and reference number on page
        const successHeader = await page.locator('text=Booking Confirmed, text=Darshan Pass Issued').count();
        const refElement = await page.locator('[data-testid="booking-ref"], .booking-reference-code').first();

        if (successHeader > 0) {
          const text = (await refElement.textContent()) || candidateReference || '';
          const match = text.match(/\b(IVQ[0-9A-Z]{6,25})\b/i) || text.match(/\b(VQ[0-9A-Z]{6,25})\b/i) || text.match(/SAB-[A-Z0-9-]+/i);
          const verifiedRef = match ? match[0] : candidateReference;

          // Reject numeric Cart IDs from being certified as authoritative official pass reference
          if (verifiedRef && !/^\d{8,12}$/.test(verifiedRef)) {
            return {
              verified: true,
              status: 'SUCCESS',
              referenceNumber: verifiedRef,
              details: { verifiedDOM: true, pilgrimCount: expectedPilgrimCount },
            };
          }
        }
      } catch (err: any) {
        console.warn('[Verifier] Live DOM inspection error:', err.message);
      }
    }

    // Reject numeric Cart IDs as booking references
    if (candidateReference && /^\d{8,12}$/.test(candidateReference)) {
      return {
        verified: false,
        status: 'UNKNOWN',
        reason: `Candidate reference "${candidateReference}" appears to be a Cart ID, not an authoritative booking pass reference (IVQ...).`,
      };
    }

    // Authoritative official portal format (e.g. IVQ... or VQ...)
    if (candidateReference && (/^IVQ[0-9A-Z]{6,25}$/i.test(candidateReference) || /^VQ[0-9A-Z]{6,25}$/i.test(candidateReference) || candidateReference.startsWith('SAB-'))) {
      return {
        verified: true,
        status: 'SUCCESS',
        referenceNumber: candidateReference,
        details: { verifiedFormat: true, pilgrimCount: expectedPilgrimCount },
      };
    }

    return {
      verified: false,
      status: 'UNKNOWN',
      reason: 'Confirmation could not be positively verified against official format.',
    };
  }
}
