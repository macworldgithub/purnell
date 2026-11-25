import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {connect,serviceMenu,clickText,visibleLocator,until} from './pentana-ui.mjs';
import {parseCsv,toCsv} from './csv.mjs';
const out=resolve(process.argv[2]||'exports/run-2026-10-26');
const customers=parseCsv(await readFile(join(out,'customers.csv'),'utf8')).records;
const file=join(out,'followups-checkpoint.json');
const state=JSON.parse(await readFile(file,'utf8').catch(()=>JSON.stringify({rows:[],warnings:[],queries:[],completed_customers:[],failures:[]})));
const rowHeaders=['customer_id','row_index','date','time','method','description','follow_up_date','stock_or_rego','reason','result','source','exported_at'];
const {browser,page}=await connect();
page.setDefaultTimeout(30000);
async function save(){state.updated_at=new Date().toISOString();await writeFile(file,JSON.stringify(state,null,2));await writeFile(join(out,'customer_followups.csv'),toCsv(rowHeaders,state.rows));await writeFile(join(out,'customer_warnings.csv'),toCsv(['customer_id','warning_text','source','exported_at'],state.warnings));await writeFile(join(out,'followup_query_coverage.csv'),toCsv(['customer_id','status','followup_rows','has_warning','exported_at'],state.queries));}
async function customerId(){const text=await page.frame({name:'gutsPage'}).locator('body').innerText();return text.match(/Vehicle\(s\) Display for:\s*(.*?)\s+-/)?.[1]?.trim()||'';}
async function dismissNoVehicles(){
  const modal=page.frames().filter(f=>f.name()==='guts').at(-1);
  const text=await modal?.locator('body').innerText({timeout:500}).catch(()=>'');
  if(!/No (?:records|vehicles) found/i.test(text||''))return false;
  await clickText(page,'action','OK');await page.waitForTimeout(150);return true;
}
async function customerMode(){
  for(const label of ['Registration No','Customer']){
    const type=await visibleLocator(page,'gutsPage','#selSearchBy');await type.focus();await type.selectOption({label});
    await (await visibleLocator(page,'gutsPage','#txtSearchFld')).focus();await page.waitForTimeout(150);
  }
  await until(async()=>await page.frame({name:'gutsPage'}).locator('#selSearchBy').inputValue()==='C','Customer search type');
}
try{
  await serviceMenu(page);await clickText(page,'gutsPage','Vehicle Information');
  const initialMessage=await page.frames().filter(f=>f.name()==='guts').at(-1)?.locator('body').innerText({timeout:500}).catch(()=>'');
  if(/No (?:records|vehicles) found|not found/i.test(initialMessage))await clickText(page,'action','OK');
  await clickText(page,'action','Reset');await page.waitForTimeout(200);
  await customerMode();
  for(const c of customers.filter(c=>!state.completed_customers.includes(c.customer_id))){
    try{
      await dismissNoVehicles();
      let reset=false;for(let attempt=0;attempt<3&&!reset;attempt++){await clickText(page,'action','Reset');reset=!!await until(async()=>!(await page.frame({name:'gutsPage'}).locator('#txtSearchFld').inputValue()),'Follow-up reset',2000).catch(()=>false);}if(!reset)throw new Error('Customer lookup did not reset');
      await customerMode();
      const f=await visibleLocator(page,'gutsPage','#txtSearchFld');await f.click();await f.press('ControlOrMeta+A');await f.pressSequentially(c.customer_id);if((await f.inputValue()).trim()!==c.customer_id)throw new Error('Customer lookup text changed');
      let result;
      for(let attempt=0;attempt<3&&!result;attempt++){
        await clickText(page,'action','Find').catch(error=>{if(!/Timeout/.test(error.message))throw error;});
        result=await until(async()=>{const modal=page.frames().filter(f=>f.name()==='guts').at(-1);const message=await modal?.locator('body').innerText({timeout:500}).catch(()=>'');if(/No (?:records|vehicles) found|not found/i.test(message))return 'no_vehicle';const id=await customerId();if(id===c.customer_id)return 'matched';return false;},'Customer follow-up context',5000).catch(()=>null);
      }
      // The matched customer heading and table below establish readiness.
      // Background polling makes networkidle unsuitable for this portal.
      await page.waitForTimeout(200);
      const lateMessage=await page.frames().filter(f=>f.name()==='guts').at(-1)?.locator('body').innerText({timeout:500}).catch(()=>'');
      if(/No (?:records|vehicles) found|not found/i.test(lateMessage))result='no_vehicle';
      if(result==='no_vehicle'){
        await clickText(page,'action','OK');await page.waitForTimeout(200);
        if(await customerId()!==c.customer_id){state.queries.push({customer_id:c.customer_id,status:'no_verified_customer_context_returned',followup_rows:'',has_warning:'',exported_at:new Date().toISOString()});state.completed_customers.push(c.customer_id);await save();console.log(`follow-up customers: ${state.completed_customers.length}/${customers.length}; customer context not returned`);continue;}
      }else if(result!=='matched')throw new Error('No verified customer follow-up context');
      if(!await page.frame({name:'gutsPage'}).locator('#tblContactHist').isVisible()){
        try{await page.frame({name:'gutsPage'}).getByText('Warning Messages / Follow-up Contact Details',{exact:true}).click({timeout:3000});}
        catch(error){
          if(!await dismissNoVehicles())throw error;
          result='no_vehicle';
          if(await customerId()!==c.customer_id){state.queries.push({customer_id:c.customer_id,status:'no_verified_customer_context_returned',followup_rows:'',has_warning:'',exported_at:new Date().toISOString()});state.completed_customers.push(c.customer_id);await save();continue;}
          if(!await page.frame({name:'gutsPage'}).locator('#tblContactHist').isVisible())await page.frame({name:'gutsPage'}).getByText('Warning Messages / Follow-up Contact Details',{exact:true}).click({timeout:3000});
        }
      }
      await page.frame({name:'gutsPage'}).locator('#tblContactHist').waitFor({state:'visible'});
      if(await customerId()!==c.customer_id)throw new Error('Customer context changed during follow-up capture');
      const rows=[];
      for(let guard=0;guard<200;guard++){
        const table=page.frame({name:'gutsPage'}).locator('#tblContactHist');
        const data=await table.evaluate(t=>{let w=t.parentElement;while(w&&!w.querySelector('[id="InfoTable"]'))w=w.parentElement;return {info:w?.querySelector('[id="InfoTable"]')?.innerText.replace(/\u00a0/g,' ')||'',rows:[...t.rows].slice(1).map(r=>[...r.querySelectorAll('input')].map(e=>e.value))};});
        const total=Number(data.info.match(/Row\s+\d+\s+of\s+(\d+)/i)?.[1]);const p=data.info.match(/Page\s+(\d+)\s+of\s+(\d+)/i);if(!p)throw new Error('Follow-up pagination not ready');
        for(const r of data.rows){if(!r.some(v=>v.trim()))continue;if(r.length!==8)throw new Error('Unexpected follow-up columns');rows.push({customer_id:c.customer_id,row_index:String(rows.length+1),date:r[0],time:r[1],method:r[2],description:r[3],follow_up_date:r[4],stock_or_rego:r[5],reason:r[6],result:r[7]});}
        if(p[1]===p[2]){if(rows.length!==total&&!(total===1&&rows.length===0))throw new Error('Follow-up row total mismatch');break;}
        if(guard===199)throw new Error('Follow-up pagination limit reached before the final page');
        await table.locator('xpath=ancestor::*[.//*[@id="InfoTable"]][1]').locator('img[title="Move to next page"]').click();
        await until(async()=>await page.frame({name:'gutsPage'}).locator('#tblContactHist').evaluate(t=>{let w=t.parentElement;while(w&&!w.querySelector('[id="InfoTable"]'))w=w.parentElement;return w?.querySelector('[id="InfoTable"]')?.innerText.replace(/\u00a0/g,' ')||'';})!==data.info,'Follow-up page');
      }
      const warning=await page.frame({name:'gutsPage'}).locator('#txaWarningMsgs').inputValue();const when=new Date().toISOString();
      for(const r of rows){r.source='Vehicle Information customer contact history';r.exported_at=when;}
      state.rows.push(...rows);if(warning.trim())state.warnings.push({customer_id:c.customer_id,warning_text:warning,source:'Vehicle Information warning messages',exported_at:when});
      state.queries.push({customer_id:c.customer_id,status:result==='no_vehicle'?'context_verified_without_vehicle_rows':'context_verified',followup_rows:String(rows.length),has_warning:String(!!warning.trim()),exported_at:when});state.completed_customers.push(c.customer_id);await save();
      console.log(`follow-up customers: ${state.completed_customers.length}/${customers.length}; notes: ${state.rows.length}; warnings: ${state.warnings.length}`);
    }catch(error){state.failures.push({customer_id:c.customer_id,error:error.message});await save();console.log('Follow-up extraction stopped; see checkpoint.');break;}
  }
  await save();console.log(JSON.stringify({queried_customers:state.completed_customers.length,expected_customers:customers.length,notes:state.rows.length,warnings:state.warnings.length}));
}finally{await browser.close();}
