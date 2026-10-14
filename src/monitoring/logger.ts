export class SanitizedLogger {
  private static sanitize(message: string): string {
    if (!message || typeof message !== 'string') return '';
    return message
      .replace(/password\s*[:=]\s*[^\s,]+/gi, 'password=[REDACTED]')
      .replace(/passwd\s*[:=]\s*[^\s,]+/gi, 'passwd=[REDACTED]')
      .replace(/token\s*[:=]\s*[^\s,]+/gi, 'token=[REDACTED]')
      .replace(/otp\s*[:=]\s*[^\s,]+/gi, 'otp=[REDACTED]')
      .replace(/cookie\s*[:=]\s*[^\s,]+/gi, 'cookie=[REDACTED]')
      .replace(/authTag\s*[:=]\s*[^\s,]+/gi, 'authTag=[REDACTED]')
      .replace(/encryptedPassword\s*[:=]\s*[^\s,]+/gi, 'encryptedPassword=[REDACTED]');
  }

  static info(message: string, context?: any) {
    const timestamp = new Date().toISOString();
    const sanitizedMsg = this.sanitize(message);
    console.log(`[${timestamp}] [INFO] ${sanitizedMsg}`, context ? this.sanitizeObject(context) : '');
  }

  static warn(message: string, context?: any) {
    const timestamp = new Date().toISOString();
    const sanitizedMsg = this.sanitize(message);
    console.warn(`[${timestamp}] [WARN] ${sanitizedMsg}`, context ? this.sanitizeObject(context) : '');
  }

  static error(message: string, error?: any) {
    const timestamp = new Date().toISOString();
    const sanitizedMsg = this.sanitize(message);
    let serializedError: any = error;

    if (error instanceof Error) {
      serializedError = {
        name: error.name,
        message: this.sanitize(error.message),
        stack: this.sanitize(error.stack || ''),
      };
    } else if (error && typeof error === 'object') {
      serializedError = this.sanitizeObject(error);
    }

    console.error(`[${timestamp}] [ERROR] ${sanitizedMsg}`, serializedError !== undefined ? JSON.stringify(serializedError, null, 2) : '');
  }

  private static sanitizeObject(obj: any): any {
    if (!obj || typeof obj !== 'object') return obj;
    if (obj instanceof Error) {
      return {
        name: obj.name,
        message: this.sanitize(obj.message),
        stack: this.sanitize(obj.stack || ''),
      };
    }
    const sanitized: any = Array.isArray(obj) ? [] : {};
    for (const key of Object.keys(obj)) {
      if (/password|token|secret|otp|cookie|authTag|encryptedPassword/i.test(key)) {
        sanitized[key] = '[REDACTED]';
      } else if (typeof obj[key] === 'object' && obj[key] !== null) {
        sanitized[key] = this.sanitizeObject(obj[key]);
      } else if (typeof obj[key] === 'string') {
        sanitized[key] = this.sanitize(obj[key]);
      } else {
        sanitized[key] = obj[key];
      }
    }
    return sanitized;
  }
}
