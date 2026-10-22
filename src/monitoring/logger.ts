import * as fs from 'fs';
import * as path from 'path';

export interface LogEntry {
  id: number;
  timestamp: string;
  level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';
  message: string;
  context?: any;
}

export type LogListener = (entry: LogEntry) => void;

export class SanitizedLogger {
  private static entryCounter = 0;
  private static ringBuffer: LogEntry[] = [];
  private static readonly MAX_RING_BUFFER = 1000;
  private static listeners: Set<LogListener> = new Set();
  private static logFilePath: string | null = null;
  private static readonly MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB per file
  private static readonly MAX_ROTATED_FILES = 5; // worker.log.1 to worker.log.5

  /**
   * Initialize disk log file path with prioritized directory resolution:
   * 1. LOGS_DIR environment variable
   * 2. %PROGRAMDATA%\SEVATN\Worker\logs (Production Windows standard)
   * 3. Local ./logs relative to working directory
   */
  public static initLogFile(customPath?: string): void {
    try {
      const logsDir =
        customPath ||
        process.env.LOGS_DIR ||
        (process.env.PROGRAMDATA
          ? path.resolve(process.env.PROGRAMDATA, 'SEVATN', 'Worker', 'logs')
          : path.resolve(process.cwd(), 'logs'));

      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }
      this.logFilePath = path.join(logsDir, 'worker.log');
    } catch (err: any) {
      console.warn(`[Logger] Notice: Could not initialize disk log directory: ${err.message}`);
    }
  }

  public static getLogFilePath(): string | null {
    if (!this.logFilePath) this.initLogFile();
    return this.logFilePath;
  }

  public static getLogsDir(): string {
    const filePath = this.getLogFilePath();
    return filePath ? path.dirname(filePath) : process.cwd();
  }

  /**
   * Subscribe to real-time log events (used by IPC Server and Control Center UI)
   */
  public static subscribe(listener: LogListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Returns recent log entries from the in-memory ring buffer
   */
  public static getRecentLogs(limit = 100, levelFilter?: string, searchQuery?: string): LogEntry[] {
    let result = this.ringBuffer;
    if (levelFilter && levelFilter !== 'ALL') {
      result = result.filter((l) => l.level === levelFilter);
    }
    if (searchQuery && searchQuery.trim().length > 0) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (l) =>
          l.message.toLowerCase().includes(query) ||
          (l.context && JSON.stringify(l.context).toLowerCase().includes(query))
      );
    }
    return result.slice(-limit);
  }

  public static clearRecentLogs(): void {
    this.ringBuffer = [];
  }

  public static sanitize(message: string): string {
    if (!message || typeof message !== 'string') return '';
    return message
      .replace(/password\s*[:=]\s*[^\s,]+/gi, 'password=[REDACTED]')
      .replace(/passwd\s*[:=]\s*[^\s,]+/gi, 'passwd=[REDACTED]')
      .replace(/token\s*[:=]\s*[^\s,]+/gi, 'token=[REDACTED]')
      .replace(/Bearer\s+[A-Za-z0-9\-_.]+/gi, 'Bearer [REDACTED]')
      .replace(/otp\s*[:=]\s*[^\s,]+/gi, 'otp=[REDACTED]')
      .replace(/cookie\s*[:=]\s*[^\s,]+/gi, 'cookie=[REDACTED]')
      .replace(/authTag\s*[:=]\s*[^\s,]+/gi, 'authTag=[REDACTED]')
      .replace(/secret\s*[:=]\s*[^\s,]+/gi, 'secret=[REDACTED]')
      .replace(/key\s*[:=]\s*([a-f0-9]{32,}|[A-Za-z0-9_-]{24,})/gi, 'key=[REDACTED]')
      .replace(/encryptedPassword\s*[:=]\s*[^\s,]+/gi, 'encryptedPassword=[REDACTED]');
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
      if (/password|token|secret|otp|cookie|authTag|encryptedPassword|privateKey/i.test(key)) {
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

  private static rotateAndAppend(line: string): void {
    try {
      if (!this.logFilePath) this.initLogFile();
      if (!this.logFilePath) return;

      if (fs.existsSync(this.logFilePath)) {
        const stats = fs.statSync(this.logFilePath);
        if (stats.size >= this.MAX_FILE_SIZE) {
          this.rotateFiles();
        }
      }

      fs.appendFileSync(this.logFilePath, line + '\n', 'utf8');
    } catch {
      // Do not throw from logger to prevent infinite recursion
    }
  }

  private static rotateFiles(): void {
    if (!this.logFilePath) return;
    try {
      const oldest = `${this.logFilePath}.${this.MAX_ROTATED_FILES}`;
      if (fs.existsSync(oldest)) {
        fs.unlinkSync(oldest);
      }
      for (let i = this.MAX_ROTATED_FILES - 1; i >= 1; i--) {
        const current = `${this.logFilePath}.${i}`;
        const next = `${this.logFilePath}.${i + 1}`;
        if (fs.existsSync(current)) {
          fs.renameSync(current, next);
        }
      }
      if (fs.existsSync(this.logFilePath)) {
        fs.renameSync(this.logFilePath, `${this.logFilePath}.1`);
      }
    } catch {}
  }

  private static recordEntry(level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG', message: string, context?: any): LogEntry {
    const id = ++this.entryCounter;
    const timestamp = new Date().toISOString();
    const sanitizedMsg = this.sanitize(message);
    const sanitizedContext = context ? this.sanitizeObject(context) : undefined;

    const entry: LogEntry = {
      id,
      timestamp,
      level,
      message: sanitizedMsg,
      context: sanitizedContext,
    };

    // Maintain in-memory ring buffer
    this.ringBuffer.push(entry);
    if (this.ringBuffer.length > this.MAX_RING_BUFFER) {
      this.ringBuffer.shift();
    }

    // Persist to rotated disk log
    const contextStr = sanitizedContext !== undefined ? ` ${JSON.stringify(sanitizedContext)}` : '';
    const line = `[${timestamp}] [${level}] ${sanitizedMsg}${contextStr}`;
    this.rotateAndAppend(line);

    // Notify active subscribers
    for (const listener of this.listeners) {
      try {
        listener(entry);
      } catch {}
    }

    return entry;
  }

  public static info(message: string, context?: any): void {
    const entry = this.recordEntry('INFO', message, context);
    console.log(`[${entry.timestamp}] [INFO] ${entry.message}`, entry.context ? entry.context : '');
  }

  public static warn(message: string, context?: any): void {
    const entry = this.recordEntry('WARN', message, context);
    console.warn(`[${entry.timestamp}] [WARN] ${entry.message}`, entry.context ? entry.context : '');
  }

  public static error(message: string, error?: any): void {
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

    const entry = this.recordEntry('ERROR', message, serializedError);
    console.error(
      `[${entry.timestamp}] [ERROR] ${entry.message}`,
      serializedError !== undefined ? JSON.stringify(serializedError, null, 2) : ''
    );
  }

  public static debug(message: string, context?: any): void {
    const entry = this.recordEntry('DEBUG', message, context);
    if (process.env.DEBUG === 'true' || process.env.VERBOSE === 'true') {
      console.log(`[${entry.timestamp}] [DEBUG] ${entry.message}`, entry.context ? entry.context : '');
    }
  }
}
