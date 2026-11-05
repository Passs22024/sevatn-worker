import { Page } from 'playwright';
import { SanitizedLogger } from '../../monitoring/logger';
import { BookingExecutionContext, VirtualQWorkflowError } from './types';
import { FlowDiagnosticsManager } from './diagnostics';

export const NOMINEE_RELATION_MAP: Record<string, { value: string; label: string }> = {
  father: { value: '1', label: 'Father' },
  mother: { value: '2', label: 'Mother' },
  son: { value: '3', label: 'Son' },
  daughter: { value: '4', label: 'Daughter' },
  brother: { value: '5', label: 'Brother' },
  sister: { value: '6', label: 'Sister' },
  spouse: { value: '11', label: 'Spouse' },
  wife: { value: '11', label: 'Spouse' },
  husband: { value: '11', label: 'Spouse' },
};

export function validateNomineeName(name: string): boolean {
  if (!name || typeof name !== 'string') return false;
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > 32) return false;
  return /^[a-zA-Z\s]+$/.test(trimmed);
}

export function validateNomineeAge(age: number | string): boolean {
  if (age === undefined || age === null) return false;
  const str = String(age).trim();
  if (!/^[0-9]+$/.test(str)) return false;
  const num = parseInt(str, 10);
  return num >= 1 && num <= 120;
}

export function validateNomineeRelationship(rel: string): boolean {
  if (!rel || typeof rel !== 'string') return false;
  const norm = rel.toLowerCase().trim();
  return !!NOMINEE_RELATION_MAP[norm];
}

export class NomineeDetailsFlow {
  /**
   * PHASE 5: Nominee Details Mapping and Validation
   *
   * Form structure on official Sabarimala portal (#/darshan):
   * <div id="nominee-table-wrapper">
   *   <table class="tabScroll">
   *     <tbody>
   *       <tr>
   *         <td>S.No</td>
   *         <td>Pilgrim Name (readonly)</td>
   *         <td><input placeholder="Enter Nominee Name" maxlength="32" pattern="^[a-zA-Z ]+$" required></td>
   *         <td><input placeholder="Enter Age" min="1" max="120" maxlength="3" pattern="^[0-9]+$" required></td>
   *         <td><select required><option value="1">Father</option>...<option value="11">Spouse</option></select></td>
   *       </tr>
   *     </tbody>
   *   </table>
   * </div>
   */
  static async execute(page: Page, ctx: BookingExecutionContext): Promise<boolean> {
    SanitizedLogger.info('[NOMINEE] Inspecting Nominee Details section on #/darshan');

    try {
      // Step 1: Wait for Nominee Details section to render after pilgrim selection
      const section = page.locator('#nominee-table-wrapper, text=/Nominee Details/i, .nominee-details').first();
      const isSectionVisible = await section.isVisible({ timeout: 5000 }).catch(() => false);

      const rows = page.locator('#nominee-table-wrapper table tbody tr, table.tabScroll tbody tr');
      let rowCount = await rows.count().catch(() => 0);

      const nameInputs = page.locator(
        '#nominee-table-wrapper input[placeholder*="Nominee Name"], input[placeholder="Enter Nominee Name"], input[formcontrolname="nomineeName"], input[name*="nomineeName"]'
      );
      const nameInputCount = await nameInputs.count().catch(() => 0);

      if (!isSectionVisible && rowCount === 0 && nameInputCount === 0) {
        SanitizedLogger.info('[NOMINEE] Nominee Details section not rendered for this booking type. Marking as satisfied.');
        ctx.nomineeCompletionStatus = true;
        return true;
      }

      const pilgrimCount = ctx.pilgrimCount || (rowCount > 0 ? rowCount : (nameInputCount > 0 ? nameInputCount : 1));
      SanitizedLogger.info(`[NOMINEE] Populating nominee fields for ${pilgrimCount} pilgrim(s) (Detected rows: ${rowCount}, inputs: ${nameInputCount})`);

      for (let i = 0; i < pilgrimCount; i++) {
        // Resolve nominee object for pilgrim i
        const pilgrimObj = ctx.pilgrims?.[i];
        const pilgrimNominee = pilgrimObj?.nomineeName ? {
          nomineeName: pilgrimObj.nomineeName,
          nomineeAge: pilgrimObj.nomineeAge,
          nomineeRelationship: pilgrimObj.nomineeRelationship,
          nomineePhone: pilgrimObj.nomineePhone,
        } : null;

        const arrayNominee = ctx.nominees?.[i];
        const singleNominee = ctx.nominee;
        const resolvedNominee = pilgrimNominee || arrayNominee || singleNominee;

        // If nominee is omitted, attempt to submit without filling nominee fields
        if (!resolvedNominee || !resolvedNominee.nomineeName || !String(resolvedNominee.nomineeName).trim()) {
          SanitizedLogger.warn(`[NOMINEE] Nominee details not provided for pilgrim #${i + 1}. Attempting to submit without filling nominee fields.`);
          continue;
        }

        const nameVal = String(resolvedNominee.nomineeName).trim();
        const ageVal = resolvedNominee.nomineeAge !== undefined ? resolvedNominee.nomineeAge : 35;
        const relVal = resolvedNominee.nomineeRelationship ? String(resolvedNominee.nomineeRelationship).trim() : '';

        // Validate Nominee Name format
        if (!validateNomineeName(nameVal)) {
          const diag = await FlowDiagnosticsManager.captureDiagnostics(page, 'PHASE_5_NOMINEE_DETAILS', ctx.bookingCode);
          throw new VirtualQWorkflowError(
            'NOMINEE_VALIDATION_FAILED',
            `NOMINEE_NAME_INVALID: Nominee name "${nameVal}" must contain only alphabets and spaces, maximum 32 characters.`,
            'PHASE_5_NOMINEE_DETAILS',
            diag,
          );
        }

        // Validate Nominee Age format
        if (!validateNomineeAge(ageVal)) {
          const diag = await FlowDiagnosticsManager.captureDiagnostics(page, 'PHASE_5_NOMINEE_DETAILS', ctx.bookingCode);
          throw new VirtualQWorkflowError(
            'NOMINEE_VALIDATION_FAILED',
            `NOMINEE_AGE_INVALID: Nominee age "${ageVal}" must be an integer between 1 and 120.`,
            'PHASE_5_NOMINEE_DETAILS',
            diag,
          );
        }

        // Validate Nominee Relationship
        if (!relVal || !validateNomineeRelationship(relVal)) {
          const diag = await FlowDiagnosticsManager.captureDiagnostics(page, 'PHASE_5_NOMINEE_DETAILS', ctx.bookingCode);
          throw new VirtualQWorkflowError(
            'NOMINEE_VALIDATION_FAILED',
            `NOMINEE_RELATIONSHIP_INVALID: Nominee relationship "${relVal}" is invalid or missing. Accepted: Father, Mother, Son, Daughter, Brother, Sister, Spouse.`,
            'PHASE_5_NOMINEE_DETAILS',
            diag,
          );
        }

        // Locate row inputs
        let nInput = (rowCount > i) ? rows.nth(i).locator('input[placeholder*="Nominee Name"], input[placeholder="Enter Nominee Name"]').first() : nameInputs.nth(i);
        let aInput = (rowCount > i) ? rows.nth(i).locator('input[placeholder*="Age"], input[placeholder="Enter Age"]').first() : page.locator('#nominee-table-wrapper input[placeholder*="Age"], input[placeholder="Enter Age"]').nth(i);
        let rSelect = (rowCount > i) ? rows.nth(i).locator('select').first() : page.locator('#nominee-table-wrapper select').nth(i);

        // Fallback to table cell indexing if placeholder-based selectors did not match
        if (rowCount > i && !(await nInput.isVisible({ timeout: 500 }).catch(() => false))) {
          nInput = rows.nth(i).locator('td').nth(2).locator('input').first();
        }
        if (rowCount > i && !(await aInput.isVisible({ timeout: 500 }).catch(() => false))) {
          aInput = rows.nth(i).locator('td').nth(3).locator('input').first();
        }
        if (rowCount > i && !(await rSelect.isVisible({ timeout: 500 }).catch(() => false))) {
          rSelect = rows.nth(i).locator('td').nth(4).locator('select').first();
        }

        // Populate Nominee Name and trigger Angular validation events
        if (await nInput.isVisible({ timeout: 1500 }).catch(() => false)) {
          await nInput.scrollIntoViewIfNeeded().catch(() => {});
          await nInput.click().catch(() => {});
          await nInput.fill(nameVal);
          if (typeof nInput.dispatchEvent === 'function') {
            await nInput.dispatchEvent('input').catch(() => {});
            await nInput.dispatchEvent('change').catch(() => {});
            await nInput.dispatchEvent('blur').catch(() => {});
          }
        }

        // Populate Nominee Age and trigger Angular validation events
        if (await aInput.isVisible({ timeout: 1500 }).catch(() => false)) {
          await aInput.click().catch(() => {});
          await aInput.fill(String(ageVal).trim());
          if (typeof aInput.dispatchEvent === 'function') {
            await aInput.dispatchEvent('input').catch(() => {});
            await aInput.dispatchEvent('change').catch(() => {});
            await aInput.dispatchEvent('blur').catch(() => {});
          }
        }

        // Populate Relationship and trigger Angular change events
        if (await rSelect.isVisible({ timeout: 1500 }).catch(() => false)) {
          const relKey = relVal.toLowerCase().trim();
          const mapped = NOMINEE_RELATION_MAP[relKey];

          if (mapped) {
            await rSelect.selectOption(mapped.value).catch(async () => {
              await rSelect.selectOption({ label: mapped.label }).catch(() => {});
            });
          } else {
            await rSelect.selectOption({ label: relVal }).catch(async () => {
              await rSelect.selectOption({ index: 1 }).catch(() => {});
            });
          }
          if (typeof rSelect.dispatchEvent === 'function') {
            await rSelect.dispatchEvent('change').catch(() => {});
            await rSelect.dispatchEvent('blur').catch(() => {});
          }
        }

        SanitizedLogger.info(`[NOMINEE] Nominee details validated for pilgrim #${i + 1}.`);
      }

      // Step 2: Verify "Add to Wishlist" button is genuinely enabled
      const addBtn = page.locator('button.btn-addto, button#regi_continue:has-text("Add to Wishlist")').first();
      if (typeof page.waitForFunction === 'function') {
        await page.waitForFunction(() => {
          const btn = document.querySelector('button.btn-addto') || document.querySelector('button#regi_continue:not(.btn-clear)');
          return btn && !btn.hasAttribute('disabled') && !(btn as HTMLButtonElement).disabled;
        }, { timeout: 5000 }).catch(() => {});
      }

      const isEnabled = !(await addBtn.isDisabled().catch(() => true));
      SanitizedLogger.info(`[NOMINEE] Nominee details validated. Add to Wishlist enabled: ${isEnabled}`);

      ctx.nomineeCompletionStatus = isEnabled;
      return true;
    } catch (err: any) {
      if (err instanceof VirtualQWorkflowError) throw err;
      const diag = await FlowDiagnosticsManager.captureDiagnostics(page, 'PHASE_5_NOMINEE_DETAILS', ctx.bookingCode);
      throw new VirtualQWorkflowError(
        'NOMINEE_VALIDATION_FAILED',
        err.message || 'Failed validating nominee details',
        'PHASE_5_NOMINEE_DETAILS',
        diag,
      );
    }
  }
}
