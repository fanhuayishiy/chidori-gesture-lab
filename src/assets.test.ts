import { describe,it,expect } from 'vitest';
import { spawnSync } from 'node:child_process';

describe('local model build guard',()=>{
  it('fails early with a recovery command when model files are absent',()=>{
    const result=spawnSync(process.execPath,['scripts/check-models.mjs','tests/fixtures'],{encoding:'utf8'});
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('npm run setup:models');
  });
  it('accepts the installed real model and both WASM variants',()=>{
    const result=spawnSync(process.execPath,['scripts/check-models.mjs'],{encoding:'utf8'});
    expect(result.status,result.stderr).toBe(0);
    expect(result.stdout).toContain('verified');
  });
});
