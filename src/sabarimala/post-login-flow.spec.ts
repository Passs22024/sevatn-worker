import * as fs from 'fs';
import * as path from 'path';
import { SabarimalaPostLoginFlow } from './post-login-flow';

describe('SabarimalaPostLoginFlow Bounded Storage & Reference Integrity', () => {
  const testDebugDir = path.resolve(__dirname, '../../test_debug');

  beforeEach(async () => {
    if (fs.existsSync(testDebugDir)) {
      await fs.promises.rm(testDebugDir, { recursive: true, force: true });
    }
    await fs.promises.mkdir(testDebugDir, { recursive: true });
  });

  afterEach(async () => {
    if (fs.existsSync(testDebugDir)) {
      await fs.promises.rm(testDebugDir, { recursive: true, force: true });
    }
  });

  it('bounds screenshot storage by pruning files older than maxAgeDays', async () => {
    const oldFile = path.join(testDebugDir, 'old-booking-error.png');
    const freshFile = path.join(testDebugDir, 'recent-booking-error.png');

    await fs.promises.writeFile(oldFile, 'dummy old png content');
    await fs.promises.writeFile(freshFile, 'dummy recent png content');

    // Simulate old file mtime (8 days old)
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    await fs.promises.utimes(oldFile, eightDaysAgo, eightDaysAgo);

    await SabarimalaPostLoginFlow.cleanupOldScreenshots(testDebugDir, 7, 100 * 1024 * 1024);

    expect(fs.existsSync(oldFile)).toBe(false);
    expect(fs.existsSync(freshFile)).toBe(true);
  });

  it('bounds screenshot storage by enforcing total byte cap', async () => {
    const fileA = path.join(testDebugDir, 'testA.png');
    const fileB = path.join(testDebugDir, 'testB.png');

    const buffer = Buffer.alloc(1024 * 50); // 50 KB each
    await fs.promises.writeFile(fileA, buffer);
    // set fileA mtime older than fileB
    const olderTime = new Date(Date.now() - 3600 * 1000);
    await fs.promises.utimes(fileA, olderTime, olderTime);

    await fs.promises.writeFile(fileB, buffer);

    // Limit to 60 KB (so one file must be evicted)
    await SabarimalaPostLoginFlow.cleanupOldScreenshots(testDebugDir, 30, 60 * 1024);

    expect(fs.existsSync(fileA)).toBe(false); // Older evicted
    expect(fs.existsSync(fileB)).toBe(true);  // Newer preserved
  });

  it('does not touch non-screenshot files during cleanup', async () => {
    const textFile = path.join(testDebugDir, 'audit_log.txt');
    await fs.promises.writeFile(textFile, 'critical log data');
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    await fs.promises.utimes(textFile, eightDaysAgo, eightDaysAgo);

    await SabarimalaPostLoginFlow.cleanupOldScreenshots(testDebugDir, 7, 100);

    expect(fs.existsSync(textFile)).toBe(true);
  });
});
