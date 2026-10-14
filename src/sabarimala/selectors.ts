/**
 * Centralized DOM selectors for official Sabarimala Online Portal (https://sabarimalaonline.org/#/login)
 * Robust strategy: prefer getByRole, getByLabel, getByText, getByPlaceholder, and fallback CSS selectors.
 */
export const SABARIMALA_SELECTORS = {
  urls: {
    base: 'https://sabarimalaonline.org',
    darshanAvailability: 'https://sabarimalaonline.org/#/darshanAvailability',
    login: 'https://sabarimalaonline.org/#/login',
    home: 'https://sabarimalaonline.org/#/',
    virtualQ: 'https://sabarimalaonline.org/#/darshan',
    virtualQAlt: 'https://sabarimalaonline.org/#/virtual-q-booking',
    pilgrimMaster: 'https://sabarimalaonline.org/#/piligrimServiceMaster',
    wishlist: 'https://sabarimalaonline.org/#/wishlist',
  },

  login: {
    usernameSelectors: [
      'input[placeholder*="Mobile"]',
      'input[placeholder*="Email"]',
      'input[name="username"]',
      'input[name="mobileNumber"]',
      'input[formcontrolname="username"]',
      'input[formcontrolname="mobileNumber"]',
      'input[formcontrolname="email"]',
      '#username',
      '#mobile',
    ],
    passwordSelectors: [
      'input[type="password"]',
      'input[name="password"]',
      'input[formcontrolname="password"]',
      '#password',
    ],
    loginButtons: [
      'button:has-text("Login")',
      'button:has-text("Log In")',
      'button:has-text("Sign In")',
      'button[type="submit"]',
      '.btn-login',
    ],
    welcomeIndicators: [
      'text=/Welcome/i',
      'text=/Logout/i',
      '.user-profile',
      '.user-dropdown',
      'a[href*="logout"]',
      'button:has-text("Logout")',
    ],
    errorMessage: [
      '.alert-danger',
      '.error-msg',
      '.mat-error',
      'text=/Invalid credentials/i',
      'text=/Invalid username or password/i',
      'text=/User not registered/i',
      'text=/Incorrect password/i',
    ],
    otpPrompt: [
      'input[placeholder*="OTP"]',
      'input[formcontrolname="otp"]',
      'text=/Enter OTP/i',
      'text=/OTP Verification/i',
      '#otp',
    ],
    captchaContainer: [
      'canvas.captcha',
      'img[src*="captcha"]',
      'input[formcontrolname="captcha"]',
      'input[placeholder*="Captcha"]',
      '#captcha',
    ],
  },

  virtualQ: {
    navMenu: [
      'a:has-text("Virtual-Q")',
      'a:has-text("Virtual Q")',
      'button:has-text("Virtual-Q")',
      'button:has-text("Virtual Q")',
      'a[href*="darshan"]',
      'a[href*="virtual-q"]',
    ],
    calendarContainer: [
      '.mat-calendar',
      '.datepicker',
      '.calendar-container',
      'mat-datepicker-content',
    ],
    dateInput: [
      'input[placeholder*="Date"]',
      'input[formcontrolname="date"]',
      'input[formcontrolname="darshanDate"]',
      'input[formcontrolname="bookingDate"]',
      '#darshanDate',
      '.mat-calendar',
    ],
    calendarCells: [
      '.mat-calendar-body-cell',
      'td[role="gridcell"]',
      'button.mat-calendar-body-cell-content',
    ],
    disabledCellIndicators: [
      '.mat-calendar-body-disabled',
      '[aria-disabled="true"]',
      '.disabled',
      '.slot-full',
      '.slot-closed',
      '.blocked',
    ],
    selectedCellIndicators: [
      '.mat-calendar-body-selected',
      '[aria-selected="true"]',
      '.selected-date',
      '.active-date',
    ],
    routeSelect: [
      'select[name="route"]',
      'select[formcontrolname="route"]',
      'mat-select[formcontrolname="route"]',
      'select[id="route"]',
      '#route',
      '.route-select',
    ],
    timeSlots: {
      container: [
        '.time-slots-container',
        '.slot-list',
        '.slots-grid',
        'mat-radio-group[formcontrolname*="slot"]',
        '#timeSlots',
      ],
      slotCards: [
        '.slot-card',
        '.slot-item',
        '.time-slot',
        'mat-radio-button[name*="slot"]',
        'button.slot-btn',
        '.slot-box',
      ],
      availableSlots: [
        '.slot-available:not(.slot-full):not(.disabled)',
        '.slot-item:not(.full):not(.disabled)',
        'mat-radio-button:not(.mat-radio-disabled)',
        'button.slot-btn:not([disabled])',
        '.slot-box.available',
      ],
      selectedSlot: [
        '.mat-radio-checked',
        '.slot-selected',
        '.slot-card.active',
        '[aria-checked="true"]',
        '.selected',
      ],
      disabledIndicators: [
        '.mat-radio-disabled',
        '.slot-full',
        '.full',
        '.disabled',
        '[disabled]',
        '[aria-disabled="true"]',
      ],
    },
  },

  pilgrimSelection: {
    selectPilgrimButton: [
      'button:has-text("Select Pilgrim")',
      'a:has-text("Select Pilgrim")',
      'button:has-text("Add Pilgrim")',
      'a:has-text("Add Pilgrim")',
      '.btn-select-pilgrim',
    ],
    selectAllCheckbox: [
      'input[type="checkbox"][id*="selectAll"]',
      'input[type="checkbox"][name*="selectAll"]',
      'th input[type="checkbox"]',
      'mat-checkbox[id*="selectAll"]',
      'text=/Select All/i',
    ],
    pilgrimCheckboxRows: [
      'tbody tr input[type="checkbox"]',
      'table input[type="checkbox"]:not(#selectAll)',
      '.pilgrim-card input[type="checkbox"]',
      'mat-checkbox:not(#selectAll)',
    ],
    submitPilgrimsButton: [
      'button:has-text("Submit")',
      'button:has-text("Done")',
      'button:has-text("Apply")',
      'button:has-text("Add to Booking")',
      'button[type="submit"]',
    ],
    selectedPilgrimCountBadge: [
      '.pilgrim-count',
      'text=/Selected Pilgrims/i',
      'text=/Pilgrim Details/i',
    ],
  },

  reliefFund: {
    noOption: [
      'input[type="radio"][value="No"]',
      'input[type="radio"][value="no"]',
      'input[type="radio"][value="N"]',
      'label:has-text("No")',
      'mat-radio-button:has-text("No")',
    ],
    yesOption: [
      'input[type="radio"][value="Yes"]',
      'input[type="radio"][value="yes"]',
      'label:has-text("Yes")',
    ],
  },

  wishlist: {
    addToWishlistButton: [
      'button:has-text("Add to Wishlist")',
      'button:has-text("Add To Wishlist")',
      'button:has-text("Wishlist")',
      '.btn-wishlist',
    ],
    successBanner: [
      'text=/Added to Wishlist/i',
      'text=/Successfully added to wishlist/i',
      'text=/Item added to Wishlist/i',
      '.alert-success',
      'text=/Wishlist/i',
    ],
  },
};
