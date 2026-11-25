import{readFile}from'node:fs/promises';
import{connect,until}from'./pentana-ui.mjs';
const state=JSON.parse(await readFile('exports/followup-2026-11-12/job-narratives-checkpoint.json'));
const{browser,page}=await connect();
try{
 let found=false;
 for(let n=0;n<10;n++){
  const table=page.frame({name:'gutsPage'}).locator('#tblRoHist');
  for(const e of await table.locator('input[id="searchresults_AtbOne"]').all()){
   if((await e.inputValue()).trim()===state.unavailable_ros[0]){await e.click();found=true;break;}
  }
  if(found)break;
  const wrap=table.locator('xpath=ancestor::*[.//*[@id="InfoTable"]][1]');
  const info=(await wrap.locator('[id="InfoTable"]').innerText()).replaceAll('\u00a0',' ');
  const p=info.match(/Page\s+(\d+)\s+of\s+(\d+)/);if(!p||p[1]===p[2])break;
  await wrap.locator('img[title="Move to next page"]').click();
  await until(async()=>(await wrap.locator('[id="InfoTable"]').innerText()).replaceAll('\u00a0',' ')!==info,'History page changed');
 }
 console.log(JSON.stringify({found_history_order:found}));
}finally{await browser.close();}
