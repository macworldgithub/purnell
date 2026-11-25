import {readFile,writeFile,mkdir,copyFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {parseCsv,toCsv} from './csv.mjs';
const source='exports/followup-2026-11-12';
const target='exports/erapower-scope-2026-11-13';
const read=async n=>parseCsv(await readFile(join(source,n+'.csv'),'utf8')).records;
const [vehicles,customers,histories,contexts,queries,jobs,narratives]=await Promise.all(['vehicles','customers','service_history_summary','vehicle_service_customer_context','followup_query_coverage','repair_order_jobs','repair_job_narratives'].map(read));
for(const [base,rows,key,label] of [[vehicles,histories,'serial_no','history'],[vehicles,contexts,'serial_no','vehicle context'],[customers,queries,'customer_id','follow-ups']]){
 const keys=new Set(rows.map(r=>r[key]));
 if(base.some(r=>!keys.has(r[key])))throw Error('Incomplete '+label);
 if(keys.size!==rows.length)throw Error('Duplicate '+label);
}
const jobKey=r=>r.ro_number+'|'+r.job_index+'|'+r.operation_code.trim();
const narrativeKeys=new Set(narratives.map(jobKey));
const narrativeCoverage=await read('repair_narrative_coverage');
if(narrativeCoverage.some(r=>r.status==='not_yet_exported'))throw Error('Unfinished narrative queries');
const unavailableNarratives=jobs.filter(r=>!narrativeKeys.has(jobKey(r)));
const reconciled=await read('repair_narrative_reconciled_coverage');
const archived=await read('archived_repair_job_narratives');
const recovered=reconciled.filter(r=>r.status==='exported_historical_job_details').length;
const remaining=reconciled.filter(r=>!r.status.startsWith('exported_')).length;
if(reconciled.length!==jobs.length||recovered+remaining!==unavailableNarratives.length)throw Error('Archive reconciliation does not balance');
if(unavailableNarratives.some(r=>!narrativeCoverage.some(c=>jobKey(c)===jobKey(r)&&['not_present_in_current_job_selector','not_in_open_report_and_review_lookup_invalid'].includes(c.status))))throw Error('Undocumented missing narratives');
await mkdir(target,{recursive:true});
const manifest=[];
const fieldCoverage=[];
for(const [folder,label] of [['exports/pentana-csv-2026-10-26','2026-10-26'],['exports/pentana-additional-csv-2026-10-29','2026-10-29'],[source,'2026-11-12'],['exports/workshop-2026-11-13','2026-11-13']]){
 await mkdir(join(target,label),{recursive:true});
 for(const name of await readdir(folder)){
  if(name==='manifest.json'||name==='coverage.json'||name.endsWith('.manifest.json')){await copyFile(join(folder,name),join(target,label,name));continue;}
  if(!name.endsWith('.csv'))continue;
  if(['linked-record-index.csv','vehicle-lookup-index.csv'].includes(name))continue;
  const data=await readFile(join(folder,name));const parsed=parseCsv(data.toString('utf8'));
  for(const field of parsed.headers)fieldCoverage.push({file:label+'/'+name,field,total_rows:parsed.records.length,populated_rows:parsed.records.filter(r=>r[field]?.trim()).length});
  await copyFile(join(folder,name),join(target,label,name));
  manifest.push({file:label+'/'+name,rows:parsed.records.length,columns:parsed.headers,sha256:createHash('sha256').update(data).digest('hex')});
 }
}
const requirements=[
 ['Customer identity and phones/email','Exported','customers.csv','341 linked customer profiles; source blanks retained.'],
 ['Consent, opt-out and suppression','Partial','customers.csv;customer_privacy_codes.csv','Source privacy restrictions and 12 code definitions exported. SMS consent, suppression and opt-out persistence remain unverified.'],
 ['Authorised contacts and permission to approve work','Unavailable','','No authoritative contact-permissions dataset exposed in inspected Service screens.'],
 ['Vehicle identity, registration, make/model/year/colour','Exported','vehicles.csv','384 linked vehicles; serial_no is the source identifier, not guaranteed to be a valid 17-character VIN. Not the entire dealership vehicle master.'],
 ['Vehicle customer links and extended context','Exported','vehicle_service_customer_context.csv','Coverage, contract, sales, VIP and raw comment fields; blanks are unknown, not false.'],
 ['Open repair orders, jobs and reported concerns','Partial','open_repair_orders.csv;repair_order_details.csv;repair_order_jobs.csv;repair_job_narratives.csv;archived_repair_job_narratives.csv;repair_narrative_reconciled_coverage.csv','123 snapshot ROs. Historical lookup recovered '+recovered+' matching job notes. '+remaining+' original job notes remain unmatched across the available views.'],
 ['Workshop status, advisor and promised completion','Partial','workshop_status.csv;open_repair_orders.csv','Source statuses and promised dates retained; not independently confirmed completion estimates. Workshop refreshed on 13 November for selected Service and Pre Delivery teams.'],
 ['Ready for collection and confirmed collection time','Unverified','','No explicit verified flag/timestamp obtained; vehicle delivery dates are not repair collection dates.'],
 ['Courtesy vehicles','Exported','loan_car_status.csv;loan_car_all_bookings.csv','13 November STORE01 report returned eight rows with each setting. Both reports use the date range displayed in their manifests.'],
 ['Parts orders, lines, quantities, ETA and receipts','Access denied','','Parts Requests explicitly denied this account; approved parts access/export needed. No arrival monitoring possible from these files.'],
 ['Existing appointments','Exported','appointments.csv','Report requested 01/01/2025 through 31/12/2027; November report has 180 bookings/399 detail rows. Historical exports retained separately.'],
 ['Available bookable slots by franchise/job/advisor','Unverified','appointment_bay_diary.csv;appointment_capacity_totals.csv','Diary/aggregate data do not establish real-time bookable slots.'],
 ['Service history, mileage and last service','Exported','service_history.csv;service_history_summary.csv;vehicle_service_customer_context.csv','History queried for all 384 linked vehicles; 267 prior snapshots retained, 117 newly queried.'],
 ['Open campaigns','Partial','archived_repair_context.csv','Historical campaign fields exported for the recovered orders. Current open campaign status remains unverified.'],
 ['Customer VIP/open warranty/complaint/callback flags','Partial','vehicle_service_customer_context.csv;customer_warnings.csv','Raw vehicle VIP/coverage/comments and customer warnings only; warranty coverage is not an open warranty job.'],
 ['Callback owner and promised time','Unavailable','customer_followups.csv;followup_query_coverage.csv','Follow-up history queried; vehicle follow-up dates do not establish promised callback time.'],
 ['Customer since, last purchase, assigned sales executive','Partial','vehicle_service_customer_context.csv','Source salesman ID and delivery dates exported; current customer assignments, customer-since and last purchase not verified.'],
 ['Staff IDs, names, roles and departments','Partial','staff_advisors.csv;service_departments.csv','Service selector entries only; not a complete staff directory.'],
 ['3CX queues/extensions, availability, transfer configuration','External source required','','Requires 3CX configuration/access; not obtainable from these Pentana CSVs.'],
 ['Business hours, FAQs, on-call roster and escalation policy','Configuration required','','Documents contain guidance; live operational configuration and current roster require dealership verification.'],
 ['Bookings create/reschedule/cancel and CRM callback writeback','Integration required','','CSV reads do not implement or validate write actions. No source records changed.'],
 ['Parts event detection, deduplication and reversal handling','Integration required','','Needs authorised parts changes feed, booking links and notification history.'],
 ['SMS templates, consent enforcement, replies and delivery tracking','Integration required','','Requires messaging configuration and provider logs; not produced by Pentana read exports.'],
 ['Call recordings, transcripts, metrics and audit logs','Integration required','','Runtime data from voice/3CX/application systems, not current Pentana source exports.']
].map(([requirement,status,files,detail])=>({requirement,status,files,detail}));
await writeFile(join(target,'scope_coverage.csv'),toCsv(['requirement','status','files','detail'],requirements));
await writeFile(join(target,'field_coverage.csv'),toCsv(['file','field','total_rows','populated_rows'],fieldCoverage));
await writeFile(join(target,'manifest.json'),JSON.stringify({created_at:new Date().toISOString(),complete_scope:false,files:manifest},null,2));
await writeFile(join(target,'README.txt'),'Pentana scope data available as of 13 November 2026\r\n\r\nThis package is NOT the complete scope or entire dealership database. scope_coverage.csv identifies the remaining requirements.\r\nThe dated folders preserve original snapshots. Use November files for the expanded linked master set; October folders retain earlier reports and ancillary datasets. Do not concatenate dated masters without key-based reconciliation.\r\nNovember customer, vehicle, history and context files include earlier records with their original exported_at timestamps. They are not a full live refresh. Blank fields remain unknown. Empty follow-up results do not establish absence of structured CRM flags.\r\nNo Pentana records were changed and no SMS sent. Parts access is denied; authoritative contact permissions, consent, confirmed slots/collection and external routing still require approved sources.\r\n');
console.log(JSON.stringify({target,csv_files:manifest.length+2,vehicles:vehicles.length,customers:customers.length,narratives:narratives.length,archived:archived.length,recovered,remaining,complete_scope:false}));
