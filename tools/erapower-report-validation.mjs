import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { parseCsv } from './pentana-export/csv.mjs';
export const reportNames = ['open_repair_orders', 'appointments', 'appointment_capacity_totals', 'staff_advisors', 'status_codes'];
export async function validatedReports(folder) {
  const manifest = JSON.parse(await readFile(join(folder, 'manifest.json'), 'utf8'));
  const valid = [], errors = [];
  for (const name of reportNames) {
    const item = [...manifest.datasets].reverse().find(row => row.name === name && row.status === 'exported');
    try {
      if (!item || item.file !== name + '.csv') throw Error('Missing successful report');
      const bytes = await readFile(join(folder, item.file));
      const csv = parseCsv(bytes.toString('utf8'));
      if (csv.rows.length !== item.rows) throw Error('Report count differs from CSV');
      if (item.sha256 && createHash('sha256').update(bytes).digest('hex') !== item.sha256) throw Error('Report checksum differs');
      if (item.coverage_warning) throw Error('Report changed the requested date range');
      valid.push(item);
    } catch (error) { errors.push({ name, error: error.message }); }
  }
  return { valid, errors, complete: errors.length === 0 };
}
