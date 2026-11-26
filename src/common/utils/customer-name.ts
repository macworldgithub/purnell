// Normalise only a terminal company suffix; never fuzzy-match the account name.
export function canonicalCustomerName(value: string): string {
  return value.toUpperCase().replace(/&/g, ' AND ')
    .replace(/[.,]/g, ' ')
    .replace(/\s+(?:PTY|PROPRIETARY|PRIVATE)\s+(?:LTD|LIMITED)\s*$/, ' PTY LTD')
    .replace(/[^A-Z0-9]/g, '');
}
