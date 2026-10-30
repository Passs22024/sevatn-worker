export interface NomineeValidationResult {
  valid: boolean;
  errors: string[];
  resolvedNominee?: {
    nomineeName: string;
    nomineeAge: number;
    nomineeRelationship: string;
    nomineePhone?: string;
  };
}

/**
 * Validates mandatory nominee details for pilgrim insurance.
 * Redacts identity information in error diagnostics.
 */
export function validateNominee(bookingOrContext: {
  nominee?: any;
  nominees?: any[];
  nomineeName?: string;
  nomineeAge?: number;
  nomineeRelationship?: string;
  nomineePhone?: string;
  pilgrims?: any[];
  preferences?: any;
}): NomineeValidationResult {
  const errors: string[] = [];

  const primaryNominee =
    bookingOrContext.nominee ||
    (Array.isArray(bookingOrContext.nominees) && bookingOrContext.nominees[0]) ||
    (Array.isArray(bookingOrContext.preferences?.nominees) && bookingOrContext.preferences.nominees[0]) ||
    (bookingOrContext.nomineeName
      ? {
          nomineeName: bookingOrContext.nomineeName,
          nomineeAge: bookingOrContext.nomineeAge,
          nomineeRelationship: bookingOrContext.nomineeRelationship,
          nomineePhone: bookingOrContext.nomineePhone,
        }
      : null) ||
    (Array.isArray(bookingOrContext.pilgrims) && bookingOrContext.pilgrims[0]?.nominee) ||
    (Array.isArray(bookingOrContext.pilgrims) && bookingOrContext.pilgrims[0]?.nomineeName
      ? {
          nomineeName: bookingOrContext.pilgrims[0].nomineeName,
          nomineeAge: bookingOrContext.pilgrims[0].nomineeAge,
          nomineeRelationship: bookingOrContext.pilgrims[0].nomineeRelationship,
          nomineePhone: bookingOrContext.pilgrims[0].nomineePhone,
        }
      : null);

  if (!primaryNominee) {
    errors.push('Mandatory nominee details missing: Name, age (>=18), and relationship are required.');
    return { valid: false, errors };
  }

  const name = primaryNominee.nomineeName?.trim();
  if (!name || name.length < 2) {
    errors.push('Nominee name must be at least 2 characters.');
  }

  const age = Number(primaryNominee.nomineeAge);
  if (!age || isNaN(age) || age < 18 || age > 120) {
    errors.push('Nominee must be an adult with a valid age between 18 and 120.');
  }

  const rel = primaryNominee.nomineeRelationship?.trim();
  if (!rel || rel.length < 2) {
    errors.push('Nominee relationship is required.');
  }

  const valid = errors.length === 0;

  return {
    valid,
    errors,
    resolvedNominee: valid
      ? {
          nomineeName: name,
          nomineeAge: age,
          nomineeRelationship: rel,
          nomineePhone: primaryNominee.nomineePhone?.trim(),
        }
      : undefined,
  };
}

