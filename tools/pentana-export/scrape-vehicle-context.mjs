import {readFile,mkdir} from 'node:fs/promises';
import {atomicWriteFile as writeFile} from './atomic-file.mjs';
import {resolve,join} from 'node:path';
import {connect,serviceMenu,clickText,until} from './pentana-ui.mjs';
import {parseCsv,toCsv} from './csv.mjs';
import {handleKnownSerialWarning} from './ensure-session.mjs';
const out=resolve(process.argv[2]||'exports/supplement-2026-10-29');await mkdir(out,{recursive:true});
const vehicles=parseCsv(await readFile(process.argv[3]||'exports/run-2026-10-26/vehicles.csv','utf8')).records;
const file=join(out,'vehicle-context-checkpoint.json');
const state=JSON.parse(await readFile(file,'utf8').catch(()=>JSON.stringify({records:[],completed:[],failures:[]})));
state.unavailable_records??=[];
const fields={customer_id:'entityname_entityid',registration:'SERINDEX_RegNo',last_ro_number:'SERINDEX_LastRoNo',last_ro_date:'SERINDEX_LastRoDate',last_ro_mileage:'SERINDEX_LastRoKs',salesman_id:'SERINDEX_Salesman',delivery_date:'SERINDEX_DelvDate',original_delivery_date:'SERINDEX_OrigDelDate',follow_up_date:'SERINDEX_FollowUpDate',team_code:'SERINDEX_TeamCode',warranty_start_date:'SERINDEX_WarrStartDate',warranty_expiry_date:'SERINDEX_WarrExpDate',warranty_expiry_mileage:'SERINDEX_WarrExpMileage',warranty_company:'SERINDEX_WarrantyCo',service_contract_number:'SERINDEX_SvcContractNo',service_contract_name:'SERINDEX_SvcContractName',service_contract_expiry_date:'SERINDEX_ExtdWarrExprDate',service_contract_expiry_mileage:'SERINDEX_ExtdWarrExprMileage',vip_club:'SERINDEX_VipClub',vip_member_number:'SERINDEX_VipMemberNo',vip_expiry_date:'SERINDEX_VipExprDate',ro_comments:'SERINDEX_RoComments',comments_1:'SERINDEX_Comments1',comments_2:'SERINDEX_Comments2'};
async function save(){state.updated_at=new Date().toISOString();await writeFile(file,JSON.stringify(state,null,2));await writeFile(join(out,'vehicle_service_customer_context.csv'),toCsv(['serial_no',...Object.keys(fields),'source','exported_at'],state.records));await writeFile(join(out,'vehicle_context_unavailable.csv'),toCsv(['serial_no','status','observed_at'],state.unavailable_records));}
const portalIndex=Number(process.argv.find(arg=>arg.startsWith('--portal-index='))?.slice(15)||0);
const {browser,page}=await connect({portalIndex});page.setDefaultTimeout(15000);
let fastInput=true;
let resetEachLookup=true;
async function enterSerial(serial,fast){
  const q=page.frame({name:'gutsPage'}).locator('#txtSearchFld');
  await q.click();
  if(fast){
    await q.fill(serial);await q.press('End');await q.press('Backspace');await q.pressSequentially(serial.slice(-1));
  }else{await q.press('ControlOrMeta+A');await q.pressSequentially(serial);}
  if(await q.inputValue()!==serial)throw Error('Search value mismatch');
  await q.press('Tab');
}
async function findSerial(serial){
  const matched=()=>until(async()=>await page.frame({name:'gutsPage'}).locator('#tblOwnedList input[id="searchresults_ColOne"]').evaluateAll((es,s)=>es.some(e=>e.value.trim()===s),serial),'Matched vehicle',15000);
  const usedFast=fastInput;
  try{await enterSerial(serial,usedFast);await clickText(page,'action','Find');await matched();}
  catch(error){
    if(!usedFast)throw error;
    fastInput=false;
    resetEachLookup=true;
    const msg=await page.frames().filter(f=>f.name()==='guts').at(-1)?.locator('body').innerText({timeout:500}).catch(()=>'');
    if(msg){if(!/No records found|Search criteria must|Please enter a string you want to find first/i.test(msg))throw error;await clickText(page,'action','OK');}
    await clickReadAction('Reset');
    const type=page.frame({name:'gutsPage'}).locator('#selSearchBy');await type.focus();await type.selectOption({label:'Serial No'});await page.frame({name:'gutsPage'}).locator('#txtSearchFld').focus();
    await enterSerial(serial,false);await clickText(page,'action','Find');await matched();
  }
  state.fast_input_lookups=(state.fast_input_lookups||0)+(fastInput?1:0);
}
async function clickReadAction(text){
  await handleKnownSerialWarning(page);
  try { await clickText(page,'action',text); }
  catch(error){
    if(!await handleKnownSerialWarning(page))throw error;
    await clickText(page,'action',text);
  }
}
try{
  // Use report lookup links; never save a vehicle maintenance record.
  await serviceMenu(page);await clickText(page,'gutsPage','Vehicle Information');
  for(const vehicle of vehicles.filter(v=>!state.completed.includes(v.serial_no))){
    try{
      const frame=()=>page.frame({name:'gutsPage'});
      if(resetEachLookup){await clickReadAction('Reset');await page.waitForTimeout(200);}
      const select=frame().locator('#selSearchBy');
      if(await select.inputValue()!=='S'){
        await select.focus();await select.selectOption({label:'Registration No'});await frame().locator('#txtSearchFld').focus();await page.waitForTimeout(200);
        await select.focus();await select.selectOption({label:'Serial No'});await frame().locator('#txtSearchFld').focus();await page.waitForTimeout(200);
      }
      await findSerial(vehicle.serial_no);
      const links=frame().locator('#tblOwnedList input[id="searchresults_ColOne"]');let chosen;
      for(const e of await links.all())if((await e.inputValue()).trim()===vehicle.serial_no){chosen=e;break;}
      await chosen.click();await frame().locator('#SERINDEX_SerindexID').waitFor({state:'visible'});
      await until(async()=>await frame().locator('#SERINDEX_SerindexID').inputValue()===vehicle.serial_no,'Maintenance serial');
      // Record identity and section fields are explicitly verified below.
      // Background polling can keep the legacy portal from reaching networkidle.
      const modal=await page.frames().filter(f=>f.name()==='guts').at(-1)?.locator('body').innerText({timeout:300}).catch(()=>'');
      if(/serial number/i.test(modal||'')&&/Do you wish to accept it/.test(modal)){
        // Acknowledge the existing source identifier for viewing; do not change or save it.
        await handleKnownSerialWarning(page);
      }
      for(const section of ['Vehicle Details','Service / Warranty','Sales']){
        const marker=section==='Vehicle Details'?'#SERINDEX_RegNo':section==='Sales'?'#SERINDEX_Salesman':'#SERINDEX_WarrStartDate';
        for(let attempt=0;attempt<3;attempt++){
          if(await frame().locator(marker).isVisible())break;
          try { await frame().getByText(section,{exact:true}).click(); }
          catch(error) {
            // Serial warnings may arrive after the maintenance frame appears.
            // Acknowledge only a known source identifier, then retry the view.
            if(await handleKnownSerialWarning(page))continue;
            throw error;
          }
          await frame().locator(marker).waitFor({state:'visible',timeout:2500}).catch(()=>{});
        }
        await frame().locator(marker).waitFor({state:'visible'});
      }
      const values=await frame().locator('body').evaluate((body,fields)=>Object.fromEntries(Object.entries(fields).map(([key,id])=>{const e=body.querySelector(`[id="${id}"]`);if(!e||!e.getClientRects().length)throw Error('Requested field not visible: '+id);return [key,e.value];})),fields);
      if(await frame().locator('#SERINDEX_SerindexID').inputValue()!==vehicle.serial_no)throw Error('Context changed');
      state.records.push({serial_no:vehicle.serial_no,...values,source:'Service Vehicle Maintenance visible sections',exported_at:new Date().toISOString()});state.completed.push(vehicle.serial_no);state.unavailable_records=state.unavailable_records.filter(row=>row.serial_no!==vehicle.serial_no);await save();
      console.log(`Vehicle context: ${state.completed.length}/${vehicles.length}`);
      await clickReadAction('Exit');
      await until(async()=>{await handleKnownSerialWarning(page);return await frame().locator('#selSearchBy').isVisible();},'Vehicle lookup restored');
    }catch(error){
      const dialog=page.frames().filter(f=>f.name()==='guts').at(-1);
      const message=await dialog?.locator('body').innerText({timeout:500}).catch(()=>'');
      const locked=message?.match(/The item \[([^\]]+)\] in file \[SERINDEX\] is locked/i);
      if(locked&&locked[1].trim()===vehicle.serial_no.trim()){
        state.failures.push({serial_no:vehicle.serial_no,error:'Source vehicle record locked by another eraPower session'});
        state.unavailable_records=state.unavailable_records.filter(row=>row.serial_no!==vehicle.serial_no);
        state.unavailable_records.push({serial_no:vehicle.serial_no,status:'source_record_locked',observed_at:new Date().toISOString()});
        await save();
        const modalAction=dialog.parentFrame()?.childFrames().find(f=>f.name()==='action');
        for(const label of ['Cancel','OK','Exit']){
          const button=modalAction?.getByText(label,{exact:true});
          if(await button?.isVisible().catch(()=>false)){await button.click();break;}
        }
        await until(async()=>dialog.isDetached()||!await dialog.locator('body').isVisible().catch(()=>false),'Locked-record message closed',45000);
        await serviceMenu(page);await clickText(page,'gutsPage','Vehicle Information');
        console.log('Locked vehicle recorded as unavailable; continuing other vehicles.');
        continue;
      }
      state.failures.push({serial_no:vehicle.serial_no,error:error.message});await save();console.log('Stopped; see vehicle-context-checkpoint.json');break;
    }
  }
  await save();
  console.log(JSON.stringify({exported:state.records.length,total:vehicles.length}));
}finally{await browser.close();}
