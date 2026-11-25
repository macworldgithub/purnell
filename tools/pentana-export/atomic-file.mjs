import { writeFile, rename, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
let sequence = 0;
export async function atomicWriteFile(path, data, options) {
  if(path instanceof URL)path=fileURLToPath(path);
  const temporary = String(path) + '.tmp-' + process.pid + '-' + (++sequence);
  try {
    await writeFile(temporary, data, options);
    for (let attempt = 0; ; attempt++) {
      try { await rename(temporary, path); return; }
      catch (error) {
        if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt === 99) throw error;
        await new Promise(resolve => setTimeout(resolve, 40 + Math.random() * 30));
      }
    }
  } finally { await unlink(temporary).catch(() => {}); }
}
