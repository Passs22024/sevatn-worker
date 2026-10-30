import { chromium } from 'playwright';
import { CredentialManager } from '../security/credential-manager';
import { SabarimalaLoginFlow } from '../sabarimala/login';
import { SabarimalaPostLoginFlow } from '../sabarimala/post-login-flow';
import { PostLoginDateRouteFlow } from '../sabarimala/flows/date-route.flow';
import { TimeSlotSelectionFlow } from '../sabarimala/flows/time-slot.flow';
import { PilgrimSelectionFlow } from '../sabarimala/flows/pilgrim-selection.flow';
import * as fs from 'fs';
import * as path from 'path';

const { PrismaClient } = require(path.resolve(__dirname, '../../../api/node_modules/@prisma/client'));
const prisma = new PrismaClient();

async function inspectNomineeForm() {
  console.log('--- Inspecting Nominee Form on Sabarimala Portal ---');
  const account = await prisma.bookingAccount.findFirst({
    where: { username: '8098697141' },
  });

  const password = CredentialManager.decrypt(
    account.encryptedPassword,
    account.encryptionIv!,
    account.encryptionTag!
  );

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await context.newPage();

  const ctx: any = {
    bookingId: 'inspect-nominee',
    requestedDate: '2026-11-25',
    requestedDateDisplay: '25-11-2026',
    requestedRoute: 'Pamba - Marakkoottam - 4 Kms',
  };

  try {
    await page.goto('https://sabarimalaonline.org/#/login');
    await SabarimalaLoginFlow.execute(page, account.username, password);

    await SabarimalaPostLoginFlow.handlePostLoginPopup(page).catch(() => {});
    await SabarimalaPostLoginFlow.navigateToHomeAndDarshan(page, ctx);

    await PostLoginDateRouteFlow.selectAuthenticatedDate(page, ctx);
    await PostLoginDateRouteFlow.selectAuthenticatedRoute(page, ctx);

    await SabarimalaPostLoginFlow.waitForSpinnerDetached(page);
    await page.waitForTimeout(3000);
    await TimeSlotSelectionFlow.selectTimeSlot(page, ctx);

    console.log('Selecting registered pilgrim...');
    await PilgrimSelectionFlow.execute(page, ctx);
    await page.waitForTimeout(2000);

    console.log('Capturing DOM after pilgrim selection...');
    const outDir = path.resolve(__dirname, '../../debug/nominee_inspect');
    fs.mkdirSync(outDir, { recursive: true });

    await page.screenshot({ path: path.join(outDir, 'AFTER_PILGRIM_SELECTED.png') });
    const content = await page.content();
    fs.writeFileSync(path.join(outDir, 'darshan_after_pilgrim.html'), content);

    // Look for inputs under pilgrim details or nominee
    const inputs = await page.locator('input, select, mat-select').evaluateAll((elements) => {
      return elements.map((el) => ({
        tag: el.tagName.toLowerCase(),
        type: (el as HTMLInputElement).type || '',
        name: el.getAttribute('name') || '',
        id: el.id || '',
        formcontrolname: el.getAttribute('formcontrolname') || '',
        placeholder: (el as HTMLInputElement).placeholder || '',
        className: el.className || '',
        visible: (el as HTMLElement).offsetParent !== null,
        value: (el as HTMLInputElement).value || '',
      })).filter((x) => x.visible && (x.formcontrolname || x.name || x.placeholder || x.id));
    });

    console.log('Visible inputs on page:');
    console.log(JSON.stringify(inputs, null, 2));
    fs.writeFileSync(path.join(outDir, 'inputs.json'), JSON.stringify(inputs, null, 2));

    // Check relationship options if any select exists
    const relSelect = page.locator('select[formcontrolname*="relation" i], select[name*="relation" i], select').filter({ hasText: /relation|father|mother|spouse|son|daughter/i }).first();
    if (await relSelect.isVisible().catch(() => false)) {
      const opts = await relSelect.locator('option').allTextContents().catch(() => []);
      console.log('Relationship options found:', opts);
      fs.writeFileSync(path.join(outDir, 'relationship_options.json'), JSON.stringify(opts, null, 2));
    }

    // Check Add to Wishlist button state
    const addBtn = page.locator('button.btn-addto').first();
    const isAddVisible = await addBtn.isVisible().catch(() => false);
    const isAddDisabled = await addBtn.isDisabled().catch(() => true);
    console.log(`Add to Wishlist button: visible=${isAddVisible}, disabled=${isAddDisabled}`);

  } finally {
    await browser.close();
    await prisma.$disconnect();
  }
}

inspectNomineeForm().catch(console.error);

