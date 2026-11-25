import {readFile,writeFile} from 'node:fs/promises';
import {parseCsv,toCsv} from './csv.mjs';
const p='exports/followup-2026-11-12/';
const read=async n=>parseCsv(await readFile(p+n+'.csv','utf8')).records;
const [coverage,archived,jobs]=await Promise.all(['repair_narrative_coverage','archived_repair_job_narratives','repair_order_jobs'].map(read));
const counts={};
const rows=coverage.map(row=>{
 const matches=archived.filter(a=>a.ro_number===row.ro_number&&a.operation_code.trim()===row.operation_code.trim());
 const oldCount=jobs.filter(a=>a.ro_number===row.ro_number&&a.operation_code.trim()===row.operation_code.trim()).length;
 const exact=matches.find(a=>a.job_index===row.job_index);
 const match=exact||(oldCount===1&&matches.length===1?matches[0]:null);
 const status=row.status==='exported'?'exported_current_review':match?'exported_historical_job_details':row.status;
 counts[status]=(counts[status]||0)+1;
 return {...row,status,historical_job_index:match?.job_index||'',historical_source_ro:match?.source_ro_number||'',match_method:match?(exact?'ro_operation_and_index':'unique_operation_within_same_ro'):'',source_file:row.status==='exported'?'repair_job_narratives.csv':match?'archived_repair_job_narratives.csv':''};
});
await writeFile(p+'repair_narrative_reconciled_coverage.csv',toCsv(['ro_number','job_index','operation_code','status','historical_job_index','historical_source_ro','match_method','source_file'],rows));
console.log(JSON.stringify(counts));
