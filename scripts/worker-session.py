"""Device pairing, automatic report upload, and environment-aware worker execution."""
import json,os,socket,time,urllib.error,urllib.parse,urllib.request,uuid
from pathlib import Path

ENDPOINT='https://perlacompute.xyz'
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args):return None

def call(path,payload=None,token=None,endpoint=ENDPOINT):
 u=urllib.parse.urlsplit(endpoint)
 if u.scheme!='https' or u.username or u.password or not u.hostname or u.query or u.fragment or u.path.rstrip('/'):
  raise RuntimeError('Use an HTTPS coordinator origin.')
 headers={'content-type':'application/json','User-Agent':'Perla-Worker/0.6.0'}
 if token:headers['authorization']='Bearer '+token
 request=urllib.request.Request(endpoint.rstrip('/')+'/api/mining/'+path,data=None if payload is None else json.dumps(payload).encode(),headers=headers)
 try:
  with urllib.request.build_opener(NoRedirect()).open(request,timeout=35) as r:return json.loads(r.read(20000))
 except urllib.error.HTTPError as e:
  try:message=json.loads(e.read(12000)).get('error','Coordinator request failed')
  except (ValueError,AttributeError):message='Coordinator request failed'
  raise RuntimeError(str(message).replace(token or '__no_token__','[redacted]')) from None
 except (urllib.error.URLError,TimeoutError):raise RuntimeError('Coordinator unreachable; your local installation was retained.') from None

def login(root,installed,cli,name=None,endpoint=ENDPOINT):
 pair=call('pairing/start',{'name':name or socket.gethostname()[:48]},endpoint=endpoint)
 secret=pair['deviceSecret'];code=pair['userCode']
 expected=endpoint.rstrip('/')+'/platform/setup?pair='+code
 if pair.get('verificationUrl')!=expected or not isinstance(secret,str) or len(secret)!=64:
  raise RuntimeError('Unexpected pairing response.')
 print('Open this URL in your wallet browser:\n'+expected+'\nConfirm code: '+code+'\nWaiting for wallet approval…',flush=True)
 deadline=min(time.time()+600,pair['expires'])
 while time.time()<deadline:
  time.sleep(5)
  value=call('pairing/exchange',{},secret,endpoint)
  if value.get('state')=='pending':continue
  if value.get('state')!='connected' or value.get('protocol')!='perla-pearl-plain-v4' or value.get('endpoint')!=endpoint:
   raise RuntimeError('Pairing response does not match the coordinator.')
  import re
  token=value.get('token','')
  if not re.fullmatch('[a-f0-9]{64}',token):raise RuntimeError('Invalid worker credential response.')
  cli.atomic(root/'config/worker.env',('PERLA_ENDPOINT='+endpoint+'\nPERLA_WORKER_TOKEN='+token+'\n').encode())
  cli.atomic(root/'config/connection.json',(json.dumps({k:value[k] for k in ['id','address','name','endpoint']})+'\n').encode())
  print('Worker connected to '+value['address']+'. Credentials saved privately on this host.',flush=True)
  return value
 raise RuntimeError('Pairing expired. Run perla login again.')

def upload(root,report,cli):
 config=cli.configuration(root)
 result=call('worker/validation',{'report':report},config['PERLA_WORKER_TOKEN'],config['PERLA_ENDPOINT'])
 print('GPU report uploaded automatically. Worker '+result['workerId']+'; no mining credit created.',flush=True)
 return result

def dispatch(root,installed,args,cli):
 if args.command=='login':
  login(root,installed,cli,args.name,args.endpoint);return True
 if args.command=='upload-validation':
  report=json.loads(cli.regular(Path(args.file),10000));upload(root,report,cli);return True
 if installed['profile']!='rtx' or args.command not in ('doctor','build','selftest','start'):return False
 try:cli.command(['docker','version','--format','{{.Server.Version}}'],timeout=5);native=False
 except cli.WorkerError:native=True
 directory=Path(installed['directory'])
 helper=['python3',str(directory/'native_worker.py'),'--root',str(root)]
 if args.command=='doctor' and native:
  cli.command(helper+['doctor','--device',str(args.device)],visible=True);return True
 if args.command=='build' and native:
  cli.command(helper+['build','--device',str(args.device)],visible=True);return True
 if args.command not in ('selftest','start'):return False
 if args.command=='start' and not (root/'config/worker.env').exists():login(root,installed,cli)
 if native:
  cli.command(helper+['build','--device',str(args.device)],visible=True)
  output=cli.command(helper+['selftest','--device',str(args.device)])
 else:
  try:cli.command(['docker','image','inspect',installed['image']],timeout=20)
  except cli.WorkerError:cli.command(['bash',str(directory/'setup-worker.sh')],visible=True)
  output=cli.command(['docker','run','--rm','--network','none','--gpus','all','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','256',installed['image'],'selftest','--device',str(args.device)])
 report=json.loads(output)
 if report.get('gpuSelfTestPassed') is not True or report.get('protocol')!='perla-pearl-plain-v4':raise RuntimeError('A passing GPU self-test is required.')
 cli.atomic(root/'reports/latest-gpu.json',(json.dumps(report,indent=2)+'\n').encode())
 print(json.dumps(report,indent=2),flush=True)
 if (root/'config/worker.env').exists():upload(root,report,cli)
 else:print('Report saved locally. Run perla login, then perla upload-validation --file '+str(root/'reports/latest-gpu.json'),flush=True)
 if args.command=='selftest':return True
 config=cli.configuration(root);status=call('worker/status',token=config['PERLA_WORKER_TOKEN'],endpoint=config['PERLA_ENDPOINT'])
 if not status.get('policy',{}).get('miningEnabled') and not status.get('trial'):
  print('Worker ready. Your report is on the server; mining admission is paused. No work was requested.',flush=True);return True
 if native:
  cli.command(helper+['run','--device',str(args.device),'--shares',str(args.shares),'--interval',str(args.interval)],visible=True);return True
 return False
