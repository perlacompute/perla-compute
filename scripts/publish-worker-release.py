#!/usr/bin/env python3
"""Publish checked assets through a resumable draft; never replace existing assets."""
import argparse,hashlib,json,os,re,subprocess,tempfile,time
from pathlib import Path
REPO='perlacompute/perla-compute'
NAMES={'install.sh','install.py','worker-release.json','perla-rtx-worker.tar.gz','perla-worker.tar.gz','SHA256SUMS'}
class ReleaseError(Exception):pass
def command(args):
 p=subprocess.run(args,capture_output=True,text=True)
 if p.returncode:
  detail=(p.stderr or p.stdout).strip()[-2000:]
  for key in ['GH_TOKEN','GITHUB_TOKEN']:
   if os.environ.get(key):detail=detail.replace(os.environ[key],'[redacted]')
  detail=re.sub(r'\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)\b','[redacted]',detail)
  raise ReleaseError('GitHub operation failed: '+' '.join(args[:3])+'\n'+detail)
 return p.stdout.strip()
def publish(folder,tag,commit,verify_only=False,runner=command,sleep=time.sleep,known_release_id=None):
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
 endpoint='repos/'+REPO+'/releases'
 def api(path,*args):return json.loads(runner(['gh','api',path,*args,'-H','Cache-Control: no-cache']))
 # List only to locate an existing draft. After creation, retain its returned ID.
 # A fresh list read is not an acknowledgement of the preceding write.
 if known_release_id is not None:
  if type(known_release_id) is not int or known_release_id<=0:raise ReleaseError('Invalid existing release ID.')
  current=api(endpoint+'/'+str(known_release_id))
  if current.get('id')!=known_release_id or current.get('tag_name')!=tag:raise ReleaseError('Existing release ID does not match the worker tag.')
 else:
  selected=[];page=1
  while True:
   releases=api(endpoint+'?per_page=100&page='+str(page))
   if not isinstance(releases,list):raise ReleaseError('Unexpected release listing.')
   selected.extend(r for r in releases if r.get('tag_name')==tag)
   if len(selected)>1:raise ReleaseError('Multiple releases have this tag; inspect them before publishing.')
   if len(releases)<100:break
   page+=1
   if page>100:raise ReleaseError('Release listing is too large; inspect the requested tag.')
  current=selected[0] if selected else None
 if current is None:
  if verify_only:raise ReleaseError('Worker release has not been created yet.')
  notes=Path(__file__).resolve().parent.parent/'docs/worker-release-notes.md'
  current=api(endpoint,'--method','POST','-f','tag_name='+tag,'-f','target_commitish='+commit,'-f','name=Perla Worker '+manifest['version']+' — validation preview','-F','draft=true','-F','prerelease=true','-F','body=@'+str(notes))
 release_id=current.get('id') if isinstance(current,dict) else None
 if type(release_id) is not int or release_id<=0:raise ReleaseError('Release response has no valid ID; inspect the draft before retrying.')
 release_endpoint=endpoint+'/'+str(release_id)
 def inspect(value):
  if value.get('id')!=release_id or value.get('tag_name')!=tag or type(value.get('draft')) is not bool:raise ReleaseError('Release ID or tag changed; no asset was replaced.')
  if not value['draft'] and value.get('prerelease') is not True:raise ReleaseError('Expected a worker validation prerelease; an existing full release was preserved.')
  assets=value.get('assets');names=[a.get('name') for a in assets] if isinstance(assets,list) else []
  if not isinstance(assets,list) or len(names)!=len(set(names)) or not set(names)<=NAMES:raise ReleaseError('Unexpected or duplicate assets in this release.')
  for asset in assets:
   name=asset['name'];remote_digest=asset.get('digest')
   if remote_digest:
    if remote_digest!='sha256:'+expected[name]:raise ReleaseError('Existing release asset differs; it was preserved: '+name)
   else:
    with tempfile.TemporaryDirectory(prefix='perla-asset-check-') as d:
     runner(['gh','release','download',tag,'--repo',REPO,'--pattern',name,'--dir',d])
     if hashlib.sha256((Path(d)/name).read_bytes()).hexdigest()!=expected[name]:raise ReleaseError('Existing release asset differs; it was preserved: '+name)
  return set(names)
 def refresh(predicate,message):
  for attempt in range(6):
   value=api(release_endpoint);names=inspect(value)
   if predicate(value,names):return value
   if attempt<5:sleep(.5)
  raise ReleaseError(message+' (release ID '+str(release_id)+'). Rerun after inspecting this draft; existing assets were retained.')
 names=inspect(current)
 missing=sorted(NAMES-set(names))
 if missing:
  if verify_only or not current.get('draft'):raise ReleaseError('Published release is incomplete. No asset was overwritten.')
  runner(['gh','release','upload',tag,'--repo',REPO,*[str(folder/name) for name in missing]])
  current=refresh(lambda value,names:names==NAMES,'Uploaded assets were not confirmed')
 if current.get('draft'):
  if verify_only:raise ReleaseError('Worker release is still a draft.')
  if runner(['gh','api','repos/'+REPO+'/commits/'+tag,'--jq','.sha'])!=commit:raise ReleaseError('Worker tag changed before publication; draft was preserved.')
  updated=api(release_endpoint,'--method','PATCH','-F','draft=false','-F','prerelease=true')
  inspect(updated)
  current=refresh(lambda value,names:not value['draft'] and value.get('prerelease') is True and names==NAMES,'Published worker release could not be confirmed')
 if inspect(current)!=NAMES:raise ReleaseError('Published release is incomplete. No asset was overwritten.')
 if runner(['gh','api','repos/'+REPO+'/commits/'+tag,'--jq','.sha'])!=commit:raise ReleaseError('Worker tag changed; the release commit is not confirmed.')
 repo=json.loads(runner(['gh','api','repos/'+REPO]))
 report={'repository':'https://github.com/'+REPO,'tag':tag,'commit':commit,'releaseId':release_id,'releaseUrl':current.get('html_url'),'published':True,'prerelease':True,'verifiedAssets':sorted(NAMES),'checksumsVerified':True,'visibility':repo.get('visibility') or ('private' if repo.get('private') else 'public'),'publicInstallAvailable':repo.get('private') is False,'visibilityChanged':False,'miningActivated':False,'gpuHardwareValidatedByRelease':False}
 return report
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--folder',required=True,type=Path);p.add_argument('--tag',required=True);p.add_argument('--commit',required=True);p.add_argument('--verify-only',action='store_true');p.add_argument('--release-id',type=int);a=p.parse_args()
 try:print(json.dumps(publish(a.folder,a.tag,a.commit,a.verify_only,known_release_id=a.release_id),indent=2))
 except (ReleaseError,OSError,ValueError,KeyError) as e:print(str(e));raise SystemExit(1)
