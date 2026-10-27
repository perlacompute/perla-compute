import {build} from 'esbuild';
import {mkdir,cp,readFile,writeFile,rm,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');const output=resolve(root,'public/downloads');await mkdir(output,{recursive:true});
await build({entryPoints:[resolve(root,'lib/perla/rewards.ts')],outfile:resolve(root,'scripts/reward-allocation.mjs'),bundle:true,platform:'node',format:'esm',packages:'external',target:'node24'});
const temp=await mkdtemp(join(tmpdir(),'perla-release-'));const worker=join(temp,'perla-worker');const operator=join(temp,'perla-operator');const rtx=join(temp,'perla-rtx-worker');
try{
 await mkdir(rtx,{recursive:true});
 for(const file of ['Dockerfile','.dockerignore','build-cuda.sh','setup-worker.sh','rtx.cu','protocol.py','cuda_backend.py','reference.py','miner.py','test_protocol.py','doctor.py','perla','work-profiles.json','README.md','NOTICE.md'])await cp(resolve(root,'services/rtx-worker',file),join(rtx,file));
 await cp(resolve(root,'services/pearl-adapter/perla_bridge.py'),join(rtx,'perla_bridge.py'));
 await cp(resolve(root,'LICENSE'),join(rtx,'PERLA-MIT-LICENSE.txt'));
 await mkdir(worker,{recursive:true});await mkdir(join(operator,'scripts'),{recursive:true});await mkdir(join(operator,'contracts'),{recursive:true});
 for(const file of ['perla_bridge.py','verifier.py','worker-entrypoint.sh','setup-worker.sh','Dockerfile.worker','Dockerfile.verifier','NOTICE.md'])await cp(resolve(root,'services/pearl-adapter',file),join(worker,file));
 await cp(worker,join(operator,'services/pearl-adapter'),{recursive:true});
 await mkdir(join(operator,'lib/perla'),{recursive:true});
 await cp(resolve(root,'lib/perla/emission.mjs'),join(operator,'lib/perla/emission.mjs'));
 await cp(resolve(root,'scripts/perla-audit.mjs'),join(operator,'scripts/perla-audit.mjs'));
 await cp(resolve(root,'scripts/perla-control.mjs'),join(operator,'scripts/perla-control.mjs'));
 await cp(resolve(root,'scripts/reward-allocation.mjs'),join(operator,'scripts/reward-allocation.mjs'));
 await cp(resolve(root,'scripts/perla-rewards.mjs'),join(operator,'scripts/perla-rewards.mjs'));
 for(const n of ['PerlaRewards.sol','PerlaTestToken.sol'])await cp(resolve(root,'contracts',n),join(operator,'contracts',n));
 await writeFile(join(operator,'package.json'),JSON.stringify({name:'perla-mining-operator',private:true,type:'module',engines:{node:'>=22.13.0'},dependencies:{viem:'2.57.7',solc:'0.8.37'}},null,2)+'\n');
 await writeFile(join(worker,'README.txt'),'Perla worker adapter 0.1\nRead the website installation guide before running setup-worker.sh.\nSupported upstream profile: Linux, NVIDIA sm90 (H100/H200), dense rank-128 certificate v3.\nDownload your worker.env from the signed-in dashboard. No private wallet key is needed.\nGPU validation and operator activation are separate from software installation.\n');
 const sums=[];
 for(const name of ['perla-worker','perla-operator','perla-rtx-worker']){
  const archive=resolve(output,name+'.tar.gz');const result=spawnSync('tar',['--sort=name','--mtime=UTC 2026-10-22','--owner=0','--group=0','--numeric-owner','-czf',archive,'-C',temp,name],{encoding:'utf8'});if(result.status)throw Error(result.stderr||'Could not package mining adapter');
  const bytes=await readFile(archive);sums.push(createHash('sha256').update(bytes).digest('hex')+'  '+name+'.tar.gz');
 }
 await writeFile(resolve(output,'SHA256SUMS'),sums.join('\n')+'\n');console.log('Packaged worker and operator downloads with SHA-256 checksums.');
}finally{await rm(temp,{recursive:true,force:true});}
