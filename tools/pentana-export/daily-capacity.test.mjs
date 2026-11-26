import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDailyCapacity} from './daily-capacity.mjs';
const text=Array.from({length:21},(_,i)=>{
 const date=new Date(Date.UTC(2026,10,23+i));
 const label=[String(date.getUTCDate()).padStart(2,'0'),String(date.getUTCMonth()+1).padStart(2,'0'),date.getUTCFullYear()].join('/');
 return `${label}\nAppointments\n13/\n20\nSold / Unsold\n33/\n13\nLoan Cars\n8/\n8\nWait Jobs\n2/\n2\nCarry Over Hours\n0/\n15`;
}).join('\n');
const snapshot={department:'S',advisor_scope:'all',text,messages:[]};
test('Parses the calendar across month boundaries without turning daily totals into slots',()=>{
 const rows=parseDailyCapacity(snapshot,'2026-11-26T08:23:37Z');
 assert.equal(rows.length,21);assert.equal(rows[0].date,'2026-11-23');assert.equal(rows.at(-1).date,'2026-12-13');
 assert.equal(rows[4].unsold_hours,'13');assert.equal(rows[4].exact_time_slots_verified,'false');
});
test('Rejects missing days, unloaded counts, wrong filters and source error messages',()=>{
 assert.throws(()=>parseDailyCapacity({...snapshot,text:text.slice(text.indexOf('24/11/2026'))},'2026-11-26T08:00:00Z'));
 assert.throws(()=>parseDailyCapacity({...snapshot,department:'P'},'2026-11-26T08:00:00Z'));
 assert.throws(()=>parseDailyCapacity({...snapshot,messages:['Department is mandatory']},'2026-11-26T08:00:00Z'));
 assert.throws(()=>parseDailyCapacity({...snapshot,text:text.replace('13/\n20','')},'2026-11-26T08:00:00Z'));
});
