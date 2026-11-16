// CSV fields stay strings: do not coerce customer IDs, phones, VINs, or dates.
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; }
      else if (!quoted && field) throw new Error('Unexpected quote in CSV field');
      else quoted = !quoted;
    } else if (char === ',' && !quoted) { row.push(field); field = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      if (row.some(v => v !== '')) rows.push(row);
      row = []; field = '';
    } else field += char;
  }
  if (quoted) throw new Error('Unterminated CSV quote');
  if (field || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) throw new Error('CSV is empty');
  const [headers, ...records] = rows;
  if (new Set(headers).size !== headers.length) throw new Error('Duplicate CSV headers');
  for (const record of records) if (record.length !== headers.length) throw new Error('Inconsistent CSV column count');
  return { headers, rows: records, records: records.map(values => Object.fromEntries(headers.map((h, i) => [h, values[i]]))) };
}

export function toCsv(headers, records) {
  const field = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
  return '\uFEFF' + [headers, ...records.map(r => headers.map(h => r[h] ?? ''))].map(r => r.map(field).join(',')).join('\r\n') + '\r\n';
}
