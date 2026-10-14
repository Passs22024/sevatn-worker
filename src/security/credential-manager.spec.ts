import { CredentialManager } from './credential-manager';
import * as crypto from 'crypto';

describe('CredentialManager Security Invariants', () => {
  const originalEnv = process.env.CREDENTIAL_ENCRYPTION_KEY;
  const testKey = 'test-encryption-key-for-worker-32-chars!!';

  afterEach(() => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = originalEnv;
  });

  function encryptWithKey(plaintext: string, secret: string) {
    const key = crypto.createHash('sha256').update(secret.trim()).digest();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let enc = cipher.update(plaintext, 'utf8', 'hex');
    enc += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return { enc, iv: iv.toString('hex'), authTag };
  }

  it('successfully decrypts AES-256-GCM payload with valid encryption key', () => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = testKey;
    const plaintext = 'SecretDevoteePassword#2026';
    const payload = encryptWithKey(plaintext, testKey);

    const decrypted = CredentialManager.decrypt(payload.enc, payload.iv, payload.authTag);
    expect(decrypted).toBe(plaintext);
  });

  it('fails closed when CREDENTIAL_ENCRYPTION_KEY is unset or too short', () => {
    delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    const payload = encryptWithKey('password', testKey);

    expect(() => {
      CredentialManager.decrypt(payload.enc, payload.iv, payload.authTag);
    }).toThrow(/FATAL: CREDENTIAL_ENCRYPTION_KEY/);

    process.env.CREDENTIAL_ENCRYPTION_KEY = 'short';
    expect(() => {
      CredentialManager.decrypt(payload.enc, payload.iv, payload.authTag);
    }).toThrow(/FATAL: CREDENTIAL_ENCRYPTION_KEY/);
  });

  it('fails closed when authTag is tampered with', () => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = testKey;
    const payload = encryptWithKey('password', testKey);
    const tamperedTag = payload.authTag.replace(/^../, 'ff');

    expect(() => {
      CredentialManager.decrypt(payload.enc, payload.iv, tamperedTag);
    }).toThrow();
  });

  it('fails closed when ciphertext is tampered with', () => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = testKey;
    const payload = encryptWithKey('password', testKey);
    const tamperedData = payload.enc.replace(/^../, '00');

    expect(() => {
      CredentialManager.decrypt(tamperedData, payload.iv, payload.authTag);
    }).toThrow();
  });
});
