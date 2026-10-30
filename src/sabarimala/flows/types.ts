/**
 * Official Travancore Devaswom Board Virtual-Q Workflow Domain Types & Failure Classifications
 */

export type FailureClassification =
  | 'DISCOVERY_DATE_UNAVAILABLE'
  | 'DISCOVERY_ROUTE_UNAVAILABLE'
  | 'AUTHENTICATION_REQUIRED'
  | 'AUTHENTICATED_DATE_SELECTION_FAILED'
  | 'AUTHENTICATED_ROUTE_SELECTION_FAILED'
  | 'ROUTE_SELECTION_MISMATCH'
  | 'LOADER_TIMEOUT'
  | 'WISHLIST_VERIFICATION_MISMATCH'
  | 'WISHLIST_MISMATCH'
  | 'PREVIOUS_BOOKING_RESTRICTION'
  | 'ACCOUNT_PREVIOUS_BOOKING_RESTRICTED'
  | 'CHECKOUT_VERIFICATION_MISMATCH'
  | 'BUTTON_DISABLED'
  | 'SLOT_CARDS_MISSING'
  | 'SLOT_LOADING_TIMEOUT'
  | 'SLOT_UNAVAILABLE'
  | 'SLOT_SELECTION_FAILED'
  | 'PILGRIM_SELECTION_FAILED'
  | 'NOMINEE_VALIDATION_FAILED'
  | 'RELIEF_FUND_SELECTION_FAILED'
  | 'WISHLIST_INSERTION_FAILED'
  | 'PAYMENT_PAGE_LOAD_FAILED'
  | 'PAYMENT_PENDING'
  | 'PAYMENT_RESULT_UNKNOWN'
  | 'BOOKING_CONFIRMATION_MISSING';

export type WorkflowStage =
  | 'PHASE_1_AVAILABILITY_DISCOVERY'
  | 'PHASE_2_LOGIN'
  | 'PHASE_3_DATE_ROUTE_SELECTION'
  | 'PHASE_3_TIME_SLOT_SELECTION'
  | 'PHASE_4_PILGRIM_SELECTION'
  | 'PHASE_5_NOMINEE_DETAILS'
  | 'PHASE_6_RELIEF_FUND'
  | 'PHASE_7_WISHLIST'
  | 'PHASE_8_PAYMENT_REVIEW'
  | 'PHASE_9_BOOKING_CONFIRMATION';

export interface StageExecutionRecord {
  stage: WorkflowStage;
  timestamp: string;
  status: 'SUCCESS' | 'FAILED' | 'SKIPPED';
  evidence?: Record<string, any>;
  errorMessage?: string;
}

export interface RequestedPilgrimData {
  fullName: string;
  age: number;
  gender: string;
  idType: string;
  idNumber: string;
  nomineeName?: string;
  nomineeAge?: number | string;
  nomineeRelationship?: string;
  nomineePhone?: string;
}

export interface SelectedPilgrimEvidence {
  name: string;
  idNumber?: string;
  rowNumber?: number;
  verifiedInForm?: boolean;
}

export interface NomineeDetails {
  nomineeName?: string;
  nomineeAge?: number | string;
  nomineeRelationship?: string;
  nomineePhone?: string;
}

export interface BookingExecutionContext {
  bookingId: string;
  jobId?: string;
  attemptId?: string;
  bookingCode: string;
  leaseGeneration?: number;
  fencingToken?: string;
  requestedDate: string; // YYYY-MM-DD
  requestedDateDisplay: string; // DD-MM-YYYY
  requestedRoute: string;
  selectedRoute?: string;
  selectedTimeSlot?: string;
  pilgrimCount?: number;
  pilgrims?: RequestedPilgrimData[];
  selectedPilgrims?: SelectedPilgrimEvidence[];
  nominee?: NomineeDetails | null;
  nominees?: NomineeDetails[];
  nomineeCompletionStatus?: boolean;
  reliefFund: number; // Required: 0
  reliefFundSelection?: 'NO' | 'YES';
  wishlistStatus?: 'NOT_STARTED' | 'PENDING' | 'ADDED' | 'VERIFIED' | 'ALREADY_EXISTS';
  newlyAddedWishlistVerified?: boolean;
  checkoutVerified?: boolean;
  allowZeroCostConfirmation?: boolean;
  allowPayment?: boolean;
  paymentStatus?: 'NOT_STARTED' | 'GATEWAY_LOADED' | 'CHECKOUT_VERIFIED' | 'PENDING' | 'CONFIRMED' | 'UNKNOWN';
  officialBookingId?: string;
  officialBookingReference?: string;
  officialReceiptReference?: string;
  portalTransactionReference?: string;
  confirmationEvidence?: Record<string, any>;
  confirmedAt?: string;
  officialReference?: string;
  confirmationData?: Record<string, any>;
  preferences?: Record<string, any>;
  accountId?: string;
  cartId?: string;
  grandTotal?: string;
  stageHistory?: StageExecutionRecord[];
}

export interface StageDiagnosticSnapshot {
  correlationId: string;
  stage: WorkflowStage;
  timestamp: string;
  currentUrl: string;
  pageTitle: string;
  selectedDate?: string;
  selectedRoute?: string;
  slotCardCount?: number;
  visibleFormLabels?: string[];
  visibleButtons?: string[];
  errorBanners?: string[];
  screenshotPath?: string;
  sanitizedHtmlPath?: string;
  [key: string]: any;
}

export class VirtualQWorkflowError extends Error {
  constructor(
    public readonly classification: FailureClassification,
    message: string,
    public readonly stage: WorkflowStage,
    public readonly diagnostics?: Partial<StageDiagnosticSnapshot>,
  ) {
    super(`[${classification}] at ${stage}: ${message}`);
    this.name = 'VirtualQWorkflowError';
  }
}

