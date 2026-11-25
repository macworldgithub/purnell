import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {connect,until} from './pentana-ui.mjs';
import {parseCsv,toCsv} from './csv.mjs';
const [selector,name]=process.argv.slice(2);
if(!selector||!/^\w+$/.test(name||''))throw new Error('Expected a visible table selector and safe output name');
const out=resolve(process.argv[4]||'exports/run-2026-10-26');
await mkdir(out,{recursive:true});
const {browser,page}=await connect();
try{
  const table=page.frame({name:'gutsPage'}).locator(selector);await table.waitFor({state:'visible'});
  const result=await until(async()=>{const info=await table.evaluate(t=>{let w=t.parentElement;while(w&&(!w.querySelector('[id="Exp"]')||!w.querySelector('[id="InfoTable"]')))w=w.parentElement;return w?.querySelector('[id="InfoTable"]')?.innerText.replace(/\u00a0/g,' ')||'';});const count=info.match(/Row\s+\d+\s+of\s+(\d+)/i);return count?{info,expected:Number(count[1])}:null;},'Export table total');
  const filters=await page.frame({name:'gutsPage'}).locator('body').evaluate(body=>Object.fromEntries(['dspStoreNo','selDepartment','txtBookingDateFrom','txtBookingDateTo','selDisplayOpts','selRegoNo','selStockNo','selCarline','chkAllBookings','txtStartDate','txtBayDiaryDate','txtAdvDiaryDate','dspSetNo','selPickUpAdvisor','dsaTeams','dsaStatus','txtDate','selFilter','selTeams'].map(id=>{const e=body.querySelector(`[id="${id}"]`);return [id,e?(e.type==='checkbox'?e.checked:e.value):null];}).filter(([,v])=>v!==null)));
  const pending=page.waitForEvent('download',{timeout:30000});await table.locator('xpath=ancestor::*[.//*[@id="Exp"]][1]').locator('[id="Exp"]').click();
  const download=await pending;const temp=join(out,`${name}.csv.partial`);await download.saveAs(temp);
  const bytes=await readFile(temp);let text=bytes.toString('utf8');const headerRenames={};
  if(selector==='#tblBookings'){
    const end=text.indexOf('\n');const first=text.slice(0,end).replace(/\r$/,'').replace(/^\uFEFF/,'');const h=first.split(',');
    if(h[13]!=='date out'||h[14]!=='time'||h[15]!=='due in'||h[16]!=='time')throw new Error('Unexpected loan-car header layout');
    h[14]='date_out_time';h[16]='due_in_time';text=h.join(',')+'\n'+text.slice(end+1);headerRenames[14]='time -> date_out_time';headerRenames[16]='time -> due_in_time';
  }
  const parsed=parseCsv(text);if(parsed.rows.length!==result.expected)throw new Error('Export row total mismatch');
  const finalBytes=Object.keys(headerRenames).length?Buffer.from(toCsv(parsed.headers,parsed.records),'utf8'):bytes;
  if(Object.keys(headerRenames).length)await writeFile(join(out,`${name}.csv`),finalBytes);else await rename(temp,join(out,`${name}.csv`));
  await writeFile(join(out,`${name}.manifest.json`),JSON.stringify({source:await page.title(),table:selector,filters,report_pagination:result.info,rows:parsed.rows.length,columns:parsed.headers,header_renames:headerRenames,native_sha256:createHash('sha256').update(bytes).digest('hex'),sha256:createHash('sha256').update(finalBytes).digest('hex'),exported_at:new Date().toISOString()},null,2));
  console.log(JSON.stringify({file:`${name}.csv`,rows:parsed.rows.length,columns:parsed.headers,filters}));
}finally{await browser.close();}
