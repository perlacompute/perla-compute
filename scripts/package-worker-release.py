#!/usr/bin/env python3
"""Create deterministic worker-only GitHub release assets from reviewed source."""
import argparse,gzip,hashlib,io,json,tarfile
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
RTX=['Dockerfile','.dockerignore','build-cuda.sh','setup-worker.sh','rtx.cu','protocol.py','cuda_backend.py','reference.py','miner.py','test_protocol.py','doctor.py','perla','work-profiles.json','README.md','NOTICE.md']
HOPPER=['perla_bridge.py','verifier.py','worker-entrypoint.sh','setup-worker.sh','Dockerfile.worker','Dockerfile.verifier','NOTICE.md']
def package(output,tag):
 manifest=json.loads((ROOT/'services/worker-release.json').read_text())
 if tag!=manifest['tag']:raise ValueError('Worker release tag differs from the reviewed manifest.')
 output.mkdir(parents=True,exist_ok=True)
 def archive(profile,names,folder):
  info=manifest['profiles'][profile];files={n:(ROOT/folder/n).read_bytes() for n in names}
  files['perla_bridge.py']=(ROOT/'services/pearl-adapter/perla_bridge.py').read_bytes();files['PERLA-MIT-LICENSE.txt']=(ROOT/'LICENSE').read_bytes()
  raw=io.BytesIO()
  with tarfile.open(fileobj=raw,mode='w') as tar:
   for name,data in sorted(files.items()):
    item=tarfile.TarInfo(info['root']+'/'+name);item.size=len(data);item.mode=0o755 if name.endswith('.sh') or name=='perla' else 0o644;item.mtime=0;tar.addfile(item,io.BytesIO(data))
  (output/info['archive']).write_bytes(gzip.compress(raw.getvalue(),mtime=0))
 archive('rtx',RTX,'services/rtx-worker');archive('hopper',HOPPER,'services/pearl-adapter')
 (output/'install.py').write_bytes((ROOT/'scripts/perla-worker.py').read_bytes());(output/'install.sh').write_bytes((ROOT/'install.sh').read_bytes());(output/'worker-release.json').write_text(json.dumps(manifest,indent=2)+'\n')
 names=['install.sh','install.py','worker-release.json','perla-rtx-worker.tar.gz','perla-worker.tar.gz']
 (output/'SHA256SUMS').write_text(''.join(hashlib.sha256((output/name).read_bytes()).hexdigest()+'  '+name+'\n' for name in names))
 print('Packaged 6 worker release files; no credentials, operator contracts or runtime data are included.')
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--output',required=True,type=Path);p.add_argument('--tag',required=True);a=p.parse_args();package(a.output,a.tag)
