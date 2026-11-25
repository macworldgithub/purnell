import {connect,clickText,visibleLocator,until} from './pentana-ui.mjs';
const {browser,page}=await connect();
try{
 for(const [selector,label] of [['#selFilter','All'],['#selTeams','Service'],['#selTeams','Pre Delivery']]){
  const control=await visibleLocator(page,'gutsPage',selector);await control.focus();await control.selectOption({label});await control.press('Tab');await page.waitForTimeout(600);
 }
 await clickText(page,'action','Refresh');
 await until(async()=>page.frame({name:'gutsPage'}).locator('#tblInProgress input').evaluateAll(es=>es.some(e=>e.value.trim())),'Workshop rows');
 console.log(JSON.stringify(await page.frame({name:'gutsPage'}).locator('body').evaluate(b=>({teams:b.querySelector('#dsaTeams').value,date:b.querySelector('#txtDate').value,filter:b.querySelector('#dsaStatus').value}))));
}finally{await browser.close();}
