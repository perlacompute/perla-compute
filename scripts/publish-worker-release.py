#!/usr/bin/env python3
"""Publish checked assets through a resumable draft; never replace existing assets."""
import argparse,hashlib,json,os,subprocess,tempfile
from pathlib import Path
REPO='perlacompute/perla-compute'
NAMES={'install.sh','install.py','worker-release.json','perla-rtx-worker.tar.gz','perla-worker.tar.gz','SHA256SUMS'}
class ReleaseError(Exception):pass
def command(args):
 p=subprocess.run(args,capture_output=True,text=True)
 if p.returncode:raise ReleaseError('GitHub operation failed: '+' '.join(args[:3]))
 return p.stdout.strip()
def publish(folder,tag,commit,verify_only=False,runner=command):
 folder=Path(folder);manifest=json.loads((folder/'worker-release.json').read_text())
 if manifest.get('tag')!=tag or manifest.get('repository')!=REPO:raise ReleaseError('Release manifest does not match the requested tag and repository.')
 if {p.name for p in folder.iterdir() if p.is_file()}!=NAMES:raise ReleaseError('Unexpected worker release files.')
 expected={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in folder.iterdir() if p.is_file()}
 listed={}
 for line in (folder/'SHA256SUMS').read_text().splitlines():
  sha,name=line.split('  ',1)
  if name in listed:raise ReleaseError('Duplicate checksum entry.')
  listed[name]=sha
 if listed!={k:v for k,v in expected.items() if k!='SHA256SUMS'}:raise ReleaseError('Worker asset checksum list differs.')
 resolved=runner(['gh','api','repos/'+REPO+'/commits/'+tag,'--jq','.sha'])
 if resolved!=commit:raise ReleaseError('Published Git tag does not point to the checked source commit.')
 repo=json.loads(runner(['gh','api','repos/'+REPO]))
 def release():
  releases=json.loads(runner(['gh','api','repos/'+REPO+'/releases?per_page=100']))
  selected=[r for r in releases if r.get('tag_name')==tag]
  if len(selected)>1:raise ReleaseError('Multiple releases have this tag; inspect them before publishing.')
  return selected[0] if selected else None
 current=release()
 if current is None:
  if verify_only:raise ReleaseError('Worker release has not been created yet.')
  notes=Path(__file__).resolve().parent.parent/'docs/worker-release-notes.md'
  runner(['gh','release','create',tag,'--repo',REPO,'--verify-tag','--draft','--prerelease','--title','Perla Worker '+manifest['version']+' — validation preview','--notes-file',str(notes)])
  current=release()
 if not current or current.get('prerelease') is not True:raise ReleaseError('Expected a worker validation prerelease.')
 assets=current.get('assets',[]);names=[a['name'] for a in assets]
 if len(names)!=len(set(names)) or not set(names)<=NAMES:raise ReleaseError('Unexpected or duplicate assets in this release.')
 for asset in assets:
  name=asset['name'];remote_digest=asset.get('digest')
  if remote_digest:
   if remote_digest!='sha256:'+expected[name]:raise ReleaseError('Existing release asset differs; it was preserved: '+name)
  else:
   with tempfile.TemporaryDirectory(prefix='perla-asset-check-') as d:
    runner(['gh','release','download',tag,'--repo',REPO,'--pattern',name,'--dir',d])
    if hashlib.sha256((Path(d)/name).read_bytes()).hexdigest()!=expected[name]:raise ReleaseError('Existing release asset differs; it was preserved: '+name)
 missing=sorted(NAMES-set(names))
 if missing:
  if verify_only or not current.get('draft'):raise ReleaseError('Published release is incomplete. No asset was overwritten.')
  runner(['gh','release','upload',tag,'--repo',REPO,*[str(folder/name) for name in missing]])
  return publish(folder,tag,commit,verify_only,runner)
 if current.get('draft'):
  if verify_only:raise ReleaseError('Worker release is still a draft.')
  runner(['gh','release','edit',tag,'--repo',REPO,'--draft=false','--prerelease'])
  current=release()
 if not current or current.get('draft') or current.get('prerelease') is not True:raise ReleaseError('Published worker release could not be confirmed.')
 report={'repository':'https://github.com/'+REPO,'tag':tag,'commit':commit,'releaseUrl':current.get('html_url'),'published':True,'prerelease':True,'verifiedAssets':sorted(NAMES),'checksumsVerified':True,'visibility':repo.get('visibility') or ('private' if repo.get('private') else 'public'),'publicInstallAvailable':repo.get('private') is False,'visibilityChanged':False,'miningActivated':False,'gpuHardwareValidatedByRelease':False}
 return report
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--folder',required=True,type=Path);p.add_argument('--tag',required=True);p.add_argument('--commit',required=True);p.add_argument('--verify-only',action='store_true');a=p.parse_args()
 try:print(json.dumps(publish(a.folder,a.tag,a.commit,a.verify_only),indent=2))
 except (ReleaseError,OSError,ValueError,KeyError) as e:print(str(e));raise SystemExit(1)
