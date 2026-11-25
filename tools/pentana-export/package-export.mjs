import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { parseCsv, toCsv } from './csv.mjs';

const base = resolve('exports');
const output = join(base, 'pentana-csv-2026-10-26');
const vehicleData=parseCsv(await readFile(join(base,'run-2026-10-26','vehicles.csv'),'utf8'));
const historyState=JSON.parse(await readFile(join(base,'run-2026-10-26','history-checkpoint.json'),'utf8'));
const repairState=JSON.parse(await readFile(join(base,'run-2026-10-26','repair-report-checkpoint.json'),'utf8'));
const narrativeState=JSON.parse(await readFile(join(base,'run-2026-10-26','job-narratives-checkpoint.json'),'utf8'));
const followupState=JSON.parse(await readFile(join(base,'run-2026-10-26','followups-checkpoint.json'),'utf8'));
const requiredSerials=new Set(vehicleData.records.map(r=>r.serial_no.trim()));
if([...requiredSerials].some(s=>!historyState.completed_serials.includes(s)))throw new Error('Vehicle history export is not complete');
if(repairState.unresolved_ids?.length||repairState.records.length!==103)throw new Error('Repair detail export is not complete');
if(narrativeState.records.length!==repairState.jobs.length||narrativeState.completed_ros.length!==repairState.records.length)throw new Error('Repair job narrative export is not complete');
for(const summary of historyState.summaries){
  const count=new Set(historyState.rows.filter(r=>r.serial_no===summary.serial_no).map(r=>r.ro_number)).size;
  if(!/^\d+$/.test(summary.total_ros_displayed)||count!==Number(summary.total_ros_displayed))throw new Error('History RO count validation failed');
}
await mkdir(output, { recursive: true });
const files = [
  ['run-2026-10-26', 'open_repair_orders.csv', 'Open repair orders returned by the report, all departments/advisors.'],
  ['run-2026-10-26', 'customers.csv', 'Existing customer records referenced by the open repair orders, appointment report and vehicle-history customer contexts.'],
  ['run-2026-10-26', 'vehicles.csv', 'Vehicle lookups for registrations referenced by the open repair orders and exported appointment report. Customer links are report references, not independent ownership verification.'],
  ['run-2026-10-26', 'vehicle_makes.csv', 'Make-code labels from the Open RO Report make filter.'],
  ['run-2026-10-26', 'service_departments.csv', 'Department codes paired with labels observed on matching RO jobs.'],
  ['run-2026-10-26', 'sale_types.csv', 'Sale-type codes paired with labels observed on matching RO jobs.'],
  ['run-2026-10-26', 'repair_order_details.csv', 'RO Review details for the open repair order index.'],
  ['run-2026-10-26', 'repair_order_jobs.csv', 'Operation codes and job statuses linked to the exported open repair orders.'],
  ['run-2026-10-26', 'repair_job_narratives.csv', 'Job descriptions, complaints, causes, corrections and technician notes from RO Review Job Details.'],
  ['run-2026-10-26', 'service_history.csv', 'See the history checkpoint for the exact vehicle/customer scope.'],
  ['run-2026-10-26', 'service_history_summary.csv', 'Per-vehicle history coverage and Total ROs/service days displayed by Pentana.'],
  ['run-2026-10-26', 'history_customer_context.csv', 'Customer context shown on each vehicle history screen, not an authorisation record.'],
  ['run-2026-10-26', 'loan_car_status.csv', 'All 8 loan vehicles in STORE01 as displayed for 26/10/2026; see retained filters and header aliases.'],
  ['run-2026-10-26', 'customer_followups.csv', 'Contact-history rows returned for the linked customer set; query coverage is recorded separately.'],
  ['run-2026-10-26', 'customer_warnings.csv', 'Warning messages returned for the linked customer set; query coverage is recorded separately.'],
  ['run-2026-10-26', 'followup_query_coverage.csv', 'Per-customer contact-history lookup outcomes, including contexts not returned by the screen.'],
  ['workshop-2026-10-26', 'workshop_status.csv', 'Workshop In Progress table for Service and Pre Delivery teams, all statuses.'],
  ['workshop-2026-10-26', 'workshop_status_codes.csv', 'Status IDs and descriptions available in the Workshop Control filter.'],
  ['appointments-2026-10-26', 'appointments.csv', 'Only the date range retained by Pentana; see report manifest.'],
  ['appointments-2026-10-26', 'appointment_capacity_totals.csv', 'Aggregate reported available/sold/unsold hours for the date range; not individual bookable slots.'],
  ['run-2026-10-26', 'staff_advisors.csv', 'Advisor ID/name selector entries, not the entire staff roster.'],
  ['codes-2026-10-26', 'status_codes.csv', 'Static workshop status code definitions.'],
];
const datasets=[];
for(const [folder,name,scope] of files){
  const bytes=await readFile(join(base,folder,name)).catch(()=>null);
  if(!bytes)throw new Error(`Required export missing: ${name}`);
  if(bytes.toString('utf8').includes('\uFFFD'))throw new Error(`Replacement character in ${name}`);
  const parsed=parseCsv(bytes.toString('utf8'));
  if(!parsed.rows.length&&!['customer_followups.csv','customer_warnings.csv'].includes(name))continue;
  await copyFile(join(base,folder,name),join(output,name));
  datasets.push({file:name,rows:parsed.rows.length,columns:parsed.headers,scope,sha256:createHash('sha256').update(bytes).digest('hex')});
}
const checkpoint=JSON.parse(await readFile(join(base,'run-2026-10-26','customers-checkpoint.json'),'utf8'));
const lookups=checkpoint.failures.filter(f=>!checkpoint.completed_ids.includes(f.customer_id));
await writeFile(join(output,'customer_lookup_failures.csv'),toCsv(['customer_id','reason'],lookups.map(f=>({customer_id:f.customer_id,reason:f.error}))));
const appointmentManifest=JSON.parse(await readFile(join(base,'appointments-2026-10-26','manifest.json'),'utf8').catch(()=> '{}'));
const appointmentData=parseCsv(await readFile(join(base,'appointments-2026-10-26','appointments.csv'),'utf8'));
const customerIds=new Set(checkpoint.records.map(r=>r.customer_id.trim()));
if([...customerIds].some(id=>!followupState.completed_customers.includes(id)))throw new Error('Customer follow-up coverage is not complete');
if(new Set(followupState.queries.map(q=>q.customer_id)).size!==customerIds.size||followupState.queries.length!==customerIds.size)throw new Error('Customer follow-up query keys are incomplete or duplicated');
if(followupState.queries.some(q=>q.status==='no_vehicle_lookup_notes_not_available'))throw new Error('Legacy follow-up query needs revalidation');
if(customerIds.size!==checkpoint.records.length||requiredSerials.size!==vehicleData.records.length)throw new Error('Duplicate master identifiers');
const jobKeys=new Map(repairState.jobs.map(r=>[`${r.ro_number}|${r.job_index}`,r.operation_code]));
if(narrativeState.records.some(r=>jobKeys.get(`${r.ro_number}|${r.job_index}`)!==r.operation_code))throw new Error('Job narrative link mismatch');
if(!followupState.queries.some(q=>q.status.startsWith('context_verified')))throw new Error('No verified customer follow-up context was captured');
const missingAppointmentCustomers=[...new Set(appointmentData.records.map(r=>r.custno.trim()).filter(Boolean))].filter(id=>!customerIds.has(id));
const missingAppointmentSerials=[...new Set(appointmentData.records.map(r=>r['serial no'].trim()).filter(Boolean))].filter(id=>!requiredSerials.has(id));
if(missingAppointmentCustomers.length||missingAppointmentSerials.length)throw new Error('Appointment customer or vehicle links are incomplete');
const missingHistoryCustomers=[...new Set(historyState.contacts.map(r=>r.customer_id.trim()).filter(Boolean))].filter(id=>!customerIds.has(id));
if(missingHistoryCustomers.length)throw new Error('History customer profile links are incomplete');
const manifest={
  generated_at:new Date().toISOString(),source:'https://c510778-erapower.pentana.cloud',dealership:'01| Purnell Motors',
  extraction_method:'Playwright browser UI lookups and native report downloads',complete:false,datasets,
  customer_index:{referenced:checkpoint.completed_ids.length+checkpoint.skipped_ids.length,exported:checkpoint.records.length,missing_ids:checkpoint.skipped_ids},
  appointment_report:appointmentManifest.datasets?.find(d=>d.name==='appointments'),
  loan_car_report:JSON.parse(await readFile(join(base,'run-2026-10-26','loan_car_status.manifest.json'),'utf8')),
  followup_queries:{customers_attempted:followupState.completed_customers.length,verified_contexts:followupState.queries.filter(q=>q.status.startsWith('context_verified')).length,unavailable_contexts:followupState.queries.filter(q=>!q.status.startsWith('context_verified')).length,returned_contact_rows:followupState.rows.length,returned_warning_messages:followupState.warnings.length},
  checks:{appointment_customer_links_complete:true,appointment_vehicle_serial_links_complete:true,history_customer_profile_links_complete:true,repair_details_complete_for_source_report:true,repair_job_narratives_complete:true,history_complete_for_exported_vehicles:true,history_unique_ro_counts_match_displayed_totals:true},
  limitations:[
    'Dated export snapshots, not a live integration. Customer/vehicle coverage is linked to the exported open repair orders and appointment report, not the full dealership directories.',
    'Parts Requests explicitly denied access to this account during this run. Parts order/receipt data was not exported.',
    'Authorised-contact permissions, complaint/callback flags and staff roles are not established by the downloaded reports.',
    'Existing bookings and capacity totals do not establish individual bookable slots.',
    'Advisor names and IDs do not establish live telephone availability. Serial numbers retain the source label rather than being assumed to be validated VINs.',
    'Records were fetched over the run, with source timestamps where available. The export is not an atomic database snapshot.',
  ],
};
await writeFile(join(output,'manifest.json'),JSON.stringify(manifest,null,2));
await writeFile(join(output,'export_summary.csv'),toCsv(['file','rows','scope','sha256'],datasets));
const coverage=[
  {category:'customers',status:'exported_for_linked_index',files:'customers.csv',scope:'Repair/appointment references and vehicle-history customer contexts',limitation:'Structured authorised-contact permissions are not included.'},
  {category:'vehicles',status:'exported_for_source_vehicle_set',files:'vehicles.csv',scope:'All appointment serials plus vehicles linked to open repair orders',limitation:'Source year/make codes and serial labels are preserved.'},
  {category:'repair_orders',status:'exported_for_open_ro_report',files:'open_repair_orders.csv | repair_order_details.csv | repair_order_jobs.csv | repair_job_narratives.csv',scope:'All source open ROs and their jobs',limitation:'Promised dates and source statuses are not an independently confirmed ready-for-collection flag.'},
  {category:'parts_orders_and_receipts',status:'access_denied',files:'',scope:'Parts Requests',limitation:'Pentana explicitly restricted the signed-in account. Parts orders, receipt quantities and ETAs were not exported.'},
  {category:'appointments',status:'exported_for_report_range',files:'appointments.csv',scope:'01/01/2025 through 31/12/2027, all advisors, including appointments without jobs',limitation:'Detail rows can represent multiple operations for one appointment/RO.'},
  {category:'service_history',status:'exported_for_vehicle_set',files:'service_history.csv | service_history_summary.csv',scope:'All exported vehicles; source history pagination and Total ROs checked',limitation:'History RO dates describe recorded repair orders; a distinct last scheduled-service field is not inferred.'},
  {category:'courtesy_vehicles',status:'exported_for_current_display',files:'loan_car_status.csv',scope:'STORE01, all vehicles, 26/10/2026; original filter settings retained in manifest',limitation:'This is the current loan-car status view, not an export of every historical loan agreement. Duplicate native time headers were disambiguated using their date columns.'},
  {category:'customer_followups_and_warnings',status:'queried_as_available_in_vehicle_lookup',files:'customer_followups.csv | customer_warnings.csv | followup_query_coverage.csv',scope:'Linked customer profiles; individual query outcomes retained',limitation:'An unavailable lookup context is not evidence that the customer has no notes. Raw follow-up and complaint text is not treated as a formal callback or grievance status flag.'},
  {category:'staff_advisors',status:'partial_directory',files:'staff_advisors.csv',scope:'Advisor selector IDs and names',limitation:'Staff roles, complete departments, routing details and live phone availability are not established by this selector.'},
  {category:'authorised_contacts',status:'not_exported',files:'',scope:'No formal authorisation table was exported',limitation:'Customer references, joint names and history context do not establish permission to disclose records.'},
  {category:'bookable_slots',status:'not_exported',files:'',scope:'Existing appointment records exported',limitation:'An export of specific genuinely bookable slots was not obtained.'},
];
await writeFile(join(output,'data_coverage.csv'),toCsv(['category','status','files','scope','limitation'],coverage));
await writeFile(join(output,'README.txt'),[
  'Purnell Motors - Pentana CSV export, 26 October 2026',
  '',
  'The CSVs contain real records read from the signed-in eraPower browser using Playwright.',
  'They are separate related tables. Preserve customer IDs, RO numbers, registrations and serial numbers when importing them.',
  'appointments.csv is the native detail report and can contain multiple job/operation rows per appointment or repair order. A report row is not necessarily a separate booking.',
  'Dates and year fields retain their source formats. A vehicle year can be a two-digit source value. Export timestamps use ISO UTC.',
  'Vehicle customer_ids and referenced_registrations can contain multiple source references separated by |.',
  'See manifest.json for exact columns, report filters, row counts, hashes and limitations.',
  'See customer_lookup_failures.csv for customer references that could not be exported.',
  '',...manifest.limitations.map(x=>'- '+x),
].join('\r\n'));
console.log(JSON.stringify({output,datasets:datasets.map(d=>({file:d.file,rows:d.rows}))}));
