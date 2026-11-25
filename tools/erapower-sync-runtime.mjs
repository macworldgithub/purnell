import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { atomicWriteFile } from './pentana-export/atomic-file.mjs';
export class SyncBudgetExceeded extends Error {
  constructor() { super('Time budget reached; checkpoints will resume automatically'); this.code='ERAPOWER_BUDGET'; }
}
export function createScriptRunner({ logPath, deadline, onActivity=()=>{} }) {
  return async function run(script,args,cwd,env) {
    const ui=cwd.endsWith('pentana-export');
    const remaining=deadline-Date.now();
    if(ui&&remaining<=0)throw new SyncBudgetExceeded();
    const timeout=ui?Math.min(100*60*1000,remaining):10*60*1000;
    await new Promise((resolve,reject)=>{
      const stream=createWriteStream(logPath,{flags:'a'});
      const child=spawn(process.execPath,[script,...args],{cwd,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
      let stopped,spawnError;
      stream.on('error',error=>{spawnError=error;child.kill();reject(error);});
      const timer=setTimeout(()=>{
        stopped=ui&&Date.now()>=deadline?new SyncBudgetExceeded():new Error('Stage timeout: '+script);
        if(process.platform==='win32') {
          const killer=spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
          killer.on('error',()=>child.kill());
          killer.on('exit',code=>{if(code!==0)child.kill();});
        } else child.kill('SIGTERM');
      },timeout);
      const append=chunk=>{
        let text=chunk.toString();
        for(const[key,value]of Object.entries(env||{}))if(/PASSWORD|SECRET|TOKEN|URI/.test(key)&&value?.length>8)text=text.replaceAll(value,'[redacted]');
        stream.write(text);onActivity();
      };
      child.stdout.on('data',append);child.stderr.on('data',append);
      child.on('error',error=>{spawnError=error;});
      child.on('close',code=>{
        clearTimeout(timer);
        stream.end(()=>{
          if(stopped||spawnError)reject(stopped||spawnError);
          else if(code!==0)reject(new Error('Sync stage failed: '+script));
          else resolve();
        });
      });
    });
  };
}
export async function loadJson(path,fallback=null) {
  try{return JSON.parse(await readFile(path,'utf8'));}catch(error){if(error.code==='ENOENT')return fallback;throw error;}
}
export const saveJson=(path,value)=>atomicWriteFile(path,JSON.stringify(value,null,2));
