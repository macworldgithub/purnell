import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseCsv, toCsv } from './pentana-export/csv.mjs';

export async function writeVehicleCustomerLinks(folder) {
  const read = async name => parseCsv(await readFile(join(folder, name + '.csv'), 'utf8').catch(error => {
    if (error.code === 'ENOENT') return 'serial_no,customer_id\n';
    throw error;
  })).records;
  const [vehicles, maintenance, history] = await Promise.all(['vehicles', 'vehicle_service_customer_context', 'history_customer_context'].map(read));
  const links = new Map();
  function add(serial, customer, source, when) {
    const serial_no = serial?.trim(), customer_id = customer?.trim();
    if (!serial_no || !customer_id) return;
    const row = { serial_no, customer_id, link_source: source, exported_at: when || '' };
    links.set(JSON.stringify([serial_no, customer_id, source]), row);
  }
  for (const row of vehicles) for (const id of (row.customer_ids || '').split('|')) add(row.serial_no, id, 'vehicle_search_report_references', row.exported_at);
  for (const row of maintenance) add(row.serial_no, row.customer_id, 'vehicle_maintenance_customer', row.exported_at);
  for (const row of history) add(row.serial_no, row.customer_id, 'history_screen_customer', row.exported_at);
  await writeFile(join(folder, 'vehicle_customer_links.csv'), toCsv(['serial_no', 'customer_id', 'link_source', 'exported_at'], [...links.values()]));
  return {
    customerIds: [...new Set([...links.values()].map(row => row.customer_id))],
    complete: vehicles.length > 0 && vehicles.every(row => maintenance.some(item => item.serial_no === row.serial_no) && history.some(item => item.serial_no === row.serial_no)),
  };
}
