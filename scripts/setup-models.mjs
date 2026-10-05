import { mkdir, copyFile, readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const destination = path.join(root, 'public/models');
await mkdir(path.join(destination, 'wasm'), { recursive: true });
const source = path.join(root, 'node_modules/@mediapipe/tasks-vision/wasm');
for (const name of await readdir(source)) {
  if (/\.(wasm|js)$/.test(name)) await copyFile(path.join(source, name), path.join(destination, 'wasm', name));
}
const modelPath = path.join(destination, 'hand_landmarker.task');
const expectedSha = 'fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1';
const existing = await readFile(modelPath).catch(() => null);
if (!existing || createHash('sha256').update(existing).digest('hex') !== expectedSha) {
  const url = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
  console.log('Downloading official MediaPipe hand model...');
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Model download failed: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(bytes).digest('hex') !== expectedSha) throw new Error('Model checksum mismatch; refusing unverified download');
  await writeFile(modelPath, bytes);
  console.log(`Model downloaded: ${bytes.length} bytes, SHA256 ${createHash('sha256').update(bytes).digest('hex')}`);
}
console.log('Local model and WASM assets ready. No remote model requests at runtime.');
