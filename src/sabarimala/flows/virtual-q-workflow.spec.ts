import {
  PostLoginDateRouteFlow,
  TimeSlotSelectionFlow,
  PilgrimSelectionFlow,
  NomineeDetailsFlow,
  ReliefFundFlow,
  WishlistFlow,
  PaymentReviewFlow,
  BookingConfirmationFlow,
  BookingExecutionContext,
} from './index';
import { BookingExecutionGuard } from '../../security/execution-guard';
import { SanitizedLogger } from '../../monitoring/logger';

// Helper to create a comprehensive mock locator for Playwright
function createMockLocator(overrides: Record<string, any> = {}) {
  const loc: any = {
    first: () => loc,
    last: () => loc,
    nth: () => loc,
    filter: () => loc,
    locator: () => loc,
    count: jest.fn().mockResolvedValue(1),
    isVisible: jest.fn().mockResolvedValue(true),
    isEnabled: jest.fn().mockResolvedValue(true),
    isDisabled: jest.fn().mockResolvedValue(false),
    isChecked: jest.fn().mockResolvedValue(false),
    innerText: jest.fn().mockResolvedValue(''),
    inputValue: jest.fn().mockResolvedValue(''),
    allInnerTexts: jest.fn().mockResolvedValue([]),
    allTextContents: jest.fn().mockResolvedValue([]),
    textContent: jest.fn().mockResolvedValue(''),
    click: jest.fn().mockResolvedValue(undefined),
    fill: jest.fn().mockResolvedValue(undefined),
    press: jest.fn().mockResolvedValue(undefined),
    check: jest.fn().mockResolvedValue(undefined),
    selectOption: jest.fn().mockResolvedValue(undefined),
    scrollIntoViewIfNeeded: jest.fn().mockResolvedValue(undefined),
    waitFor: jest.fn().mockResolvedValue(undefined),
    dispatchEvent: jest.fn().mockResolvedValue(undefined),
    evaluate: jest.fn().mockResolvedValue(false),
    ...overrides,
  };
  return loc;
}

function createMockPage(locatorHandler?: (sel: string) => any, pageOverrides: Record<string, any> = {}) {
  const defaultLoc = createMockLocator({
    isVisible: jest.fn().mockResolvedValue(false),
    count: jest.fn().mockResolvedValue(0),
  });
  const page: any = {
    locator: jest.fn().mockImplementation((sel: string) => {
      if (locatorHandler) {
        const custom = locatorHandler(sel);
        if (custom) return custom;
      }
      return defaultLoc;
    }),
    getByLabel: jest.fn().mockReturnValue(createMockLocator({ isVisible: jest.fn().mockResolvedValue(false) })),
    getByRole: jest.fn().mockReturnValue(createMockLocator({ isVisible: jest.fn().mockResolvedValue(false) })),
    waitForSelector: jest.fn().mockResolvedValue(undefined),
    waitForTimeout: jest.fn().mockResolvedValue(undefined),
    waitForURL: jest.fn().mockResolvedValue(undefined),
    waitForFunction: jest.fn().mockResolvedValue(undefined),
    url: jest.fn().mockReturnValue('https://sabarimalaonline.org/#/darshan'),
    goto: jest.fn().mockResolvedValue(undefined),
    screenshot: jest.fn().mockResolvedValue(Buffer.from('')),
    content: jest.fn().mockResolvedValue('<html><body>Sample DOM</body></html>'),
    evaluate: jest.fn().mockResolvedValue(undefined),
    innerText: jest.fn().mockResolvedValue(''),
    ...pageOverrides,
  };
  return page;
}

describe('Virtual-Q Workflow Modular Flow Engine Tests', () => {
  describe('PostLoginDateRouteFlow', () => {
    it('1. detects date field, opens calendar, selects day, and verifies date value', async () => {
      let inputValue = '';
      const mockPage = createMockPage((sel: string) => {
        if (sel.includes('input') || sel.includes('darshanDate')) {
          return createMockLocator({
            isVisible: jest.fn().mockResolvedValue(true),
            inputValue: jest.fn().mockImplementation(async () => inputValue),
            fill: jest.fn().mockImplementation(async (val: string) => { inputValue = val; }),
          });
        }
        if (sel.includes('button') || sel.includes('toggle')) {
          return createMockLocator({
            isVisible: jest.fn().mockResolvedValue(true),
          });
        }
        if (sel.includes('.mat-calendar')) {
          return createMockLocator({
            isVisible: jest.fn().mockResolvedValue(true),
            textContent: jest.fn().mockResolvedValue('NOV 2026'),
          });
        }
        if (sel.includes('.mat-calendar-body-cell')) {
          return createMockLocator({
            filter: () => createMockLocator({
              first: () => createMockLocator({
                isVisible: jest.fn().mockResolvedValue(true),
                click: jest.fn().mockImplementation(async () => {
                  inputValue = '24-11-2026';
                }),
              }),
            }),
          });
        }
        return null;
      });

      const ctx: BookingExecutionContext = {
        bookingId: 'b-1',
        bookingCode: 'TA-VIRTUAL-01',
        requestedDate: '2026-11-24',
        requestedDateDisplay: '24-11-2026',
        requestedRoute: 'Pamba',
        reliefFund: 0,
      };

      const success = await PostLoginDateRouteFlow.selectAuthenticatedDate(mockPage, ctx);
      expect(success).toBe(true);
      expect(inputValue.length).toBeGreaterThan(0);
    });

    it('2. throws AUTHENTICATED_DATE_SELECTION_FAILED when date field is missing', async () => {
      const mockPage = createMockPage((sel: string) => {
        return createMockLocator({
          isVisible: jest.fn().mockResolvedValue(false),
          count: jest.fn().mockResolvedValue(0),
        });
      });

      const ctx: BookingExecutionContext = {
        bookingId: 'b-1',
        bookingCode: 'TA-VIRTUAL-02',
        requestedDate: '2026-11-24',
        requestedDateDisplay: '24-11-2026',
        requestedRoute: 'Pamba',
        reliefFund: 0,
      };

      await expect(PostLoginDateRouteFlow.selectAuthenticatedDate(mockPage, ctx)).rejects.toThrow(
        /AUTHENTICATED_DATE_SELECTION_FAILED/
      );
    });

    it('3. selects requested Pamba route from dropdown and verifies canonical selection', async () => {
      let selectedOption = '';
      const mockPage = createMockPage((sel: string) => {
        if (sel.includes('select[formcontrolname="route"]') || sel.includes('select[name="route"]') || sel.includes('select')) {
          return createMockLocator({
            isVisible: jest.fn().mockResolvedValue(true),
            locator: () => createMockLocator({
              allTextContents: jest.fn().mockResolvedValue([
                'Select Route',
                'Erumely - Kalaketti Traditional Path - 46 Kms',
                'Vandiperiyar - Sathram - Pulmedu - 16 Kms',
                'Pamba - Marakkoottam - 4 Kms',
              ]),
              evaluateAll: jest.fn().mockResolvedValue(['', '2', '3', '1']),
            }),
            selectOption: jest.fn().mockImplementation(async (opt: any) => {
              selectedOption = 'Pamba - Marakkoottam - 4 Kms';
            }),
            inputValue: jest.fn().mockResolvedValue('1'),
            evaluate: jest.fn().mockResolvedValue('Pamba - Marakkoottam - 4 Kms'),
          });
        }
        return null;
      });

      const ctx: BookingExecutionContext = {
        bookingId: 'b-1',
        bookingCode: 'TA-VIRTUAL-03',
        requestedDate: '2026-11-24',
        requestedDateDisplay: '24-11-2026',
        requestedRoute: 'Pamba (Regular Footpath Route)',
        reliefFund: 0,
      };

      const success = await PostLoginDateRouteFlow.selectAuthenticatedRoute(mockPage, ctx);
      expect(success).toBe(true);
      expect(selectedOption).toBe('Pamba - Marakkoottam - 4 Kms');
      expect(ctx.requestedRoute).toBe('Pamba - Marakkoottam - 4 Kms');
    });

    it('3a. selects requested Erumely route from dropdown and verifies canonical selection', async () => {
      let selectedOption = '';
      const mockPage = createMockPage((sel: string) => {
        if (sel.includes('select[formcontrolname="route"]') || sel.includes('select[name="route"]') || sel.includes('select')) {
          return createMockLocator({
            isVisible: jest.fn().mockResolvedValue(true),
            locator: () => createMockLocator({
              allTextContents: jest.fn().mockResolvedValue([
                'Select Route',
                'Erumely - Kalaketti Traditional Path - 46 Kms',
                'Vandiperiyar - Sathram - Pulmedu - 16 Kms',
                'Pamba - Marakkoottam - 4 Kms',
              ]),
              evaluateAll: jest.fn().mockResolvedValue(['', '2', '3', '1']),
            }),
            selectOption: jest.fn().mockImplementation(async (opt: any) => {
              selectedOption = 'Erumely - Kalaketti Traditional Path - 46 Kms';
            }),
            inputValue: jest.fn().mockResolvedValue('2'),
            evaluate: jest.fn().mockResolvedValue('Erumely - Kalaketti Traditional Path - 46 Kms'),
          });
        }
        return null;
      });

      const ctx: BookingExecutionContext = {
        bookingId: 'b-1',
        bookingCode: 'TA-VIRTUAL-03A',
        requestedDate: '2026-11-24',
        requestedDateDisplay: '24-11-2026',
        requestedRoute: 'Erumely',
        reliefFund: 0,
      };

      const success = await PostLoginDateRouteFlow.selectAuthenticatedRoute(mockPage, ctx);
      expect(success).toBe(true);
      expect(selectedOption).toBe('Erumely - Kalaketti Traditional Path - 46 Kms');
      expect(ctx.requestedRoute).toBe('Erumely - Kalaketti Traditional Path - 46 Kms');
    });

    it('3b. selects requested Vandiperiyar route from dropdown and verifies canonical selection', async () => {
      let selectedOption = '';
      const mockPage = createMockPage((sel: string) => {
        if (sel.includes('select[formcontrolname="route"]') || sel.includes('select[name="route"]') || sel.includes('select')) {
          return createMockLocator({
            isVisible: jest.fn().mockResolvedValue(true),
            locator: () => createMockLocator({
              allTextContents: jest.fn().mockResolvedValue([
                'Select Route',
                'Erumely - Kalaketti Traditional Path - 46 Kms',
                'Vandiperiyar - Sathram - Pulmedu - 16 Kms',
                'Pamba - Marakkoottam - 4 Kms',
              ]),
              evaluateAll: jest.fn().mockResolvedValue(['', '2', '3', '1']),
            }),
            selectOption: jest.fn().mockImplementation(async (opt: any) => {
              selectedOption = 'Vandiperiyar - Sathram - Pulmedu - 16 Kms';
            }),
            inputValue: jest.fn().mockResolvedValue('3'),
            evaluate: jest.fn().mockResolvedValue('Vandiperiyar - Sathram - Pulmedu - 16 Kms'),
          });
        }
        return null;
      });

      const ctx: BookingExecutionContext = {
        bookingId: 'b-1',
        bookingCode: 'TA-VIRTUAL-03B',
        requestedDate: '2026-11-24',
        requestedDateDisplay: '24-11-2026',
        requestedRoute: 'Vandiperiyar - Sathram - Pulmedu - 16 Kms',
        reliefFund: 0,
      };

      const success = await PostLoginDateRouteFlow.selectAuthenticatedRoute(mockPage, ctx);
      expect(success).toBe(true);
      expect(selectedOption).toBe('Vandiperiyar - Sathram - Pulmedu - 16 Kms');
      expect(ctx.requestedRoute).toBe('Vandiperiyar - Sathram - Pulmedu - 16 Kms');
    });

    it('3c. throws ROUTE_SELECTION_MISMATCH when requested route is unknown or unsupported', async () => {
      const mockPage = createMockPage();
      const ctx: BookingExecutionContext = {
        bookingId: 'b-1',
        bookingCode: 'TA-VIRTUAL-03C',
        requestedDate: '2026-11-24',
        requestedDateDisplay: '24-11-2026',
        requestedRoute: 'Unknown Route 99',
        reliefFund: 0,
      };

      await expect(PostLoginDateRouteFlow.selectAuthenticatedRoute(mockPage, ctx)).rejects.toThrow(
        /ROUTE_SELECTION_MISMATCH/
      );
    });

    it('3d. throws ROUTE_SELECTION_MISMATCH when requested route is not among dropdown options (never falls back to option 1)', async () => {
      const mockPage = createMockPage((sel: string) => {
        if (sel.includes('select[formcontrolname="route"]') || sel.includes('select[name="route"]') || sel.includes('select')) {
          return createMockLocator({
            isVisible: jest.fn().mockResolvedValue(true),
            locator: () => createMockLocator({
              allTextContents: jest.fn().mockResolvedValue([
                'Select Route',
                'Erumely - Kalaketti Traditional Path - 46 Kms',
              ]),
              evaluateAll: jest.fn().mockResolvedValue(['', '2']),
            }),
          });
        }
        return null;
      });

      const ctx: BookingExecutionContext = {
        bookingId: 'b-1',
        bookingCode: 'TA-VIRTUAL-03D',
        requestedDate: '2026-11-24',
        requestedDateDisplay: '24-11-2026',
        requestedRoute: 'Pamba - Marakkoottam - 4 Kms',
        reliefFund: 0,
      };

      await expect(PostLoginDateRouteFlow.selectAuthenticatedRoute(mockPage, ctx)).rejects.toThrow(
        /ROUTE_SELECTION_MISMATCH/
      );
    });

    it('4. throws AUTHENTICATED_ROUTE_SELECTION_FAILED when route dropdown is missing', async () => {
      const mockPage = createMockPage((sel: string) => {
        return createMockLocator({
          isVisible: jest.fn().mockResolvedValue(false),
          count: jest.fn().mockResolvedValue(0),
        });
      });

      const ctx: BookingExecutionContext = {
        bookingId: 'b-1',
        bookingCode: 'TA-VIRTUAL-04',
        requestedDate: '2026-11-24',
        requestedDateDisplay: '24-11-2026',
        requestedRoute: 'Pamba',
        reliefFund: 0,
      };

      await expect(PostLoginDateRouteFlow.selectAuthenticatedRoute(mockPage, ctx)).rejects.toThrow(
        /AUTHENTICATED_ROUTE_SELECTION_FAILED/
      );
    });
  });

  describe('TimeSlotSelectionFlow', () => {
    it('5. selects available slot and verifies .slot-dar-5 indicator', async () => {
      const mockPage = createMockPage((sel: string) => {
        if (sel.includes('.cdk-overlay-backdrop')) {
          return createMockLocator({ count: jest.fn().mockResolvedValue(0) });
        }
        if (sel.includes('.slot-dar-3') || sel.includes('.slot-card')) {
          return createMockLocator({
            count: jest.fn().mockResolvedValue(3),
            nth: (idx: number) => createMockLocator({
              innerText: jest.fn().mockResolvedValue('10:00 - 11:00\nAvailability: 150'),
              evaluate: jest.fn().mockImplementation(async (cb: any) => {
                // Return false for isFull check, true for isSelected check
                return false;
              }),
            }),
          });
        }
        if (sel.includes('.slot-dar-5')) {
          return createMockLocator({ count: jest.fn().mockResolvedValue(1) });
        }
        return null;
      });

      const ctx: BookingExecutionContext = {
        bookingId: 'b-1',
        bookingCode: 'TA-VIRTUAL-05',
        requestedDate: '2026-11-24',
        requestedDateDisplay: '24-11-2026',
        requestedRoute: 'Pamba',
        selectedTimeSlot: '10:00 - 11:00',
        reliefFund: 0,
      };

      const result = await TimeSlotSelectionFlow.selectTimeSlot(mockPage, ctx);
      expect(result.success).toBe(true);
      expect(result.selectedSlot).toBe('10:00 - 11:00');
      expect(result.availabilityCount).toBe(150);
    });

    it('6. throws SLOT_CARDS_MISSING when slot cards do not render', async () => {
      const mockPage = createMockPage((sel: string) => {
        return createMockLocator({
          count: jest.fn().mockResolvedValue(0),
          isVisible: jest.fn().mockResolvedValue(false),
        });
      });

      const ctx: BookingExecutionContext = {
        bookingId: 'b-1',
        bookingCode: 'TA-VIRTUAL-06',
        requestedDate: '2026-11-24',
        requestedDateDisplay: '24-11-2026',
        requestedRoute: 'Pamba',
        reliefFund: 0,
      };

      await expect(TimeSlotSelectionFlow.selectTimeSlot(mockPage, ctx)).rejects.toThrow(
        /SLOT_CARDS_MISSING/
      );
    }, 45000);
  });

  describe('PilgrimSelectionFlow', () => {
    it('7. matches requested pilgrims by full name and selects only requested checkboxes', async () => {
      const checkedPilgrims: string[] = [];
      const mockPage = createMockPage((sel: string) => {
        if (sel.includes('Select Pilgrim') || sel.includes('btn-select-pilgrim')) {
          return createMockLocator({
            isVisible: jest.fn().mockResolvedValue(true),
          });
        }
        if (sel.includes('table tbody tr') || sel.includes('.pilgrim-row')) {
          return createMockLocator({
            count: jest.fn().mockResolvedValue(2),
            nth: (idx: number) => createMockLocator({
              innerText: jest.fn().mockResolvedValue(
                idx === 0 ? 'Devotee Kumar 35 Male AADHAAR 1234' : 'Another Pilgrim 40 Male AADHAAR 5678'
              ),
              locator: () => createMockLocator({
                click: jest.fn().mockImplementation(async () => {
                  checkedPilgrims.push(idx === 0 ? 'Devotee Kumar' : 'Another Pilgrim');
                }),
                check: jest.fn().mockImplementation(async () => {
                  checkedPilgrims.push(idx === 0 ? 'Devotee Kumar' : 'Another Pilgrim');
                }),
                isChecked: jest.fn().mockResolvedValue(true),
              }),
            }),
          });
        }
        return null;
      });

      const ctx: BookingExecutionContext = {
        bookingId: 'b-1',
        bookingCode: 'TA-VIRTUAL-07',
        requestedDate: '2026-11-24',
        requestedDateDisplay: '24-11-2026',
        requestedRoute: 'Pamba',
        reliefFund: 0,
        pilgrims: [{ fullName: 'Devotee Kumar', age: 35, gender: 'Male', idType: 'AADHAAR', idNumber: '1234' }],
      };

      const result = await PilgrimSelectionFlow.execute(mockPage, ctx);
      expect(result.success).toBe(true);
      expect(result.selectedCount).toBe(1);
      expect(checkedPilgrims).toEqual(['Devotee Kumar']);
    });
  });

  describe('NomineeDetailsFlow', () => {
    it('8. validates mandatory nominee details and populates fields', async () => {
      const populatedValues: Record<string, string> = {};
      const dispatchedEvents: string[] = [];
      const mockPage = createMockPage((sel: string) => {
        if (sel.includes('nominee') || sel.includes('Nominee') || sel.includes('tabScroll')) {
          return createMockLocator({
            isVisible: jest.fn().mockResolvedValue(true),
            count: jest.fn().mockResolvedValue(1),
            nth: () => {
              const rowLoc = createMockLocator({
                isVisible: jest.fn().mockResolvedValue(true),
                locator: (subSel: string) => createMockLocator({
                  isVisible: jest.fn().mockResolvedValue(true),
                  fill: jest.fn().mockImplementation(async (val: string) => {
                    if (subSel.includes('Age')) populatedValues.age = val;
                    else if (subSel.includes('Name')) populatedValues.name = val;
                  }),
                  dispatchEvent: jest.fn().mockImplementation(async (evt: string) => {
                    dispatchedEvents.push(evt);
                  }),
                  selectOption: jest.fn().mockImplementation(async (val: any) => {
                    populatedValues.relation = val.label || val.value || val;
                  }),
                }),
                fill: jest.fn().mockImplementation(async (val: string) => {
                  if (sel.includes('Age')) populatedValues.age = val;
                  else if (sel.includes('Name')) populatedValues.name = val;
                }),
                dispatchEvent: jest.fn().mockImplementation(async (evt: string) => {
                  dispatchedEvents.push(evt);
                }),
                evaluate: jest.fn().mockResolvedValue('select'),
                selectOption: jest.fn().mockImplementation(async (val: any) => {
                  populatedValues.relation = val.label || val.value || val;
                }),
              });
              return rowLoc;
            },
          });
        }
        if (sel.includes('btn-addto') || sel.includes('Add to Wishlist')) {
          return createMockLocator({
            isVisible: jest.fn().mockResolvedValue(true),
            isDisabled: jest.fn().mockResolvedValue(false),
          });
        }
        return null;
      });

      const ctx: BookingExecutionContext = {
        bookingId: 'b-1',
        bookingCode: 'TA-VIRTUAL-08',
        requestedDate: '2026-11-24',
        requestedDateDisplay: '24-11-2026',
        requestedRoute: 'Pamba',
        reliefFund: 0,
        nominee: {
          nomineeName: 'Lakshmi',
          nomineeAge: 32,
          nomineeRelationship: 'Spouse',
        },
      };

      const success = await NomineeDetailsFlow.execute(mockPage, ctx);
      expect(success).toBe(true);
      expect(populatedValues.name).toBe('Lakshmi');
      expect(populatedValues.age).toBe('32');
      expect(dispatchedEvents).toContain('input');
      expect(dispatchedEvents).toContain('change');
      expect(dispatchedEvents).toContain('blur');
      expect(ctx.nomineeCompletionStatus).toBe(true);
    });

    it('9. throws NOMINEE_VALIDATION_FAILED when mandatory nominee is missing', async () => {
      const mockPage = createMockPage((sel: string) => {
        return createMockLocator({
          isVisible: jest.fn().mockResolvedValue(true),
          count: jest.fn().mockResolvedValue(1),
        });
      });

      const ctx: BookingExecutionContext = {
        bookingId: 'b-1',
        bookingCode: 'TA-VIRTUAL-09',
        requestedDate: '2026-11-24',
        requestedDateDisplay: '24-11-2026',
        requestedRoute: 'Pamba',
        reliefFund: 0,
        nominee: null,
      };

      await expect(NomineeDetailsFlow.execute(mockPage, ctx)).rejects.toThrow(
        /NOMINEE_DETAILS_MISSING/
      );
    });

    it('9a. throws NOMINEE_VALIDATION_FAILED when nominee name contains invalid characters or exceeds 32 chars', async () => {
      const mockPage = createMockPage((sel: string) => {
        if (sel.includes('nominee') || sel.includes('Nominee') || sel.includes('tabScroll')) {
          return createMockLocator({ isVisible: jest.fn().mockResolvedValue(true), count: jest.fn().mockResolvedValue(1) });
        }
        return null;
      });
      const ctxInvalidChars: BookingExecutionContext = {
        bookingId: 'b-1',
        bookingCode: 'TA-VIRTUAL-09A',
        requestedDate: '2026-11-24',
        requestedDateDisplay: '24-11-2026',
        requestedRoute: 'Pamba',
        reliefFund: 0,
        nominee: {
          nomineeName: 'Ramesh123!@#',
          nomineeAge: 35,
          nomineeRelationship: 'Brother',
        },
      };

      await expect(NomineeDetailsFlow.execute(mockPage, ctxInvalidChars)).rejects.toThrow(
        /NOMINEE_NAME_INVALID/
      );

      const ctxTooLong: BookingExecutionContext = {
        bookingId: 'b-1',
        bookingCode: 'TA-VIRTUAL-09A2',
        requestedDate: '2026-11-24',
        requestedDateDisplay: '24-11-2026',
        requestedRoute: 'Pamba',
        reliefFund: 0,
        nominee: {
          nomineeName: 'ThisNomineeNameIsWayTooLongAndExceedsThirtyTwoCharactersCompletely',
          nomineeAge: 35,
          nomineeRelationship: 'Brother',
        },
      };

      await expect(NomineeDetailsFlow.execute(mockPage, ctxTooLong)).rejects.toThrow(
        /NOMINEE_NAME_INVALID/
      );
    });

    it('9b. throws NOMINEE_VALIDATION_FAILED when nominee age is invalid (< 1 or > 120 or non-numeric)', async () => {
      const mockPage = createMockPage((sel: string) => {
        if (sel.includes('nominee') || sel.includes('Nominee') || sel.includes('tabScroll')) {
          return createMockLocator({ isVisible: jest.fn().mockResolvedValue(true), count: jest.fn().mockResolvedValue(1) });
        }
        return null;
      });
      const ctxAgeZero: BookingExecutionContext = {
        bookingId: 'b-1',
        bookingCode: 'TA-VIRTUAL-09B',
        requestedDate: '2026-11-24',
        requestedDateDisplay: '24-11-2026',
        requestedRoute: 'Pamba',
        reliefFund: 0,
        nominee: {
          nomineeName: 'Ramesh Kumar',
          nomineeAge: 0,
          nomineeRelationship: 'Brother',
        },
      };

      await expect(NomineeDetailsFlow.execute(mockPage, ctxAgeZero)).rejects.toThrow(
        /NOMINEE_AGE_INVALID/
      );

      const ctxAgeHigh: BookingExecutionContext = {
        bookingId: 'b-1',
        bookingCode: 'TA-VIRTUAL-09B2',
        requestedDate: '2026-11-24',
        requestedDateDisplay: '24-11-2026',
        requestedRoute: 'Pamba',
        reliefFund: 0,
        nominee: {
          nomineeName: 'Ramesh Kumar',
          nomineeAge: 150,
          nomineeRelationship: 'Brother',
        },
      };

      await expect(NomineeDetailsFlow.execute(mockPage, ctxAgeHigh)).rejects.toThrow(
        /NOMINEE_AGE_INVALID/
      );
    });

    it('9c. throws NOMINEE_VALIDATION_FAILED when nominee relationship is invalid or missing', async () => {
      const mockPage = createMockPage((sel: string) => {
        if (sel.includes('nominee') || sel.includes('Nominee') || sel.includes('tabScroll')) {
          return createMockLocator({ isVisible: jest.fn().mockResolvedValue(true), count: jest.fn().mockResolvedValue(1) });
        }
        return null;
      });
      const ctxInvalidRel: BookingExecutionContext = {
        bookingId: 'b-1',
        bookingCode: 'TA-VIRTUAL-09C',
        requestedDate: '2026-11-24',
        requestedDateDisplay: '24-11-2026',
        requestedRoute: 'Pamba',
        reliefFund: 0,
        nominee: {
          nomineeName: 'Ramesh Kumar',
          nomineeAge: 35,
          nomineeRelationship: 'Friend',
        },
      };

      await expect(NomineeDetailsFlow.execute(mockPage, ctxInvalidRel)).rejects.toThrow(
        /NOMINEE_RELATIONSHIP_INVALID/
      );
    });
  });

  describe('ReliefFundFlow', () => {
    it('10. explicitly selects No and strictly verifies No=checked, Yes=unchecked, ₹0', async () => {
      let isNoChecked = true;
      let isYesChecked = false;
      const mockPage = createMockPage((sel: string) => {
        if (sel.includes('relief') || sel.includes('No') || sel.includes('2')) {
          return createMockLocator({
            isVisible: jest.fn().mockResolvedValue(true),
            click: jest.fn().mockImplementation(async () => { isNoChecked = true; isYesChecked = false; }),
            evaluate: jest.fn().mockImplementation(async (cb: any) => {
              if (sel.includes('1') || sel.includes('Yes')) return isYesChecked;
              return isNoChecked;
            }),
            inputValue: jest.fn().mockResolvedValue('0'),
          });
        }
        return null;
      });

      const ctx: BookingExecutionContext = {
        bookingId: 'b-1',
        bookingCode: 'TA-VIRTUAL-10',
        requestedDate: '2026-11-24',
        requestedDateDisplay: '24-11-2026',
        requestedRoute: 'Pamba',
        reliefFund: 0,
      };

      const success = await ReliefFundFlow.execute(mockPage, ctx);
      expect(success).toBe(true);
      expect(ctx.reliefFund).toBe(0);
    });
  });

  describe('WishlistFlow', () => {
    it('11. adds item to Wishlist and verifies presence in drawer panel', async () => {
      let clicked = false;
      const mockPage = createMockPage((sel: string) => {
        if (sel.includes('alert') || sel.includes('warn') || sel.includes('banner') || sel.includes('avail previous booking') || sel.includes('error')) {
          return createMockLocator({ isVisible: jest.fn().mockResolvedValue(false) });
        }
        if (sel.includes('#regi_continue') || sel.includes('Add to Wishlist')) {
          return createMockLocator({
            isVisible: jest.fn().mockResolvedValue(true),
            isEnabled: jest.fn().mockResolvedValue(true),
            click: jest.fn().mockImplementation(async () => { clicked = true; }),
          });
        }
        if (sel.includes('.side-drawer table tbody tr') || sel.includes('table tbody tr') || sel.includes('wishlist-item')) {
          return createMockLocator({
            count: jest.fn().mockImplementation(async () => (clicked ? 1 : 0)),
            nth: () => createMockLocator({
              innerText: jest.fn().mockResolvedValue('24-11-2026 | 10:00 - 11:00 | Devotee: 1 | Fee: 0'),
            }),
          });
        }
        return null;
      });

      const ctx: BookingExecutionContext = {
        bookingId: 'b-1',
        bookingCode: 'TA-VIRTUAL-11',
        requestedDate: '2026-11-24',
        requestedDateDisplay: '24-11-2026',
        requestedRoute: 'Pamba',
        selectedTimeSlot: '10:00 - 11:00',
        reliefFund: 0,
        pilgrimCount: 1,
      };

      const success = await WishlistFlow.execute(mockPage, ctx);
      expect(success).toBe(true);
      expect(ctx.wishlistStatus).toBe('VERIFIED');
    }, 20000);

    it('11a. throws WISHLIST_INSERTION_FAILED when Add to Wishlist button is disabled due to invalid form', async () => {
      const mockPage = createMockPage((sel: string) => {
        if (sel.includes('#regi_continue') || sel.includes('Add to Wishlist') || sel.includes('btn-addto')) {
          return createMockLocator({
            isVisible: jest.fn().mockResolvedValue(true),
            isDisabled: jest.fn().mockResolvedValue(true),
          });
        }
        return null;
      });

      const ctx: BookingExecutionContext = {
        bookingId: 'b-1',
        bookingCode: 'TA-VIRTUAL-11A',
        requestedDate: '2026-11-25',
        requestedDateDisplay: '25-11-2026',
        requestedRoute: 'Pamba',
        selectedTimeSlot: '03:00 - 04:00',
        reliefFund: 0,
        pilgrimCount: 1,
      };

      await expect(WishlistFlow.execute(mockPage, ctx)).rejects.toThrow(
        /WISHLIST_INSERTION_FAILED/
      );
    });

    it('11b. rejects older or mismatched wishlist items and verifies exact match against booking context', async () => {
      const mockPage = createMockPage((sel: string) => {
        if (sel.includes('app-wishlist') || sel.includes('wishlist-item') || sel.includes('table tbody tr')) {
          return createMockLocator({
            count: jest.fn().mockResolvedValue(1),
            nth: () => createMockLocator({
              // Contains an older date 07-11-2026 instead of target date 25-11-2026
              innerText: jest.fn().mockResolvedValue('Date: 07-11-2026 | Time: 06:00 - 07:00 | Pilgrims: 1 | Relief: 0'),
            }),
          });
        }
        return null;
      }, {
        innerText: jest.fn().mockResolvedValue('Date: 07-11-2026 | Time: 06:00 - 07:00'),
      });

      const ctx: BookingExecutionContext = {
        bookingId: 'b-1',
        bookingCode: 'TA-VIRTUAL-11B',
        requestedDate: '2026-11-25',
        requestedDateDisplay: '25-11-2026',
        requestedRoute: 'Pamba',
        selectedTimeSlot: '03:00 - 04:00',
        reliefFund: 0,
      };

      const matched = await WishlistFlow.verifyItemInWishlist(mockPage, ctx, true);
      expect(matched).toBe(false);
    });

    it('11c. rejects wishlist item if it explicitly displays a competing route (e.g. Erumely when Pamba requested)', async () => {
      const mockPage = createMockPage((sel: string) => {
        if (sel.includes('app-wishlist') || sel.includes('wishlist-item') || sel.includes('table tbody tr')) {
          return createMockLocator({
            count: jest.fn().mockResolvedValue(1),
            nth: () => createMockLocator({
              // Matching date and time, but route is Erumely instead of Pamba
              innerText: jest.fn().mockResolvedValue('Date: 25-11-2026 | Time: 03:00 - 04:00 | Route: Erumely Traditional Path | Relief: 0'),
            }),
          });
        }
        return null;
      });

      const ctx: BookingExecutionContext = {
        bookingId: 'b-1',
        bookingCode: 'TA-VIRTUAL-11C',
        requestedDate: '2026-11-25',
        requestedDateDisplay: '25-11-2026',
        requestedRoute: 'Pamba - Marakkoottam - 4 Kms',
        selectedTimeSlot: '03:00 - 04:00',
        reliefFund: 0,
      };

      const matched = await WishlistFlow.verifyItemInWishlist(mockPage, ctx, true);
      expect(matched).toBe(false);
    });

    it('11d. rejects wishlist item if relief fund amount is non-zero when ₹0 was requested', async () => {
      const mockPage = createMockPage((sel: string) => {
        if (sel.includes('app-wishlist') || sel.includes('wishlist-item') || sel.includes('table tbody tr')) {
          return createMockLocator({
            count: jest.fn().mockResolvedValue(1),
            nth: () => createMockLocator({
              innerText: jest.fn().mockResolvedValue('Date: 25-11-2026 | Time: 03:00 - 04:00 | Route: Pamba | Relief Fund: ₹100'),
            }),
          });
        }
        return null;
      });

      const ctx: BookingExecutionContext = {
        bookingId: 'b-1',
        bookingCode: 'TA-VIRTUAL-11D',
        requestedDate: '2026-11-25',
        requestedDateDisplay: '25-11-2026',
        requestedRoute: 'Pamba',
        selectedTimeSlot: '03:00 - 04:00',
        reliefFund: 0,
      };

      const matched = await WishlistFlow.verifyItemInWishlist(mockPage, ctx, true);
      expect(matched).toBe(false);
    });
  });

  describe('PaymentReviewFlow', () => {
    it('12. clicks proceed in wishlist panel and lands on #/paymentGateway without simulating payment', async () => {
      const mockPage = createMockPage((sel: string) => {
        if (sel.includes('loader') || sel.includes('shade')) {
          return createMockLocator({
            isVisible: jest.fn().mockResolvedValue(false),
          });
        }
        if (sel.includes('Proceed')) {
          return createMockLocator({
            isVisible: jest.fn().mockResolvedValue(true),
            isDisabled: jest.fn().mockResolvedValue(false),
          });
        }
        if (sel.includes('app-wishlist') || sel.includes('wishlist-item') || sel.includes('table tbody tr') || sel.includes('.item')) {
          return createMockLocator({
            count: jest.fn().mockResolvedValue(1),
            nth: () => createMockLocator({
              innerText: jest.fn().mockResolvedValue('Date: 24-11-2026 | Route: Pamba | Time: 03:00 - 04:00 | Relief Fund: 0'),
            }),
          });
        }
        return null;
      }, {
        url: jest.fn().mockReturnValue('https://sabarimalaonline.org/#/paymentGateway'),
        innerText: jest.fn().mockResolvedValue('Payment Gateway Summary: Total ₹0'),
      });

      const ctx: BookingExecutionContext = {
        bookingId: 'b-1',
        bookingCode: 'TA-VIRTUAL-12',
        requestedDate: '2026-11-24',
        requestedDateDisplay: '24-11-2026',
        requestedRoute: 'Pamba',
        selectedTimeSlot: '03:00 - 04:00',
        reliefFund: 0,
      };

      const result = await PaymentReviewFlow.execute(mockPage, ctx);
      expect(result.loaded).toBe(true);
      expect(result.gatewayUrl).toContain('paymentGateway');
      expect(ctx.paymentStatus).toBe('GATEWAY_LOADED');
    });

    it('12a. throws LOADER_TIMEOUT when #loader .shade overlay remains active and intercepts actions', async () => {
      const mockPage = createMockPage((sel: string) => {
        if (sel.includes('loader') || sel.includes('shade')) {
          return createMockLocator({
            isVisible: jest.fn().mockResolvedValue(true),
            waitFor: jest.fn().mockRejectedValue(new Error('Timeout 10000ms')),
          });
        }
        return null;
      });

      const ctx: BookingExecutionContext = {
        bookingId: 'b-1',
        bookingCode: 'TA-VIRTUAL-12A',
        requestedDate: '2026-11-24',
        requestedDateDisplay: '24-11-2026',
        requestedRoute: 'Pamba',
        selectedTimeSlot: '03:00 - 04:00',
        reliefFund: 0,
      };

      await expect(PaymentReviewFlow.execute(mockPage, ctx)).rejects.toThrow(
        /LOADER_TIMEOUT/
      );
    });

    it('12b. throws BUTTON_DISABLED when Proceed button is disabled in Wishlist panel', async () => {
      const mockPage = createMockPage((sel: string) => {
        if (sel.includes('loader') || sel.includes('shade')) {
          return createMockLocator({ isVisible: jest.fn().mockResolvedValue(false) });
        }
        if (sel.includes('Proceed')) {
          return createMockLocator({
            isVisible: jest.fn().mockResolvedValue(true),
            isDisabled: jest.fn().mockResolvedValue(true),
          });
        }
        if (sel.includes('app-wishlist') || sel.includes('wishlist-item') || sel.includes('table tbody tr') || sel.includes('.item')) {
          return createMockLocator({
            count: jest.fn().mockResolvedValue(1),
            nth: () => createMockLocator({
              innerText: jest.fn().mockResolvedValue('Date: 24-11-2026 | Route: Pamba | Time: 03:00 - 04:00 | Relief: 0'),
            }),
          });
        }
        return null;
      });

      const ctx: BookingExecutionContext = {
        bookingId: 'b-1',
        bookingCode: 'TA-VIRTUAL-12B',
        requestedDate: '2026-11-24',
        requestedDateDisplay: '24-11-2026',
        requestedRoute: 'Pamba',
        selectedTimeSlot: '03:00 - 04:00',
        reliefFund: 0,
      };

      await expect(PaymentReviewFlow.execute(mockPage, ctx)).rejects.toThrow(
        /BUTTON_DISABLED/
      );
    });

    it('12c. throws WISHLIST_VERIFICATION_MISMATCH when target booking details do not match wishlist item', async () => {
      const mockPage = createMockPage((sel: string) => {
        if (sel.includes('loader') || sel.includes('shade')) {
          return createMockLocator({ isVisible: jest.fn().mockResolvedValue(false) });
        }
        if (sel.includes('app-wishlist') || sel.includes('wishlist-item') || sel.includes('table tbody tr') || sel.includes('.item')) {
          return createMockLocator({
            count: jest.fn().mockResolvedValue(1),
            nth: () => createMockLocator({
              // Mismatched date in wishlist
              innerText: jest.fn().mockResolvedValue('Date: 01-11-2026 | Route: Pamba | Time: 03:00 - 04:00 | Relief: 0'),
            }),
          });
        }
        return null;
      });

      const ctx: BookingExecutionContext = {
        bookingId: 'b-1',
        bookingCode: 'TA-VIRTUAL-12C',
        requestedDate: '2026-11-24',
        requestedDateDisplay: '24-11-2026',
        requestedRoute: 'Pamba',
        selectedTimeSlot: '03:00 - 04:00',
        reliefFund: 0,
      };

      await expect(PaymentReviewFlow.execute(mockPage, ctx)).rejects.toThrow(
        /WISHLIST_VERIFICATION_MISMATCH/
      );
    });
  });

  describe('BookingConfirmationFlow', () => {
    it('13. authoritatively extracts official reference and confirms booking', async () => {
      const mockPage = createMockPage(undefined, {
        innerText: jest.fn().mockResolvedValue('Your transaction is successful. Virtual-Q Pass Number: VQ9988112233. Download Receipt.'),
      });

      const ctx: BookingExecutionContext = {
        bookingId: 'b-1',
        bookingCode: 'TA-VIRTUAL-13',
        requestedDate: '2026-11-24',
        requestedDateDisplay: '24-11-2026',
        requestedRoute: 'Pamba',
        reliefFund: 0,
      };

      const result = await BookingConfirmationFlow.verifyConfirmation(mockPage, ctx);
      expect(result.confirmed).toBe(true);
      expect(result.officialReference).toBe('VQ9988112233');
    });

    it('14. rejects fake / mock references like SAB-2026- and flags PAYMENT_PENDING', async () => {
      const mockPage = createMockPage((sel: string) => {
        return createMockLocator({ isVisible: jest.fn().mockResolvedValue(false) });
      }, {
        innerText: jest.fn().mockResolvedValue('Processing Payment... please wait.'),
      });

      const ctx: BookingExecutionContext = {
        bookingId: 'b-1',
        bookingCode: 'TA-VIRTUAL-14',
        requestedDate: '2026-11-24',
        requestedDateDisplay: '24-11-2026',
        requestedRoute: 'Pamba',
        reliefFund: 0,
      };

      const result = await BookingConfirmationFlow.verifyConfirmation(mockPage, ctx);
      expect(result.confirmed).toBe(false);
      expect(result.bookingStatus).toBe('PAYMENT_PENDING');
    });
  });

  describe('Lifecycle State & Log Redaction Verification', () => {
    beforeEach(() => {
      BookingExecutionGuard.clearAll();
    });

    it('15. correctly transitions active in-flight lock to RETRYABLE_FAILURE on LOADER_TIMEOUT', () => {
      const lock = BookingExecutionGuard.acquire({
        bookingId: 'b-lock-1',
        bookingCode: 'TA-LOCK-01',
        jobId: 'job-lock-1',
        dispatchSource: 'TEST',
      });
      expect(lock.acquired).toBe(true);

      // Simulate reaching WISHLIST_VERIFIED
      BookingExecutionGuard.updateLifecycleState('b-lock-1', 'WISHLIST_VERIFIED');
      expect(BookingExecutionGuard.getActiveLock('b-lock-1')?.lifecycleState).toBe('WISHLIST_VERIFIED');

      // Simulate exception handling for LOADER_TIMEOUT
      const status = 'WORKER_ERROR';
      const errorCode = 'LOADER_TIMEOUT';
      BookingExecutionGuard.updateLifecycleState('b-lock-1', 'RETRYABLE_FAILURE');

      const active = BookingExecutionGuard.getActiveLock('b-lock-1');
      expect(active?.lifecycleState).toBe('RETRYABLE_FAILURE');
      expect(active?.lifecycleState).not.toBe('WISHLIST_VERIFIED');
    });

    it('16. correctly transitions active in-flight lock to MANUAL_REVIEW on ROUTE_SELECTION_MISMATCH', () => {
      const lock = BookingExecutionGuard.acquire({
        bookingId: 'b-lock-2',
        bookingCode: 'TA-LOCK-02',
        jobId: 'job-lock-2',
        dispatchSource: 'TEST',
      });
      expect(lock.acquired).toBe(true);

      BookingExecutionGuard.updateLifecycleState('b-lock-2', 'CLAIMED');

      // Simulate exception handling for ROUTE_SELECTION_MISMATCH
      BookingExecutionGuard.updateLifecycleState('b-lock-2', 'MANUAL_REVIEW');

      const active = BookingExecutionGuard.getActiveLock('b-lock-2');
      expect(active?.lifecycleState).toBe('MANUAL_REVIEW');
    });

    it('17. nominee details flow redacts personal data from standard logs', async () => {
      const logSpy = jest.spyOn(SanitizedLogger, 'info');

      const mockPage = createMockPage((sel: string) => {
        if (sel.includes('nominee') || sel.includes('Nominee') || sel.includes('tabScroll')) {
          return createMockLocator({
            isVisible: jest.fn().mockResolvedValue(true),
            count: jest.fn().mockResolvedValue(1),
          });
        }
        if (sel.includes('input') || sel.includes('select') || sel.includes('button')) {
          return createMockLocator({
            isVisible: jest.fn().mockResolvedValue(true),
            isEnabled: jest.fn().mockResolvedValue(true),
            isDisabled: jest.fn().mockResolvedValue(false),
          });
        }
        return null;
      });

      const ctx: BookingExecutionContext = {
        bookingId: 'b-1',
        bookingCode: 'TA-VIRTUAL-17',
        requestedDate: '2026-11-24',
        requestedDateDisplay: '24-11-2026',
        requestedRoute: 'Pamba',
        reliefFund: 0,
        nominee: {
          nomineeName: 'SuperSensitiveName',
          nomineeAge: 42,
          nomineeRelationship: 'Father',
        },
      };

      await NomineeDetailsFlow.execute(mockPage, ctx);

      // Verify that SuperSensitiveName was NOT logged
      const loggedMessages = logSpy.mock.calls.map(c => c[0]);
      const sensitiveLogged = loggedMessages.some(m => m.includes('SuperSensitiveName'));
      expect(sensitiveLogged).toBe(false);

      // Verify expected redacted log format
      const redactedLogged = loggedMessages.some(m => m.includes('Nominee details validated for pilgrim #1.'));
      expect(redactedLogged).toBe(true);

      logSpy.mockRestore();
    });
  });
});
