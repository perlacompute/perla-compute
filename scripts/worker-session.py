"""Wallet-and-name miner setup, report upload, and environment-aware execution."""
import json,os,re,secrets,socket,sys,time,urllib.error,urllib.parse,urllib.request,uuid
from pathlib import Path

ENDPOINT='https://perlacompute.xyz'
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args):return None

def call(path,payload=None,token=None,endpoint=ENDPOINT):
 u=urllib.parse.urlsplit(endpoint)
 if u.scheme!='https' or u.username or u.password or not u.hostname or u.query or u.fragment or u.path.rstrip('/'):
  raise RuntimeError('Use an HTTPS coordinator origin.')
 headers={'content-type':'application/json','User-Agent':'Perla-Worker/0.7.0'}
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

def connect(root,args,cli):
 """Payout routing only. Never requests a wallet key, signature, or browser login."""
 config_path=root/'config/worker.env'
 wallet=getattr(args,'wallet',None);name=getattr(args,'worker',None)
 endpoint=getattr(args,'endpoint',None) or ENDPOINT
 if config_path.exists():
  config=cli.configuration(root)
  if getattr(args,'endpoint',None) and endpoint!=config['PERLA_ENDPOINT']:
   raise RuntimeError('An existing worker uses another coordinator. Use a separate --root installation.')
  if wallet or name:
   current=call('worker/status',token=config['PERLA_WORKER_TOKEN'],endpoint=config['PERLA_ENDPOINT'])
   if (wallet and wallet.lower()!=current.get('address')) or (name and name!=current.get('name')):
    raise RuntimeError('Wallet or worker name differs from the saved connection. Existing payout settings were retained. Use a separate --root installation for another rig.')
  return
 pending_path=root/'config/pending-connection.json'
 pending=json.loads(cli.regular(pending_path,4000)) if pending_path.exists() else None
 if pending:
  if (wallet and wallet.lower()!=pending['address']) or (name and name!=pending['name']) or endpoint!=pending['endpoint']:
   raise RuntimeError('A previous connection is pending with different payout settings. Retry those settings or use a separate --root installation.')
  wallet,name,endpoint=pending['address'],pending['name'],pending['endpoint']
 else:
  if not wallet and sys.stdin.isatty():wallet=input('Reward wallet (public 0x address): ').strip()
  if not wallet or not re.fullmatch(r'0x[0-9a-fA-F]{40}',wallet) or int(wallet[2:],16)==0:
   raise RuntimeError('Use perla start --wallet YOUR_PUBLIC_0X_ADDRESS --worker rig01. No private key is required.')
  if not name:
   default=re.sub(r'[^A-Za-z0-9._-]','-',socket.gethostname())[:48] or 'rig01'
   if not re.match('[A-Za-z0-9]',default):default=('rig-'+default)[:48]
   name=(input('Worker name ['+default+']: ').strip() or default) if sys.stdin.isatty() else default
  if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,47}',name) or not re.search(r'[A-Za-z0-9]',name):
   raise RuntimeError('Worker names use 1–48 letters, digits, dots, underscores or hyphens.')
  pending={'address':wallet.lower(),'name':name,'endpoint':endpoint,'token':secrets.token_hex(32)}
  cli.atomic(pending_path,(json.dumps(pending)+'\n').encode())
 result=call('worker/connect',{'wallet':pending['address'],'name':pending['name']},pending['token'],endpoint)
 if result.get('state')!='connected' or result.get('address')!=pending['address'] or result.get('name')!=pending['name'] or result.get('endpoint')!=endpoint or result.get('protocol')!='perla-pearl-plain-v4' or not isinstance(result.get('id'),str):
  raise RuntimeError('Connection response does not match your payout settings. Local credentials were retained for recovery.')
 cli.atomic(config_path,('PERLA_ENDPOINT='+endpoint+'\nPERLA_WORKER_TOKEN='+pending['token']+'\n').encode())
 cli.atomic(root/'config/connection.json',(json.dumps({k:result[k] for k in ['id','address','name','endpoint']})+'\n').encode())
 pending_path.unlink()
 print('Worker: '+name+'\nReward wallet: '+pending['address']+'\nConnection saved privately. View this wallet in the Perla dashboard.',flush=True)

def dispatch(root,installed,args,cli):
 if args.command=='login':
  login(root,installed,cli,args.name,args.endpoint);return True
 if args.command=='upload-validation':
  report=json.loads(cli.regular(Path(args.file),10000));upload(root,report,cli);return True
 if args.command=='start':connect(root,args,cli)
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
 if args.command=='selftest':print(json.dumps(report,indent=2),flush=True)
 else:print('GPU checks passed: '+str(report.get('device',{}).get('name','selected NVIDIA GPU'))+'. Report saved automatically.',flush=True)
 if (root/'config/worker.env').exists():upload(root,report,cli)
 else:print('GPU checks passed. Run perla start --wallet YOUR_PUBLIC_0X_ADDRESS --worker rig01 to connect and upload automatically.',flush=True)
 if args.command=='selftest':return True
 config=cli.configuration(root);status=call('worker/status',token=config['PERLA_WORKER_TOKEN'],endpoint=config['PERLA_ENDPOINT'])
 if not status.get('policy',{}).get('miningEnabled') and not status.get('trial'):
  print('Worker ready. Your report is on the server; mining admission is paused. No work was requested.',flush=True);return True
 if native:
  cli.command(helper+['run','--device',str(args.device),'--shares',str(args.shares),'--interval',str(args.interval)],visible=True);return True
 return False
