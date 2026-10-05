import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const directory=process.argv[2]?path.resolve(process.argv[2]):fileURLToPath(new URL('../public/models/',import.meta.url));
const modelSha='fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1';
try{
  const model=await readFile(path.join(directory,'hand_landmarker.task'));
  if(createHash('sha256').update(model).digest('hex')!==modelSha)throw new Error('Hand model checksum mismatch');
  for(const variant of ['vision_wasm_internal','vision_wasm_nosimd_internal']){
    const wasm=await readFile(path.join(directory,'wasm',`${variant}.wasm`));
    if(wasm.length<1_000_000||wasm.readUInt32LE(0)!==0x6d736100)throw new Error(`Invalid WASM: ${variant}`);
    if((await stat(path.join(directory,'wasm',`${variant}.js`))).size<10_000)throw new Error(`Missing runtime: ${variant}`);
  }
  console.log('Local hand model checksum and SIMD/no-SIMD runtimes verified.');
}catch(error){
  console.error(`Local recognition assets missing or damaged. Run: npm run setup:models\n${error.message}`);
  process.exitCode=1;
}
