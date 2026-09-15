/**
 * Normalizes Australian phone numbers into standard E.164 (+61...) format
 *
 * Rules:
 * - 0412000006 (10-digit mobile starting with 04) -> +61412000006
 * - 0285580007 (10-digit landline starting with 02/03/07/08) -> +61285580007
 * - 61412000006 (starts with 61 without +) -> +61412000006
 * - +61412000006 (starts with +61) -> +61412000006
 * - 412000006 (9-digit starting with 4) -> +61412000006
 */
export function normalizeAustralianPhone(input: string): string {
  if (!input) return '';

  // Strip all whitespace, hyphens, brackets, and non-digit characters except leading +
  let clean = input.trim().replace(/[^\d+]/g, '');

  if (!clean) return '';

  // If already starts with +61, keep +61 and strip extra characters
  if (clean.startsWith('+61')) {
    return '+61' + clean.slice(3).replace(/\D/g, '');
  }

  // If starts with + (other international), return cleaned
  if (clean.startsWith('+')) {
    return clean;
  }

  // Strip all non-digits now for local rules
  const digits = clean.replace(/\D/g, '');

  // Starts with 61 (e.g. 61412000006 or 61285580007)
  if (digits.startsWith('61') && digits.length >= 10) {
    return '+' + digits;
  }

  // Starts with leading 0 (e.g. 0412000006 -> +61412000006, 0285580007 -> +61285580007)
  if (digits.startsWith('0') && digits.length === 10) {
    return '+61' + digits.slice(1);
  }

  // 9 digits starting with 4 (e.g. 412000006)
  if (digits.length === 9 && (digits.startsWith('4') || digits.startsWith('2') || digits.startsWith('3') || digits.startsWith('7') || digits.startsWith('8'))) {
    return '+61' + digits;
  }

  // Default fallback: prepend + if 11+ digits, otherwise return cleaned digits
  return digits.length >= 10 ? '+' + digits : digits;
}
