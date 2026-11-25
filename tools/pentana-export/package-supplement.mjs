import {readFile,writeFile,readdir,mkdir,copyFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {parseCsv,toCsv} from './csv.mjs';
const source=resolve('exports/supplement-2026-10-29');
const output=resolve('exports/pentana-additional-csv-2026-10-29');await mkdir(output,{recursive:true});
const state=JSON.parse(await readFile(join(source,'vehicle-context-checkpoint.json'),'utf8'));
const vehicles=parseCsv(await readFile('exports/run-2026-10-26/vehicles.csv','utf8')).records;
const ids=new Set(state.records.map(r=>r.serial_no));
if(ids.size!==state.records.length||vehicles.some(v=>!ids.has(v.serial_no)))throw Error('Vehicle context coverage is incomplete');
const datasets=[];
for(const folder of [source,join(source,'reports')])for(const name of await readdir(folder)){
  if(!name.endsWith('.csv'))continue;
  if(datasets.some(d=>d.file===name))throw Error('Duplicate output filename');
  const bytes=await readFile(join(folder,name));const text=bytes.toString('utf8');if(text.includes('\uFFFD'))throw Error('Encoding replacement in '+name);
  const parsed=parseCsv(text);await copyFile(join(folder,name),join(output,name));datasets.push({file:name,rows:parsed.rows.length,columns:parsed.headers,sha256:createHash('sha256').update(bytes).digest('hex')});
}
const limitations=[
 'Parts Requests was explicitly denied to the signed-in account again on 29 October. No parts order or receipt records are included.',
 'Authorised-contact permissions, customer-since date, structured open complaint/warranty flags and callback owner/promised time were not exposed by the examined Service screens.',
 'Vehicle warranty and service-contract fields describe coverage records; they do not establish open claims or guarantee eligibility. A blank VIP field is preserved as blank, not converted to false.',
 'Salesman ID is the source vehicle-sales field, not a verified current customer-assigned sales executive. Vehicle delivery dates do not establish last purchase or current repair collection.',
 'Vehicle follow-up dates do not establish promised callback times. Comments are raw source text, not structured complaint flags.',
 'Appointment bay diary is the displayed 29 October Service diary. Blank cells do not prove bookable capacity; no job-duration or franchise-compatible booking was confirmed.',
 'No explicit verified ready-for-collection flag or actual repair collection timestamp was obtained. Source status descriptions are retained without inference.',
 'RO Invoice Release also explicitly denied this account access. Delivery Diary opened an empty menu, and Customer Vehicle Status returned an unpopulated display for profile 1.',
 'Advisor selector entries do not constitute a complete staff routing directory. Extensions, queues and live 3CX availability were not obtained.',
 'The vehicle set is the 267 vehicles in the earlier linked export, not every vehicle at the dealership. Refreshed report records can introduce references outside that earlier set.',
 'The previous bundle remains a 26 October snapshot; this supplement does not refresh every previous customer profile, job narrative or historical record.',
];
const manifest={generated_at:new Date().toISOString(),source:'https://c510778-erapower.pentana.cloud',dealership:'01| Purnell Motors',extraction_method:'Playwright visible UI lookups and native table exports',vehicle_context_complete_for_prior_vehicle_set:true,all_requested_categories_complete:false,datasets,limitations,access_checks:{parts_requests:'explicit_access_denied',ro_invoice_release:'explicit_access_denied',top_level_menus:['Service','Utilities'],utilities_menu:['SMS Menu'],staff_time_screen:'Clocking records; no telephone routing fields obtained'},report_manifest:JSON.parse(await readFile(join(source,'reports/manifest.json'),'utf8')),diary_manifest:JSON.parse(await readFile(join(source,'appointment_bay_diary.manifest.json'),'utf8'))};
await writeFile(join(output,'manifest.json'),JSON.stringify(manifest,null,2));
await writeFile(join(output,'export_summary.csv'),toCsv(['file','rows','sha256'],datasets));
await writeFile(join(output,'remaining_gaps.csv'),toCsv(['requirement','result'],[
 {requirement:'parts orders and receipts',result:'Access denied by Pentana; requires authorised Parts access or an approved export.'},
 {requirement:'vehicle context',result:`Exported ${ids.size} matched vehicles, including warranty, service contract, VIP, follow-up, sales and comment fields.`},
 {requirement:'ready for collection',result:'Source workshop statuses exported; explicit collection flag and confirmation timestamp not obtained.'},
 {requirement:'authorised contacts',result:'No authoritative permissions table exposed by examined Service customer forms.'},
 {requirement:'structured customer flags and callbacks',result:'Raw vehicle context exported; requested customer-level flags and callback ownership/times not exposed.'},
 {requirement:'staff routing',result:'Service advisor selector exported; complete roles, queue/extension mapping and 3CX live availability not obtained.'},
 {requirement:'bookable slots',result:'Bay diary and aggregate capacity exported; specific validated bookable slots not established.'},
]));
await writeFile(join(output,'README.txt'),['Pentana additional CSV export - 29 October 2026','Use alongside the original 26 October CSV bundle.','Vehicle context field names follow the visible Service Vehicle Maintenance screen. No records were saved back to Pentana.','Source dates and identifiers retain their text formats. See manifest.json for filters, timestamps, counts and hashes.','',...limitations.map(x=>'- '+x)].join('\r\n'));
console.log(JSON.stringify({output,datasets:datasets.map(d=>({file:d.file,rows:d.rows}))}));
