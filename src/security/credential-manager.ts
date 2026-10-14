import * as crypto from 'crypto';

export class CredentialManager {
  private static getKey(): Buffer {
    const secret = process.env.CREDENTIAL_ENCRYPTION_KEY;
    if (!secret || secret.trim().length < 16) {
      throw new Error(
        'FATAL: CREDENTIAL_ENCRYPTION_KEY environment variable is missing, empty, or too short (minimum 16 characters required). Refusing to process credentials.'
      );
    }
    return crypto.createHash('sha256').update(secret.trim()).digest();
  }

  /**
   * Decrypt AES-256-GCM authenticated credential payload in memory right before Playwright execution
   */
  static decrypt(encryptedHex: string, ivHex: string, authTagHex: string): string {
    const key = this.getKey();
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }
}
