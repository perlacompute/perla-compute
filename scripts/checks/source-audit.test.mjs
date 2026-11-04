import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,cp,writeFile,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
async function fixture(fn){const directory=await mkdtemp(join(tmpdir(),'perla-publication-'));try{await mkdir(join(directory,'scripts/checks'),{recursive:true});await cp(new URL('./source-audit.mjs',import.meta.url),join(directory,'scripts/checks/source-audit.mjs'));assert.equal(spawnSync('git',['init'],{cwd:directory}).status,0);await fn(directory);}finally{await rm(directory,{recursive:true,force:true});}}
const audit=directory=>spawnSync(process.execPath,['scripts/checks/source-audit.mjs'],{cwd:directory,encoding:'utf8'});
test('the publication guard accepts a clean tracked public source fixture',()=>fixture(async directory=>{await writeFile(join(directory,'README.md'),'Public source fixture.\n');assert.equal(spawnSync('git',['add','.'],{cwd:directory}).status,0);assert.equal(audit(directory).status,0);}));
test('tracked test-runtime journals are rejected without printing their contents',()=>fixture(async directory=>{await mkdir(join(directory,'.sites-runtime-fixture'));await writeFile(join(directory,'.sites-runtime-fixture/operator.json'),'INTERNAL_FIXTURE_VALUE_DO_NOT_PRINT');assert.equal(spawnSync('git',['add','-f','.'],{cwd:directory}).status,0);const result=audit(directory);assert.notEqual(result.status,0);assert(result.stderr.includes('private runtime path'));assert(!result.stderr.includes('INTERNAL_FIXTURE_VALUE_DO_NOT_PRINT'));}));
