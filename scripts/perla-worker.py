#!/usr/bin/env python3
"""Verified Perla worker installation and explicit lifecycle commands."""
import argparse,fcntl,hashlib,io,json,os,platform,re,shlex,shutil,stat,subprocess,sys,tarfile,tempfile,time,urllib.error,urllib.parse,urllib.request
from pathlib import Path
REPO='perlacompute/perla-compute'
DEFAULT_RELEASE='worker-v0.7.0'
SCHEMA=1
class WorkerError(Exception):pass

def digest(data):return hashlib.sha256(data).hexdigest()
def emit(data):print(json.dumps(data,indent=2))
def regular(path,limit=1024*1024):
 if path.is_symlink() or not path.is_file() or path.stat().st_size>limit:raise WorkerError('Expected a regular, bounded file: '+path.name)
 return path.read_bytes()
def directory(path):
 path=Path(os.path.abspath(os.path.expanduser(str(path))))
 if any(p.is_symlink() for p in [path,*path.parents]):raise WorkerError('Installation paths must not contain symlinks.')
 if any(ord(c)<32 for c in str(path)):raise WorkerError('Invalid installation path.')
 path.mkdir(parents=True,exist_ok=True,mode=0o700)
 return path

def atomic(path,data,mode=0o600):
 if any(p.is_symlink() for p in [path,*path.parents]) or (path.exists() and not path.is_file()):raise WorkerError('Refusing an unexpected destination: '+path.name)
 path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
 fd,temporary=tempfile.mkstemp(prefix=path.name+'.new-',dir=path.parent)
 try:
  with os.fdopen(fd,'wb') as out:out.write(data);out.flush();os.fsync(out.fileno())
  os.chmod(temporary,mode);os.replace(temporary,path)
 finally:
  if os.path.exists(temporary):os.unlink(temporary)

def command(args,visible=False,env=None,timeout=None):
 try:
  p=subprocess.run(args,stdout=None if visible else subprocess.PIPE,stderr=None if visible else subprocess.PIPE,env=env,timeout=timeout)
 except FileNotFoundError:raise WorkerError('Missing executable: '+args[0]) from None
 except subprocess.TimeoutExpired:raise WorkerError('Command timed out: '+args[0]) from None
 except OSError:raise WorkerError('Cannot execute: '+args[0]) from None
 if p.returncode:
  detail=(p.stderr or b'').decode(errors='replace')[-1000:] if not visible else ''
  raise WorkerError('Command failed: '+' '.join(args[:2])+' '+detail)
 return p.stdout.decode().strip() if p.stdout is not None else ''

class HTTPSOnly(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,req,fp,code,msg,headers,newurl):
  u=urllib.parse.urlsplit(newurl)
  if u.scheme!='https' or not (u.hostname=='github.com' or (u.hostname or '').endswith('.githubusercontent.com')) or u.username or u.password:raise WorkerError('Unexpected GitHub download redirect.')
  return super().redirect_request(req,fp,code,msg,headers,newurl)
def download(url,limit):
 u=urllib.parse.urlsplit(url)
 if u.scheme!='https' or u.hostname not in ('api.github.com','github.com') or u.username or u.password:raise WorkerError('Use an official HTTPS GitHub release.')
 request=urllib.request.Request(url,headers={'User-Agent':'Perla-Worker-Installer/1.0','Accept':'application/vnd.github+json' if u.hostname=='api.github.com' else 'application/octet-stream'})
 try:
  with urllib.request.build_opener(HTTPSOnly()).open(request,timeout=45) as response:data=response.read(limit+1)
 except (urllib.error.URLError,OSError):raise WorkerError('Could not download the published release. It must be public and contain the installer assets.') from None
 if len(data)>limit:raise WorkerError('Release file exceeds its size limit.')
 return data

def checksums(data):
 result={}
 for line in data.decode('ascii').splitlines():
  if not line:continue
  match=re.fullmatch(r'([a-f0-9]{64})  ([A-Za-z0-9._-]+)',line)
  if not match or match[2] in result:raise WorkerError('Malformed or duplicate release checksum.')
  result[match[2]]=match[1]
 return result

def extract(archive,target,root_name):
 seen=set();total=0;inventory={}
 with tarfile.open(fileobj=io.BytesIO(archive),mode='r|gz') as tar:
  for item in tar:
   p=Path(item.name)
   name=p.as_posix()
   if p.is_absolute() or '..' in p.parts or not p.parts or p.parts[0]!=root_name or not(item.isdir() or item.isfile()) or item.sparse is not None or name in seen or '\\' in item.name:raise WorkerError('Unsafe or duplicate worker archive member.')
   seen.add(name);total+=item.size
   if len(seen)>3000:raise WorkerError('Too many archive members.')
   if total>200*1024*1024 or item.size>30*1024*1024:raise WorkerError('Worker archive exceeds its extraction limit.')
   relative=Path(item.name).relative_to(root_name)
   if relative==Path('.'):continue
   path=target/relative
   if item.isdir():path.mkdir(parents=True,exist_ok=True);continue
   path.parent.mkdir(parents=True,exist_ok=True);data=tar.extractfile(item).read()
   if len(data)!=item.size:raise WorkerError('Truncated worker archive.')
   path.write_bytes(data);path.chmod(0o755 if item.mode&0o111 else 0o644);inventory[relative.as_posix()]=digest(data)
 if not inventory or 'setup-worker.sh' not in inventory or 'perla_bridge.py' not in inventory:raise WorkerError('Incomplete worker archive.')
 return inventory

def state(root):
 value=json.loads(regular(root/'current.json'))
 if value.get('schema')!=SCHEMA or value.get('repository')!=REPO or value.get('profile') not in ('rtx','hopper') or not re.fullmatch(r'worker-v\d+\.\d+\.\d+',value.get('release','')):raise WorkerError('Invalid installed-worker metadata.')
 expected=root/'versions'/(value['release']+'-'+value['profile'])
 if str(expected)!=value.get('directory') or expected.is_symlink():raise WorkerError('Unexpected installed worker path.')
 for name,sha in value['inventory'].items():
  path=expected/name
  if Path(name).is_absolute() or '..' in Path(name).parts or any(p.is_symlink() for p in [path,*path.parents]):raise WorkerError('Invalid installed worker file.')
  if digest(regular(path,30*1024*1024))!=sha:raise WorkerError('Installed worker changed: '+name+'. Reinstall the reviewed version.')
 return value

def owned_container(root,runner=command):
 name='perla-worker-'+digest(str(root).encode())[:12]
 try:raw=runner(['docker','container','inspect',name])
 except WorkerError:return name,None
 values=json.loads(raw)
 if not isinstance(values,list) or len(values)!=1:raise WorkerError('Unexpected Docker container report.')
 info=values[0]
 if info.get('Config',{}).get('Labels',{}).get('io.perla.installation')!=digest(str(root).encode()):raise WorkerError('Container name belongs to another installation.')
 return name,info

def release_files(release,fetch=download):
 if not re.fullmatch(r'worker-v\d+\.\d+\.\d+',release):raise WorkerError('Select an explicit worker-vX.Y.Z release.')
 base='https://github.com/'+REPO+'/releases/download/'+release+'/'
 metadata=json.loads(fetch('https://api.github.com/repos/'+REPO+'/releases/tags/'+release,2*1024*1024))
 if metadata.get('tag_name')!=release or metadata.get('draft') is not False:raise WorkerError('The selected worker release is not published.')
 assets={a['name']:a for a in metadata.get('assets',[])}
 def asset(name,limit):
  expected=base+name
  if name not in assets or assets[name].get('browser_download_url')!=expected:raise WorkerError('Expected release asset is missing: '+name)
  data=fetch(expected,limit)
  api_digest=assets[name].get('digest')
  if api_digest and api_digest!='sha256:'+digest(data):raise WorkerError('GitHub asset digest differs: '+name)
  return data
 sums=checksums(asset('SHA256SUMS',65536))
 def verified(name,limit):
  data=asset(name,limit)
  if name not in sums or digest(data)!=sums[name]:raise WorkerError('Checksum mismatch: '+name)
  return data
 return sums,verified

def install(root,bin_dir,release,profile,fetch=download,source=None,runner=command):
 if platform.system()!='Linux' or platform.machine() not in ('x86_64','AMD64'):raise WorkerError('This worker release requires Linux x86-64.')
 if not re.fullmatch(r'worker-v\d+\.\d+\.\d+',release):raise WorkerError('Select an explicit worker-vX.Y.Z release.')
 previous=state(root) if (root/'current.json').exists() else None
 if previous:
  if previous['profile']!=profile:raise WorkerError('Use a separate installation directory for another hardware profile.')
  old=tuple(map(int,previous['release'].split('v')[1].split('.')));new=tuple(map(int,release.split('v')[1].split('.')))
  if new<old:raise WorkerError('Automatic downgrade is not supported.')
  if shutil.which('docker'):
   _,container=owned_container(root,runner)
   if container and container.get('State',{}).get('Running'):raise WorkerError('Stop the worker before changing its installed version.')
 sums,verified=release_files(release,fetch)
 manifest=json.loads(verified('worker-release.json',65536))
 if manifest.get('schema')!=1 or manifest.get('repository')!=REPO or manifest.get('tag')!=release or manifest.get('chainId')!=46630 or manifest.get('protocol')!='perla-pearl-plain-v4':raise WorkerError('Release manifest does not match the supported coordinator.')
 selected=manifest.get('profiles',{}).get(profile)
 if not selected or selected.get('archive') not in ('perla-rtx-worker.tar.gz','perla-worker.tar.gz') or selected.get('root') not in ('perla-rtx-worker','perla-worker'):raise WorkerError('Unsupported worker profile manifest.')
 archive=verified(selected['archive'],64*1024*1024)
 code=source if source is not None else regular(Path(__file__).resolve(),2*1024*1024)
 if 'install.py' not in sums or digest(code)!=sums['install.py']:raise WorkerError('Installer program does not match the selected release. Download its install.sh first.')
 launcher=bin_dir/'perla'
 if launcher.exists() or launcher.is_symlink():
  if not previous or str(launcher)!=previous.get('launcher') or digest(regular(launcher))!=previous.get('launcherSha256'):raise WorkerError('An existing perla command was preserved. Choose another --bin-dir.')
 target=directory(root/'versions')/(release+'-'+profile)
 temporary=Path(tempfile.mkdtemp(prefix='.worker-new-',dir=target.parent))
 try:
  inventory=extract(archive,temporary,selected['root'])
  if target.exists():
   if target.is_symlink() or not target.is_dir():raise WorkerError('Unexpected version directory.')
   for name,sha in inventory.items():
    if digest(regular(target/name,30*1024*1024))!=sha:raise WorkerError('Existing version contains different files; it was preserved.')
  else:temporary.rename(target)
 finally:
  if temporary.exists():shutil.rmtree(temporary)
 tool=root/'tools'/('workerctl-'+digest(code)[:16]+'.py');atomic(tool,code,0o700)
 wrapper=('#!/bin/sh\n# Perla managed worker launcher\nexec python3 '+shlex.quote(str(tool))+' --root '+shlex.quote(str(root))+' "$@"\n').encode()
 new={'schema':1,'repository':REPO,'release':release,'profile':profile,'directory':str(target),'inventory':inventory,'archiveSha256':digest(archive),'launcher':str(launcher),'launcherSha256':digest(wrapper),'tool':str(tool),'toolSha256':digest(code),'image':selected['image'],'upstreamCommit':manifest['upstreamCommit']}
 if previous:atomic(root/'previous.json',(json.dumps(previous,indent=2)+'\n').encode())
 old_state=regular(root/'current.json') if previous else None;old_launcher=regular(launcher) if launcher.exists() else None
 try:
  atomic(root/'current.json',(json.dumps(new,indent=2)+'\n').encode());atomic(launcher,wrapper,0o755)
 except OSError:
  if old_state is not None:atomic(root/'current.json',old_state)
  elif (root/'current.json').exists():(root/'current.json').unlink()
  if old_launcher is not None:atomic(launcher,old_launcher,0o755)
  raise
 print('Installed and verified '+release+' ('+profile+'). No mining process was started.')
 print('Command: '+str(launcher));print('Guide: https://perlacompute.xyz/platform/setup')
 print('Next: perla start --wallet YOUR_PUBLIC_0X_ADDRESS --worker rig01 --device 0')
 return new

def upgrade(root,installed,release,fetch=download,runner=command,before_execute=None):
 if not re.fullmatch(r'worker-v\d+\.\d+\.\d+',release):raise WorkerError('Select an explicit worker-vX.Y.Z release.')
 if tuple(map(int,release.split('v')[1].split('.')))<tuple(map(int,installed['release'].split('v')[1].split('.'))):raise WorkerError('Automatic downgrade is not supported.')
 if shutil.which('docker'):
  _,container=owned_container(root,runner)
  if container and container.get('State',{}).get('Running'):raise WorkerError('Stop the worker before changing its installed version.')
 _,verified=release_files(release,fetch);code=verified('install.py',2*1024*1024)
 with tempfile.TemporaryDirectory(prefix='perla-update-') as folder:
  program=Path(folder)/'install.py';program.write_bytes(code);program.chmod(0o600)
  if before_execute:before_execute()
  runner([sys.executable,str(program),'--root',str(root),'install','--release',release,'--profile',installed['profile'],'--bin-dir',str(Path(installed['launcher']).parent)],visible=True)

def configuration(root,file=None):
 path=Path(file) if file else root/'config/worker.env';data=regular(path,16384);values={}
 for line in data.decode().splitlines():
  if not line.strip() or line.lstrip().startswith('#'):continue
  key,sep,value=line.partition('=')
  if not sep or key not in ('PERLA_ENDPOINT','PERLA_WORKER_TOKEN') or key in values:raise WorkerError('Use the worker.env downloaded from the dashboard; only endpoint and worker token are accepted.')
  values[key]=value.strip().strip('\"\'')
 url=urllib.parse.urlsplit(values.get('PERLA_ENDPOINT',''));token=values.get('PERLA_WORKER_TOKEN','')
 if (url.scheme!='https' and not(url.scheme=='http' and url.hostname in ('localhost','127.0.0.1'))) or not url.hostname or url.username or url.password or url.query or url.fragment or url.path.rstrip('/'):raise WorkerError('Worker endpoint must be an HTTPS origin.')
 if not re.fullmatch('[a-f0-9]{64}',token):raise WorkerError('The worker token is invalid. Register a worker in the dashboard.')
 return values

def configure(root,file):
 values=configuration(root,file);path=root/'config/worker.env'
 atomic(path,('PERLA_ENDPOINT='+values['PERLA_ENDPOINT'].rstrip('/')+'\nPERLA_WORKER_TOKEN='+values['PERLA_WORKER_TOKEN']+'\n').encode())
 print('Worker configuration saved privately. Restart a running worker to apply it.')

def doctor(root,installed,device,runner=command):
 checks={};gpus=[]
 for key,args in [('docker',['docker','version','--format','{{.Server.Version}}']),('buildx',['docker','buildx','version']),('nvidia',['nvidia-smi','--query-gpu=index,name,memory.total,compute_cap,driver_version','--format=csv,noheader'])]:
  try:output=runner(args,timeout=20);checks[key]=True
  except WorkerError:output='';checks[key]=False
  if key=='nvidia':
   for line in output.splitlines():
    cells=[c.strip() for c in line.split(',')]
    if len(cells)==5:gpus.append({'index':cells[0],'name':cells[1],'memory':cells[2],'capability':cells[3],'driver':cells[4]})
 allowed=('8.6','8.9','12.0') if installed['profile']=='rtx' else ('9.0',)
 gpu=next((g for g in gpus if g['index']==str(device)),None);checks['supportedSelectedGpu']=bool(gpu and gpu['capability'] in allowed)
 try:runner(['docker','image','inspect',installed['image']],timeout=20);checks['imageBuilt']=True
 except WorkerError:checks['imageBuilt']=False
 try:configuration(root);checks['configuration']=((root/'config/worker.env').stat().st_mode&0o077)==0
 except (WorkerError,OSError):checks['configuration']=False
 ready=all(checks.get(k) for k in ['docker','buildx','nvidia','supportedSelectedGpu'])
 report={'release':installed['release'],'profile':installed['profile'],'selectedDevice':device,'gpus':gpus,'checks':checks,'readyForBuild':ready,'readyForGpuTest':ready and checks['imageBuilt'],'gpuSelfTestPassed':None,'coordinatorContacted':False,'miningStarted':False}
 emit(report);return ready

def runtime(root,installed,args,runner=command):
 profile=installed['profile'];image=installed['image'];cmd=args.command
 if cmd=='build':
  if not doctor(root,installed,args.device,runner):raise WorkerError('Resolve host diagnostics before building this GPU worker.')
  env=dict(os.environ,PERLA_UPSTREAM_DIR=str(root/'build-cache/pearl-upstream'))
  if profile=='hopper':directory(root/'build-cache')
  runner(['bash',str(Path(installed['directory'])/'setup-worker.sh')],visible=True,env=env);return
 if cmd in ('status','logs','stop'):
  name,info=owned_container(root,runner)
  if not info:print('No worker container has been started for this installation.');return
  if cmd=='status':emit({'release':installed['release'],'profile':profile,'container':name,'state':info.get('State',{}).get('Status'),'exitCode':info.get('State',{}).get('ExitCode')})
  elif cmd=='logs':runner(['docker','logs','--tail',str(args.tail),name],visible=True)
  elif info.get('State',{}).get('Running'):runner(['docker','stop','--time','30',name],visible=True)
  else:print('Worker is already stopped.')
  return
 if cmd=='selftest':
  if profile!='rtx':raise WorkerError('The standalone self-test is for RTX. Use the documented Hopper inference validation procedure.')
  runner(['docker','run','--rm','--network','none','--gpus','all','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','256',image,'selftest','--device',str(args.device)],visible=True);return
 if cmd!='start':raise WorkerError('Unknown lifecycle command.')
 configuration(root)
 if (root/'config/worker.env').stat().st_mode&0o077:raise WorkerError('Worker configuration must have private permissions.')
 if not doctor(root,installed,args.device,runner):raise WorkerError('Resolve host diagnostics before starting.')
 runner(['docker','image','inspect',image],timeout=20)
 if profile=='hopper' and not args.model:raise WorkerError('Hopper start requires --model and hardware/model validation from the website guide.')
 name,info=owned_container(root,runner)
 if info and info.get('State',{}).get('Running'):raise WorkerError('This worker is already running. Inspect perla status or perla logs.')
 if info:
  logs=runner(['docker','logs','--tail','5000',name]);atomic(root/'logs'/('worker-'+str(time.time_ns())+'.log'),logs.encode());runner(['docker','container','rm',name])
 base=['docker','run','--detach','--name',name,'--label','io.perla.installation='+digest(str(root).encode()),'--restart','no','--gpus','all','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','512','--env-file',str(root/'config/worker.env')]
 if profile=='rtx':base += [image,'run','--device',str(args.device),'--shares',str(args.shares),'--interval',str(args.interval)]
 else:
  cache=directory(root/'cache/huggingface');base += ['--shm-size','8g','--publish','127.0.0.1:8000:8000','--volume',str(cache)+':/root/.cache/huggingface',image,args.model,'--host','0.0.0.0','--port','8000','--tensor-parallel-size',str(args.tensor_parallel_size)]
 runner(base,visible=True)
 print('Worker container started. Inspect perla status and perla logs for its actual result.')
 if profile=='rtx':print('The worker repeats GPU checks before requesting jobs and stops after '+str(args.shares)+' accepted share(s). Paused admission or a failed check can stop it earlier.')

def parser():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--root',type=Path,default=Path(os.environ.get('XDG_DATA_HOME',str(Path.home()/'.local/share')))/'perla')
 sub=p.add_subparsers(dest='command',required=True)
 i=sub.add_parser('install');i.add_argument('--root',dest='install_root',type=Path);i.add_argument('--release',default=DEFAULT_RELEASE);i.add_argument('--profile',choices=['rtx','hopper'],default='rtx');i.add_argument('--bin-dir',type=Path,default=Path(os.environ.get('XDG_BIN_HOME',str(Path.home()/'.local/bin'))))
 u=sub.add_parser('update');u.add_argument('--release',required=True)
 c=sub.add_parser('configure');c.add_argument('--file',required=True,type=Path)
 for cmd in ['doctor','build','selftest','start']:
  s=sub.add_parser(cmd);s.add_argument('--device',type=int,default=0)
  if cmd=='start':
   s.add_argument('--shares',type=int,default=1,help='Accepted shares before stopping; this validation release defaults to 1')
   s.add_argument('--interval',type=float,default=10);s.add_argument('--model');s.add_argument('--tensor-parallel-size',type=int,default=2)
   s.add_argument('--wallet',help='Public EVM reward address; never a private key');s.add_argument('--worker',help='Rig name, for example rig01');s.add_argument('--endpoint',help='HTTPS coordinator origin')
 sub.add_parser('status');sub.add_parser('stop');l=sub.add_parser('logs');l.add_argument('--tail',type=int,default=100);sub.add_parser('version')
 login=sub.add_parser('login');login.add_argument('--name');login.add_argument('--endpoint',default='https://perlacompute.xyz')
 upload=sub.add_parser('upload-validation');upload.add_argument('--file',required=True)
 return p

def main(argv=None):
 p=parser();args=p.parse_args(argv)
 if getattr(args,'device',0)<0 or getattr(args,'shares',1)<1 or not 5<=getattr(args,'interval',10)<=3600 or not 1<=getattr(args,'tensor_parallel_size',2)<=16 or not 1<=getattr(args,'tail',100)<=5000:p.error('Device, share count, interval, tensor parallel size or log bound is invalid.')
 root=directory(getattr(args,'install_root',None) or args.root)
 if (root/'worker.lock').is_symlink():raise WorkerError('Use a regular installation lock file.')
 with (root/'worker.lock').open('a') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  if args.command=='install':install(root,directory(args.bin_dir),args.release,args.profile);return
  installed=state(root)
  if digest(regular(Path(installed['tool']),2*1024*1024))!=installed['toolSha256']:raise WorkerError('The installed CLI program changed.')
  import importlib.util
  helper=Path(installed['directory'])/'worker_session.py'
  if helper.is_file() and args.command in ('login','upload-validation','doctor','build','selftest','start'):
   spec=importlib.util.spec_from_file_location('perla_worker_session',helper);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
   try:
    if module.dispatch(root,installed,args,__import__('types').SimpleNamespace(WorkerError=WorkerError,atomic=atomic,regular=regular,configuration=configuration,command=command)):return
   except RuntimeError as error:raise WorkerError(str(error)) from None
  if args.command=='version':emit({k:installed[k] for k in ['release','profile','image','upstreamCommit']})
  elif args.command=='update':upgrade(root,installed,args.release,before_execute=lambda:fcntl.flock(lock,fcntl.LOCK_UN))
  elif args.command=='configure':configure(root,args.file)
  elif args.command=='doctor':
   if not doctor(root,installed,args.device):raise WorkerError('Host diagnostics need attention; no mining process was started.')
  else:runtime(root,installed,args)
if __name__=='__main__':
 os.umask(0o077)
 try:main()
 except (WorkerError,OSError,ValueError,KeyError,tarfile.TarError) as error:
  print(str(error) if isinstance(error,WorkerError) else 'Worker operation stopped. Check installation files, permissions, dependencies and release availability.',file=sys.stderr);raise SystemExit(1)
