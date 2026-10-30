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

describe('SabarimalaPostLoginFlow Updated Form Handling', () => {
  it('detects previous booking restriction warning banner', async () => {
    const mockPage: any = {
      locator: jest.fn().mockImplementation((sel: string) => ({
        first: () => ({
          isVisible: jest.fn().mockImplementation(async () => {
            return sel.includes('avail previous booking');
          }),
          innerText: jest.fn().mockResolvedValue('You cannot make transaction until you avail previous booking'),
        }),
      })),
    };

    const warning = await SabarimalaPostLoginFlow.checkPortalWarningBanners(mockPage);
    expect(warning).toContain('PREVIOUS_BOOKING_RESTRICTION');
  });

  it('fails explicitly when nominee details are mandatory on portal but missing from booking data', async () => {
    const mockPage: any = {
      locator: jest.fn().mockImplementation((sel: string) => ({
        first: () => ({
          isVisible: jest.fn().mockResolvedValue(true),
        }),
        count: jest.fn().mockResolvedValue(1),
        nth: () => ({
          scrollIntoViewIfNeeded: jest.fn().mockResolvedValue(undefined),
          fill: jest.fn().mockResolvedValue(undefined),
        }),
      })),
      screenshot: jest.fn().mockResolvedValue(Buffer.from('')),
    };

    const ctx: any = {
      bookingCode: 'TA-TEST-01',
      pilgrimCount: 1,
      pilgrims: [{ fullName: 'Devotee 1' }],
      nominee: null,
      nominees: [],
    };

    await expect(SabarimalaPostLoginFlow.populateNomineeDetails(mockPage, ctx)).rejects.toThrow(
      /NOMINEE_DETAILS_MISSING/
    );
  });

  it('populates nominee details successfully when provided', async () => {
    const filledValues: Record<string, string> = {};
    const mockPage: any = {
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      locator: jest.fn().mockImplementation((sel: string) => ({
        first: () => ({
          isVisible: jest.fn().mockResolvedValue(true),
        }),
        count: jest.fn().mockResolvedValue(1),
        nth: () => ({
          isVisible: jest.fn().mockResolvedValue(true),
          scrollIntoViewIfNeeded: jest.fn().mockResolvedValue(undefined),
          fill: jest.fn().mockImplementation(async (val: string) => {
            filledValues[sel] = val;
          }),
          evaluate: jest.fn().mockResolvedValue('select'),
          selectOption: jest.fn().mockResolvedValue(undefined),
        }),
      })),
    };

    const ctx: any = {
      bookingCode: 'TA-TEST-02',
      pilgrimCount: 1,
      pilgrims: [{ fullName: 'Devotee 1' }],
      nominee: {
        nomineeName: 'Meena',
        nomineeAge: 28,
        nomineeRelationship: 'Spouse',
        nomineePhone: '9876543210',
      },
    };

    const result = await SabarimalaPostLoginFlow.populateNomineeDetails(mockPage, ctx);
    expect(result).toBe(true);
  });

  it('keeps prasadam at default 0 when no preference requested without blocking', async () => {
    const mockPage: any = {
      locator: jest.fn().mockImplementation((sel: string) => ({
        first: () => ({
          isVisible: jest.fn().mockImplementation(async () => !sel.includes('error')),
          innerText: jest.fn().mockResolvedValue(''),
        }),
        count: jest.fn().mockResolvedValue(0),
      })),
    };

    const ctx: any = {
      bookingCode: 'TA-TEST-03',
      preferences: {},
    };

    const result = await SabarimalaPostLoginFlow.handlePrasadamDetails(mockPage, ctx);
    expect(result).toBe(true);
  });

  it('selectPostLoginTimeSlot: throws error when slot selection is not verified (.slot-dar-5 missing)', async () => {
    const mockPage: any = {
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      locator: jest.fn().mockImplementation((sel: string) => ({
        count: jest.fn().mockImplementation(async () => {
          if (sel.startsWith('.slot-dar-5')) return 0;
          return 1;
        }),
        nth: () => ({
          innerText: jest.fn().mockResolvedValue('07:00 - 08:00\nAvailability: 100'),
          evaluate: jest.fn().mockImplementation(async (cb: any) => {
            const code = cb.toString();
            // isAvailable check should return true
            if (code.includes('isAvailable') || code.includes('classList.contains(\'slot-dar-3\')')) return true;
            // isSelected check should return false
            return false;
          }),
          scrollIntoViewIfNeeded: jest.fn().mockResolvedValue(undefined),
          click: jest.fn().mockResolvedValue(undefined),
        }),
        filter: () => ({
          count: jest.fn().mockResolvedValue(0),
        }),
      })),
      screenshot: jest.fn().mockResolvedValue(Buffer.from('')),
    };

    const ctx: any = {
      bookingCode: 'TA-TEST-04',
      requestedDate: '2026-10-20',
      selectedTimeSlot: '07:00 - 08:00',
    };

    await expect(SabarimalaPostLoginFlow.selectPostLoginTimeSlot(mockPage, ctx)).rejects.toThrow(
      /SLOT_SELECTION_UNVERIFIED/
    );
  });

  it('selectReliefFundNo: explicitly selects No and strictly verifies checked state', async () => {
    let noChecked = true;
    let yesChecked = false;
    const mockPage: any = {
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      locator: jest.fn().mockImplementation((sel: string) => ({
        first: () => ({
          isVisible: jest.fn().mockResolvedValue(true),
          scrollIntoViewIfNeeded: jest.fn().mockResolvedValue(undefined),
          click: jest.fn().mockResolvedValue(undefined),
          evaluate: jest.fn().mockImplementation(async (cb: any) => {
            if (sel.includes('Yes') || sel.includes('yes')) return yesChecked;
            return noChecked;
          }),
        }),
      })),
      getByLabel: jest.fn().mockImplementation(() => ({
        first: () => ({
          isVisible: jest.fn().mockResolvedValue(true),
        }),
      })),
    };

    const ctx: any = {
      bookingCode: 'TA-TEST-05',
      reliefFund: 100,
    };

    const result = await SabarimalaPostLoginFlow.selectReliefFundNo(mockPage, ctx);
    expect(result).toBe(true);
    expect(ctx.reliefFund).toBe(0);
  });

  it('addToWishlistAndVerify: fails fast with diagnostic when #regi_continue remains disabled', async () => {
    const mockPage: any = {
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      locator: jest.fn().mockImplementation((sel: string) => ({
        first: () => ({
          isVisible: jest.fn().mockResolvedValue(sel.includes('#regi_continue') || sel.includes('Add to Wishlist')),
          isEnabled: jest.fn().mockResolvedValue(false), // Disabled!
          waitFor: jest.fn().mockResolvedValue(undefined),
          innerText: jest.fn().mockResolvedValue(''),
        }),
        count: jest.fn().mockResolvedValue(0),
        allInnerTexts: jest.fn().mockResolvedValue(['Slot not selected']),
      })),
      screenshot: jest.fn().mockResolvedValue(Buffer.from('')),
      url: jest.fn().mockReturnValue('https://sabarimalaonline.org/#/darshan'),
    };

    const ctx: any = {
      bookingCode: 'TA-TEST-06',
      requestedDate: '2026-10-20',
    };

    await expect(SabarimalaPostLoginFlow.addToWishlistAndVerify(mockPage, ctx)).rejects.toThrow(
      /BUTTON_DISABLED: Add to Wishlist button \(#regi_continue\) is disabled/
    );
  });

  it('addToWishlistAndVerify: distinguishes successful click from wishlist confirmation', async () => {
    const mockPage: any = {
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      locator: jest.fn().mockImplementation((sel: string) => ({
        first: () => ({
          isVisible: jest.fn().mockImplementation(async () => {
            if (sel.includes('#regi_continue')) return true;
            if (sel.includes('toast') || sel.includes('alert-success')) return true;
            return false;
          }),
          isEnabled: jest.fn().mockResolvedValue(true),
          scrollIntoViewIfNeeded: jest.fn().mockResolvedValue(undefined),
          click: jest.fn().mockResolvedValue(undefined),
          waitFor: jest.fn().mockResolvedValue(undefined),
          innerText: jest.fn().mockResolvedValue(''),
        }),
        count: jest.fn().mockResolvedValue(0),
      })),
      innerText: jest.fn().mockResolvedValue('Date: 20-10-2026 Time: 07:00 - 08:00 Pilgrims: 1 Amount: ₹0'),
    };

    const ctx: any = {
      bookingCode: 'TA-TEST-07',
      requestedDate: '2026-10-20',
      requestedDateDisplay: '20-10-2026',
      selectedTimeSlot: '07:00 - 08:00',
      pilgrimCount: 1,
    };

    const result = await SabarimalaPostLoginFlow.addToWishlistAndVerify(mockPage, ctx);
    expect(result).toBe(true);
  });

  it('selectBookingType: selects Others and verifies checked state', async () => {
    const mockPage: any = {
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      locator: jest.fn().mockImplementation(() => ({
        first: () => ({
          isVisible: jest.fn().mockResolvedValue(true),
          scrollIntoViewIfNeeded: jest.fn().mockResolvedValue(undefined),
          click: jest.fn().mockResolvedValue(undefined),
          evaluate: jest.fn().mockResolvedValue(true),
        }),
      })),
      getByRole: jest.fn().mockImplementation(() => ({
        first: () => ({
          isVisible: jest.fn().mockResolvedValue(true),
        }),
      })),
    };

    const ctx: any = {
      preferences: { bookingFor: 'Others' },
    };

    const result = await SabarimalaPostLoginFlow.selectBookingType(mockPage, ctx);
    expect(result.success).toBe(true);
    expect(result.selectedType).toBe('Others');
  });

  describe('addToWishlistAndVerify Regression Suite (TA-10036)', () => {
    it('1. Exact format 19-11-2026: authoritatively verifies item row on Wishlist page', async () => {
      let currentPageUrl = 'https://sabarimalaonline.org/#/darshan';
      const mockPage: any = {
        waitForTimeout: jest.fn().mockResolvedValue(undefined),
        url: jest.fn().mockImplementation(() => currentPageUrl),
        goto: jest.fn().mockImplementation(async (url: string) => {
          currentPageUrl = url;
        }),
        locator: jest.fn().mockImplementation((sel: string) => ({
          first: () => ({
            isVisible: jest.fn().mockImplementation(async () => {
              if (sel.includes('#regi_continue')) return true;
              if (sel.includes('toast') || sel.includes('alert-success')) return true;
              if (sel.includes('a[href*="wishlist"]')) return true;
              return false;
            }),
            isEnabled: jest.fn().mockResolvedValue(true),
            scrollIntoViewIfNeeded: jest.fn().mockResolvedValue(undefined),
            click: jest.fn().mockImplementation(async () => {
              if (sel.includes('wishlist')) currentPageUrl = 'https://sabarimalaonline.org/#/wishlist';
            }),
            waitFor: jest.fn().mockResolvedValue(undefined),
            innerText: jest.fn().mockResolvedValue(''),
          }),
          count: jest.fn().mockImplementation(async () => {
            if (sel.includes('table tbody tr') || sel.includes('app-wishlist') || sel.includes('side-drawer')) return 1;
            return 0;
          }),
          nth: jest.fn().mockImplementation((index: number) => ({
            innerText: jest.fn().mockResolvedValue(
              'Virtual-Q Darshan Date: 19-11-2026 Time: 03:00 - 04:00 Pilgrims: 1 Amount: ₹0 Action: Delete'
            ),
          })),
        })),
        innerText: jest.fn().mockResolvedValue(''),
        screenshot: jest.fn().mockResolvedValue(Buffer.from('')),
      };

      const ctx: any = {
        bookingCode: 'TA-10036',
        requestedDate: '2026-11-19',
        requestedDateDisplay: '19-11-2026',
        selectedTimeSlot: '03:00 - 04:00',
        pilgrimCount: 1,
      };

      const result = await SabarimalaPostLoginFlow.addToWishlistAndVerify(mockPage, ctx);
      expect(result).toBe(true);
      expect(mockPage.url()).toBe('https://sabarimalaonline.org/#/darshan');
    });

    it('2. Equivalent formats: matchesDate normalizes all portal date formats', () => {
      const targetIso = '2026-11-19';
      expect(SabarimalaPostLoginFlow.matchesDate('Date: 19-11-2026', targetIso)).toBe(true);
      expect(SabarimalaPostLoginFlow.matchesDate('Date: 19/11/2026', targetIso)).toBe(true);
      expect(SabarimalaPostLoginFlow.matchesDate('Darshan 19 Nov 2026', targetIso)).toBe(true);
      expect(SabarimalaPostLoginFlow.matchesDate('Booking 19-Nov-2026', targetIso)).toBe(true);
      expect(SabarimalaPostLoginFlow.matchesDate('Darshan: 19 November 2026', targetIso)).toBe(true);
      expect(SabarimalaPostLoginFlow.matchesDate('Booking 2026-11-19', targetIso)).toBe(true);

      // Distinct dates should not match
      expect(SabarimalaPostLoginFlow.matchesDate('Date: 18-11-2026', targetIso)).toBe(false);
      expect(SabarimalaPostLoginFlow.matchesDate('Date: 19-12-2026', targetIso)).toBe(false);
      expect(SabarimalaPostLoginFlow.matchesDate('Date: 19-11-2025', targetIso)).toBe(false);
    });

    it('3. Stays on #/darshan and verifies right-side My Wishlist panel after click and toast', async () => {
      let currentUrl = 'https://sabarimalaonline.org/#/darshan';
      const mockPage: any = {
        waitForTimeout: jest.fn().mockResolvedValue(undefined),
        url: jest.fn().mockImplementation(() => currentUrl),
        goto: jest.fn().mockImplementation(async (targetUrl: string) => {
          currentUrl = targetUrl;
        }),
        locator: jest.fn().mockImplementation((sel: string) => ({
          first: () => ({
            isVisible: jest.fn().mockImplementation(async () => {
              if (sel.includes('#regi_continue')) return true;
              if (sel.includes('toast')) return true;
              if (sel.includes('side-drawer') || sel.includes('app-wishlist')) return true;
              return false;
            }),
            isEnabled: jest.fn().mockResolvedValue(true),
            scrollIntoViewIfNeeded: jest.fn().mockResolvedValue(undefined),
            click: jest.fn().mockResolvedValue(undefined),
            waitFor: jest.fn().mockResolvedValue(undefined),
            innerText: jest.fn().mockResolvedValue(''),
          }),
          count: jest.fn().mockImplementation(async () => {
            if (sel.includes('table tbody tr') || sel.includes('wishlist')) return 1;
            return 0;
          }),
          nth: jest.fn().mockImplementation(() => ({
            innerText: jest.fn().mockResolvedValue('Darshan Date: 19-11-2026 Slot: 03:00 - 04:00'),
          })),
        })),
        screenshot: jest.fn().mockResolvedValue(Buffer.from('')),
      };

      const ctx: any = {
        bookingCode: 'TA-10036',
        requestedDate: '2026-11-19',
        selectedTimeSlot: '03:00 - 04:00',
      };

      const result = await SabarimalaPostLoginFlow.addToWishlistAndVerify(mockPage, ctx);
      expect(result).toBe(true);
      expect(mockPage.goto).not.toHaveBeenCalled();
      expect(mockPage.url()).toBe('https://sabarimalaonline.org/#/darshan');
    });

    it('4. Absent item despite toast: fails with WISHLIST_DATA_MISMATCH and captures screenshot', async () => {
      let currentUrl = 'https://sabarimalaonline.org/#/darshan';
      const mockPage: any = {
        waitForTimeout: jest.fn().mockResolvedValue(undefined),
        url: jest.fn().mockImplementation(() => currentUrl),
        goto: jest.fn().mockImplementation(async (targetUrl: string) => {
          currentUrl = targetUrl;
        }),
        locator: jest.fn().mockImplementation((sel: string) => ({
          first: () => ({
            isVisible: jest.fn().mockImplementation(async () => {
              if (sel.includes('#regi_continue')) return true;
              if (sel.includes('toast')) return true;
              if (sel.includes('side-drawer') || sel.includes('app-wishlist')) return true;
              return false;
            }),
            isEnabled: jest.fn().mockResolvedValue(true),
            scrollIntoViewIfNeeded: jest.fn().mockResolvedValue(undefined),
            click: jest.fn().mockResolvedValue(undefined),
            waitFor: jest.fn().mockResolvedValue(undefined),
            innerText: jest.fn().mockResolvedValue(''),
          }),
          count: jest.fn().mockImplementation(async () => {
            if (sel.includes('table tbody tr') || sel.includes('wishlist')) return 1;
            return 0;
          }),
          nth: jest.fn().mockImplementation(() => ({
            innerText: jest.fn().mockResolvedValue('Other Service Date: 25-12-2026 Slot: 10:00 - 11:00'),
          })),
        })),
        innerText: jest.fn().mockResolvedValue('Other Service Date: 25-12-2026 Slot: 10:00 - 11:00'),
        screenshot: jest.fn().mockResolvedValue(Buffer.from('')),
      };

      const ctx: any = {
        bookingCode: 'TA-10036',
        requestedDate: '2026-11-19',
        requestedDateDisplay: '19-11-2026',
        selectedTimeSlot: '03:00 - 04:00',
      };

      await expect(SabarimalaPostLoginFlow.addToWishlistAndVerify(mockPage, ctx)).rejects.toThrow(
        /WISHLIST_DATA_MISMATCH: Expected date 19-11-2026 not found in Wishlist/
      );
      expect(mockPage.goto).not.toHaveBeenCalled();
      expect(mockPage.screenshot).toHaveBeenCalled();
    });

    it('5. Idempotency: detects item already present in Wishlist on #/darshan without route navigation', async () => {
      let currentUrl = 'https://sabarimalaonline.org/#/darshan';
      const mockPage: any = {
        waitForTimeout: jest.fn().mockResolvedValue(undefined),
        url: jest.fn().mockImplementation(() => currentUrl),
        goto: jest.fn().mockImplementation(async (targetUrl: string) => {
          currentUrl = targetUrl;
        }),
        locator: jest.fn().mockImplementation((sel: string) => ({
          first: () => ({
            isVisible: jest.fn().mockImplementation(async () => {
              if (sel.includes('#regi_continue')) return true;
              if (sel.includes('side-drawer') || sel.includes('app-wishlist')) return true;
              return false;
            }),
            isEnabled: jest.fn().mockResolvedValue(false), // Disabled because form was already submitted!
            waitFor: jest.fn().mockResolvedValue(undefined),
            innerText: jest.fn().mockResolvedValue(''),
          }),
          count: jest.fn().mockImplementation(async () => {
            if (sel.includes('table tbody tr') || sel.includes('wishlist')) return 1;
            return 0;
          }),
          nth: jest.fn().mockImplementation(() => ({
            innerText: jest.fn().mockResolvedValue('Virtual-Q Date: 19-11-2026 Slot: 03:00 - 04:00'),
          })),
        })),
        innerText: jest.fn().mockResolvedValue(''),
        screenshot: jest.fn().mockResolvedValue(Buffer.from('')),
      };

      const ctx: any = {
        bookingCode: 'TA-10036',
        requestedDate: '2026-11-19',
        requestedDateDisplay: '19-11-2026',
        selectedTimeSlot: '03:00 - 04:00',
      };

      const result = await SabarimalaPostLoginFlow.addToWishlistAndVerify(mockPage, ctx);
      expect(result).toBe(true);
      expect(mockPage.goto).not.toHaveBeenCalled();
      expect(mockPage.url()).toBe('https://sabarimalaonline.org/#/darshan');
    });

    it('6. Distinguishing wishlist addition from final booking confirmation', async () => {
      let currentUrl = 'https://sabarimalaonline.org/#/wishlist';
      const mockPage: any = {
        waitForTimeout: jest.fn().mockResolvedValue(undefined),
        url: jest.fn().mockImplementation(() => currentUrl),
        waitForURL: jest.fn().mockImplementation(async () => {
          currentUrl = 'https://sabarimalaonline.org/#/paymentGateway';
        }),
        locator: jest.fn().mockImplementation((sel: string) => ({
          first: () => ({
            isVisible: jest.fn().mockImplementation(async () => {
              if (sel.includes('empty') || sel.includes('No items') || sel.includes('No records') || sel.includes('alert-danger')) {
                return false;
              }
              return true;
            }),
            click: jest.fn().mockImplementation(async () => {
              currentUrl = 'https://sabarimalaonline.org/#/paymentGateway';
            }),
          }),
          count: jest.fn().mockResolvedValue(1),
          nth: jest.fn().mockImplementation(() => ({
            innerText: jest.fn().mockResolvedValue('Virtual-Q Date: 19-11-2026 Slot: 03:00 - 04:00'),
          })),
        })),
        innerText: jest.fn().mockResolvedValue(
          'Payment Gateway Summary Cart ID: CART123456 Booking ID: IVQ26100514030705319660 Grand Total: ₹0 Slot: 03:00 - 04:00 Virtual-Q 19-11-2026 Booking Confirmed Official Reference: SAB-EXT-98765432'
        ),
        screenshot: jest.fn().mockResolvedValue(Buffer.from('')),
      };

      const ctx: any = {
        bookingCode: 'TA-10036',
        requestedDate: '2026-11-19',
        requestedDateDisplay: '19-11-2026',
        selectedTimeSlot: '03:00 - 04:00',
      };

      // Step 1: Wishlist verification confirms item in cart
      const wishlistResult = await SabarimalaPostLoginFlow.verifyWishlistContent(mockPage, ctx);
      expect(wishlistResult).toBe(true);
      // At this stage, officialReference is NOT set
      expect(ctx.officialReference).toBeUndefined();

      // Step 2: Proceed to payment gateway
      const proceedResult = await SabarimalaPostLoginFlow.proceedToPaymentGateway(mockPage, ctx);
      expect(proceedResult).toBe(true);

      // Step 3: Payment summary verified
      const summaryResult = await SabarimalaPostLoginFlow.verifyPaymentSummary(mockPage, ctx);
      expect(summaryResult).toBe(true);
      expect(ctx.cartId).toBe('CART123456');

      // Step 4: Final confirmation on payment gateway sets external reference
      const finalResult = await SabarimalaPostLoginFlow.executePaymentProceedAndConfirm(mockPage, ctx);
      expect(finalResult.confirmed).toBe(true);
      expect(finalResult.officialReference).toBe('IVQ26100514030705319660');
    });

    it('7. navigateToHomeAndDarshan navigates through #/home to #/darshan with popup handling', async () => {
      let currentUrl = 'https://sabarimalaonline.org/#/home';
      const mockPage: any = {
        url: jest.fn().mockImplementation(() => currentUrl),
        goto: jest.fn().mockImplementation(async (url: string) => {
          currentUrl = url;
        }),
        waitForURL: jest.fn().mockResolvedValue(undefined),
        waitForTimeout: jest.fn().mockResolvedValue(undefined),
        waitForSelector: jest.fn().mockResolvedValue(undefined),
        locator: jest.fn().mockImplementation((sel: string) => ({
          first: () => ({
            isVisible: jest.fn().mockImplementation(async () => {
              if (sel.includes('OK') || sel.includes('Ok') || sel.includes('darshan')) return true;
              return false;
            }),
            click: jest.fn().mockResolvedValue(undefined),
          }),
          count: jest.fn().mockResolvedValue(1),
          waitFor: jest.fn().mockResolvedValue(undefined),
        })),
      };

      const result = await SabarimalaPostLoginFlow.navigateToHomeAndDarshan(mockPage);
      expect(result).toBe(true);
      expect(mockPage.goto).toHaveBeenCalledWith(
        'https://sabarimalaonline.org/#/darshan',
        expect.anything()
      );
    });

    it('8. verifyPaymentSummary raises PAYMENT_REQUIRED_OR_AMBIGUOUS when grand total > 0 without configured payment', async () => {
      const mockPage: any = {
        waitForTimeout: jest.fn().mockResolvedValue(undefined),
        innerText: jest.fn().mockResolvedValue(
          'Payment Gateway Summary Cart ID: CART999 Booking ID: IVQ1234567890 Grand Total: ₹500 Slot: 03:00 - 04:00 Virtual-Q 19-11-2026'
        ),
        screenshot: jest.fn().mockResolvedValue(Buffer.from('')),
      };

      const ctx: any = {
        bookingCode: 'TA-10036',
        requestedDate: '2026-11-19',
        requestedDateDisplay: '19-11-2026',
        selectedTimeSlot: '03:00 - 04:00',
        preferences: {}, // No automated payment configured
      };

      await expect(SabarimalaPostLoginFlow.verifyPaymentSummary(mockPage, ctx)).rejects.toThrow(
        /PAYMENT_REQUIRED_OR_AMBIGUOUS/
      );
    });

    it('9. executePaymentProceedAndConfirm dismisses confirmation modal cleanly with OK button', async () => {
      let modalDismissed = false;
      const mockPage: any = {
        waitForTimeout: jest.fn().mockResolvedValue(undefined),
        locator: jest.fn().mockImplementation((sel: string) => ({
          first: () => ({
            isVisible: jest.fn().mockImplementation(async () => {
              if (sel.includes('Confirmation') || sel.includes('transaction is successful')) return true;
              if (sel.includes('OK') || sel.includes('Ok')) return true;
              return false;
            }),
            click: jest.fn().mockImplementation(async () => {
              if (sel.includes('OK')) modalDismissed = true;
            }),
          }),
          count: jest.fn().mockResolvedValue(1),
          waitFor: jest.fn().mockResolvedValue(undefined),
        })),
        innerText: jest.fn().mockResolvedValue(
          'Booking Confirmation. Your transaction is successful. Transaction ID: TXN9988776655. Please download the receipts.'
        ),
        screenshot: jest.fn().mockResolvedValue(Buffer.from('')),
      };

      const ctx: any = {
        bookingCode: 'TA-10036',
        requestedDate: '2026-11-19',
        selectedTimeSlot: '03:00 - 04:00',
        requestedRoute: 'Pamba',
      };

      const res = await SabarimalaPostLoginFlow.executePaymentProceedAndConfirm(mockPage, ctx);
      expect(res.confirmed).toBe(true);
      expect(res.officialReference).toBe('TXN9988776655');
      expect(modalDismissed).toBe(true);
    });

    it('10. selectPostLoginTimeSlot throws SLOT_CARDS_MISSING and stops when no slot cards appear', async () => {
      const mockPage: any = {
        waitForTimeout: jest.fn().mockResolvedValue(undefined),
        locator: jest.fn().mockImplementation((sel: string) => ({
          first: () => ({
            waitFor: jest.fn().mockResolvedValue(undefined),
            isVisible: jest.fn().mockResolvedValue(false),
          }),
          count: jest.fn().mockResolvedValue(0), // No slot cards!
        })),
        screenshot: jest.fn().mockResolvedValue(Buffer.from('')),
      };

      const ctx: any = {
        bookingCode: 'TA-10039',
        requestedDate: '2026-11-24',
        requestedRoute: 'Pamba',
      };

      await expect(SabarimalaPostLoginFlow.selectPostLoginTimeSlot(mockPage, ctx)).rejects.toThrow(
        /SLOT_CARDS_MISSING/
      );
    });

    it('11. addToWishlistAndVerify verifies item directly in side-panel drawer without hard route navigation', async () => {
      let navigatedToWishlistUrl = false;
      const mockPage: any = {
        waitForTimeout: jest.fn().mockResolvedValue(undefined),
        url: jest.fn().mockReturnValue('https://sabarimalaonline.org/#/darshan'),
        goto: jest.fn().mockImplementation(async (url: string) => {
          if (url.includes('wishlist')) navigatedToWishlistUrl = true;
        }),
        locator: jest.fn().mockImplementation((sel: string) => ({
          first: () => ({
            isVisible: jest.fn().mockImplementation(async () => {
              if (sel.includes('#regi_continue')) return true;
              if (sel.includes('toast') || sel.includes('alert-success')) return true;
              if (sel.includes('side-drawer') || sel.includes('mat-drawer') || sel.includes('drawer')) return true;
              return false;
            }),
            isEnabled: jest.fn().mockResolvedValue(true),
            scrollIntoViewIfNeeded: jest.fn().mockResolvedValue(undefined),
            click: jest.fn().mockResolvedValue(undefined),
            waitFor: jest.fn().mockResolvedValue(undefined),
            innerText: jest.fn().mockResolvedValue(''),
          }),
          count: jest.fn().mockImplementation(async () => {
            if (sel.includes('table tbody tr')) return 1;
            return 1;
          }),
          nth: jest.fn().mockImplementation(() => ({
            innerText: jest.fn().mockResolvedValue(
              'Virtual-Q Darshan Date: 24-11-2026 Time: 04:00 - 05:00 Pilgrims: 1 Amount: ₹0'
            ),
          })),
        })),
        innerText: jest.fn().mockResolvedValue(''),
        screenshot: jest.fn().mockResolvedValue(Buffer.from('')),
      };

      const ctx: any = {
        bookingCode: 'TA-10039',
        requestedDate: '2026-11-24',
        requestedDateDisplay: '24-11-2026',
        selectedTimeSlot: '04:00 - 05:00',
      };

      const verified = await SabarimalaPostLoginFlow.addToWishlistAndVerify(mockPage, ctx);
      expect(verified).toBe(true);
      // Hard page.goto to #/wishlist must NOT have been called since side-panel was active!
      expect(navigatedToWishlistUrl).toBe(false);
    });

    it('12. matchesDate strictly matches valid date variations without accepting false dates', () => {
      // Valid matching formats for 2026-11-24
      expect(SabarimalaPostLoginFlow.matchesDate('Virtual-Q 24-11-2026 Slot: 04:00', '2026-11-24', '24-11-2026')).toBe(true);
      expect(SabarimalaPostLoginFlow.matchesDate('Darshan on 24/11/2026', '2026-11-24', '24-11-2026')).toBe(true);
      expect(SabarimalaPostLoginFlow.matchesDate('Booking 24 Nov 2026', '2026-11-24', '24-11-2026')).toBe(true);
      expect(SabarimalaPostLoginFlow.matchesDate('24 November 2026', '2026-11-24', '24-11-2026')).toBe(true);

      // Must reject different dates
      expect(SabarimalaPostLoginFlow.matchesDate('Virtual-Q 25-11-2026 Slot: 04:00', '2026-11-24', '24-11-2026')).toBe(false);
      expect(SabarimalaPostLoginFlow.matchesDate('Virtual-Q 24-10-2026 Slot: 04:00', '2026-11-24', '24-11-2026')).toBe(false);
      expect(SabarimalaPostLoginFlow.matchesDate('Virtual-Q 14-11-2026 Slot: 04:00', '2026-11-24', '24-11-2026')).toBe(false);
    });
  });
});
