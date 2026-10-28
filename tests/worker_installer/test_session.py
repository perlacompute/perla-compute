import contextlib,importlib.util,io,json,tempfile,types,unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[2]
def module(name,file):
 spec=importlib.util.spec_from_file_location(name,file);value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value
s=module('session',ROOT/'scripts/worker-session.py');w=module('controller',ROOT/'scripts/perla-worker.py')
class SessionTests(unittest.TestCase):
 def setUp(self):self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);self.installed={'profile':'rtx','directory':str(self.root/'version'),'image':'test-image'}
 def tearDown(self):self.tmp.cleanup()
 def test_browser_pairing_saves_private_credential_without_printing_it(self):
  pair={'deviceSecret':'d'*64,'userCode':'ABC123ABC123','verificationUrl':s.ENDPOINT+'/platform/setup?pair=ABC123ABC123','expires':10**12}
  result={'state':'connected','id':'fixture-worker','token':'a'*64,'address':'0x'+'1'*40,'name':'fixture','endpoint':s.ENDPOINT,'protocol':'perla-pearl-plain-v4'}
  out=io.StringIO()
  with patch.object(s,'call',side_effect=[pair,{'state':'pending'},result]),patch.object(s.time,'sleep'),contextlib.redirect_stdout(out):s.login(self.root,self.installed,w)
  self.assertEqual(w.configuration(self.root)['PERLA_WORKER_TOKEN'],'a'*64);self.assertEqual((self.root/'config/worker.env').stat().st_mode&0o077,0)
  self.assertNotIn('a'*64,out.getvalue());self.assertNotIn('d'*64,out.getvalue());self.assertIn('ABC123ABC123',out.getvalue())
 def test_pairing_cannot_redirect_the_user_to_another_origin(self):
  with patch.object(s,'call',return_value={'deviceSecret':'a'*64,'userCode':'A'*12,'verificationUrl':'https://evil.test','expires':10**12}):
   with self.assertRaises(RuntimeError):s.login(self.root,self.installed,w)
  self.assertFalse((self.root/'config/worker.env').exists())
 def test_report_upload_uses_worker_credential_only_as_authorization(self):
  w.atomic(self.root/'config/worker.env',('PERLA_ENDPOINT='+s.ENDPOINT+'\nPERLA_WORKER_TOKEN='+'a'*64+'\n').encode())
  report={'gpuSelfTestPassed':True};out=io.StringIO()
  with patch.object(s,'call',return_value={'workerId':'test-worker'}) as request,contextlib.redirect_stdout(out):s.upload(self.root,report,w)
  self.assertEqual(request.call_args.args[1],{'report':report});self.assertEqual(request.call_args.args[2],'a'*64);self.assertNotIn('a'*64,out.getvalue())
 def test_native_is_selected_when_docker_cannot_be_reached(self):
  calls=[]
  def command(args,**kwargs):
   calls.append(args)
   if args[0]=='docker':raise w.WorkerError('Unavailable')
   return ''
  cli=types.SimpleNamespace(command=command,WorkerError=w.WorkerError)
  args=types.SimpleNamespace(command='doctor',device=0)
  self.assertTrue(s.dispatch(self.root,self.installed,args,cli));self.assertIn('native_worker.py',' '.join(calls[-1]));self.assertIn('doctor',calls[-1])
 def test_paused_start_uploads_valid_report_and_never_requests_work(self):
  w.atomic(self.root/'config/worker.env',('PERLA_ENDPOINT='+s.ENDPOINT+'\nPERLA_WORKER_TOKEN='+'a'*64+'\n').encode())
  calls=[]
  def command(args,**kwargs):
   calls.append(args)
   if args[0]=='docker':raise w.WorkerError('No Docker')
   if 'selftest' in args:return json.dumps({'gpuSelfTestPassed':True,'protocol':'perla-pearl-plain-v4'})
   return ''
  cli=types.SimpleNamespace(command=command,WorkerError=w.WorkerError,atomic=w.atomic,configuration=w.configuration)
  args=types.SimpleNamespace(command='start',device=0,shares=1,interval=10)
  with patch.object(s,'call',return_value={'policy':{'miningEnabled':False},'trial':None}),patch.object(s,'upload') as upload,contextlib.redirect_stdout(io.StringIO()):
   self.assertTrue(s.dispatch(self.root,self.installed,args,cli));upload.assert_called_once()
  self.assertFalse(any('run' in args for args in calls));self.assertTrue((self.root/'reports/latest-gpu.json').is_file())
 def test_https_and_plain_origin_are_required_before_any_request(self):
  for endpoint in ['http://perla.test','https://user:key@perla.test','https://perla.test/path']:
   with self.assertRaises(RuntimeError):s.call('pairing/start',{},endpoint=endpoint)
 def connect_args(self,**changes):
  return types.SimpleNamespace(wallet='0x'+'1'*40,worker='home-4090',endpoint=None,**changes)
 def connection_response(self):
  return {'state':'connected','id':'public-worker','address':'0x'+'1'*40,'name':'home-4090','endpoint':s.ENDPOINT,'protocol':'perla-pearl-plain-v4'}
 def test_public_wallet_and_name_need_no_browser_or_private_key(self):
  output=io.StringIO()
  with patch.object(s,'call',return_value=self.connection_response()) as request,patch.object(s.secrets,'token_hex',return_value='e'*64),contextlib.redirect_stdout(output):s.connect(self.root,self.connect_args(),w)
  self.assertEqual(request.call_args.args,('worker/connect',{'wallet':'0x'+'1'*40,'name':'home-4090'},'e'*64,s.ENDPOINT))
  self.assertEqual(w.configuration(self.root)['PERLA_WORKER_TOKEN'],'e'*64);self.assertNotIn('e'*64,output.getvalue())
  self.assertFalse((self.root/'config/pending-connection.json').exists());self.assertEqual((self.root/'config/worker.env').stat().st_mode&0o077,0)
 def test_lost_connection_response_reuses_credential_and_identity(self):
  with patch.object(s,'call',side_effect=RuntimeError('unreachable')),contextlib.redirect_stdout(io.StringIO()):
   with self.assertRaises(RuntimeError):s.connect(self.root,self.connect_args(),w)
  pending=json.loads((self.root/'config/pending-connection.json').read_text());self.assertEqual((self.root/'config/pending-connection.json').stat().st_mode&0o077,0)
  with patch.object(s,'call',return_value=self.connection_response()) as request,contextlib.redirect_stdout(io.StringIO()):s.connect(self.root,self.connect_args(),w)
  self.assertEqual(request.call_args.args[2],pending['token'])
 def test_connection_response_cannot_silently_change_payout(self):
  response={**self.connection_response(),'address':'0x'+'2'*40}
  with patch.object(s,'call',return_value=response):
   with self.assertRaisesRegex(RuntimeError,'payout'):s.connect(self.root,self.connect_args(),w)
  self.assertFalse((self.root/'config/worker.env').exists())
 def test_existing_connection_rejects_wallet_or_name_changes(self):
  w.atomic(self.root/'config/worker.env',('PERLA_ENDPOINT='+s.ENDPOINT+'\nPERLA_WORKER_TOKEN='+'a'*64+'\n').encode())
  original=(self.root/'config/worker.env').read_bytes()
  args=self.connect_args();args.wallet='0x'+'2'*40
  with patch.object(s,'call',return_value=self.connection_response()):
   with self.assertRaisesRegex(RuntimeError,'retained'):s.connect(self.root,args,w)
  self.assertEqual((self.root/'config/worker.env').read_bytes(),original)
 def test_unsafe_names_and_zero_wallet_are_rejected_before_registration(self):
  for name in ['rig01; touch /tmp/unsafe','$(whoami)','x\ny','--bad','..']:
   args=self.connect_args();args.worker=name
   with patch.object(s,'call') as request,patch.object(s.sys.stdin,'isatty',return_value=False):
    with self.assertRaises(RuntimeError):s.connect(self.root,args,w)
    request.assert_not_called()
  args=self.connect_args();args.wallet='0x'+'0'*40
  with patch.object(s,'call') as request:
   with self.assertRaises(RuntimeError):s.connect(self.root,args,w)
   request.assert_not_called()
 def test_start_flags_are_available_in_installed_cli(self):
  args=w.parser().parse_args(['start','--wallet','0x'+'1'*40,'--worker','rig01','--device','0'])
  self.assertEqual(args.worker,'rig01');self.assertEqual(args.wallet,'0x'+'1'*40)
