import contextlib,importlib.util,io,json,tempfile,types,unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[2]
def module(name,path):
 spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
s=module('reuse_session',ROOT/'scripts/worker-session.py');cli=module('reuse_cli',ROOT/'scripts/perla-worker.py')
ID='8683902e-dc8c-40ba-9eb3-5ac2293e243b';TOKEN='c'*64;CODE='A'*12;ADDRESS='0x'+'1'*40
class ReconnectTests(unittest.TestCase):
 def setUp(self):self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);self.args=types.SimpleNamespace(worker_id=ID,wallet=None,worker=None,endpoint=None)
 def tearDown(self):self.tmp.cleanup()
 def pending(self):return {'state':'pending','workerId':ID,'userCode':CODE,'verificationUrl':s.ENDPOINT+'/platform/reconnect?code='+CODE,'expires':10**12}
 def connected(self):return {'state':'connected','id':ID,'name':'testing','address':ADDRESS,'endpoint':s.ENDPOINT,'protocol':'perla-pearl-plain-v4'}
 def start(self,responses):
  out=io.StringIO()
  with patch.object(s.secrets,'token_hex',side_effect=lambda n:'c'*64 if n==32 else 'a'*12),patch.object(s,'call',side_effect=responses) as request,patch.object(s.time,'sleep'),contextlib.redirect_stdout(out):s.connect(self.root,self.args,cli)
  return out.getvalue(),request
 def install_old(self,id=ID):
  cli.atomic(self.root/'config/worker.env',('PERLA_ENDPOINT='+s.ENDPOINT+'\nPERLA_WORKER_TOKEN='+'b'*64+'\n').encode())
  cli.atomic(self.root/'config/connection.json',(json.dumps({'id':id,'address':ADDRESS,'name':'testing','endpoint':s.ENDPOINT})+'\n').encode())
 def test_start_accepts_existing_id_without_new_wallet_or_name(self):
  args=cli.parser().parse_args(['start','--worker-id',ID,'--device','0']);self.assertEqual(args.worker_id,ID);self.assertIsNone(args.wallet);self.assertIsNone(args.worker)
 def test_owner_approved_transfer_keeps_id_and_never_prints_the_credential(self):
  out,request=self.start([self.pending(),{'state':'pending'},self.connected()]);self.assertIn(ID,out);self.assertIn(CODE,out);self.assertNotIn(TOKEN,out);self.assertIn('owner wallet',out)
  self.assertEqual(cli.configuration(self.root)['PERLA_WORKER_TOKEN'],TOKEN);self.assertEqual(json.loads((self.root/'config/connection.json').read_text())['id'],ID);self.assertEqual((self.root/'config/worker.env').stat().st_mode&0o077,0);self.assertFalse((self.root/'config/pending-reconnect.json').exists())
  self.assertEqual(request.call_args.args[2],TOKEN)
 def test_lost_start_response_retains_pending_credential_for_retry(self):
  with self.assertRaises(RuntimeError):self.start([RuntimeError('network unavailable')])
  path=self.root/'config/pending-reconnect.json';saved=json.loads(path.read_text());self.assertEqual(path.stat().st_mode&0o077,0)
  out,request=self.start([self.pending(),self.connected()]);self.assertEqual(request.call_args_list[0].args[2],saved['token']);self.assertEqual(cli.configuration(self.root)['PERLA_WORKER_TOKEN'],saved['token'])
 def test_lost_final_response_can_recover_the_rotated_identity(self):
  with self.assertRaises(RuntimeError):self.start([self.pending(),RuntimeError('response lost')])
  out,request=self.start([self.connected()]);self.assertEqual(len(request.call_args_list),1);self.assertEqual(json.loads((self.root/'config/connection.json').read_text())['id'],ID)
 def test_failed_final_file_write_retains_the_pending_credential(self):
  original=cli.atomic
  def write(path,data):
   if path.name=='worker.env':raise OSError('disk fixture')
   return original(path,data)
  with patch.object(cli,'atomic',side_effect=write):
   with self.assertRaises(OSError):self.start([self.connected()])
  self.assertTrue((self.root/'config/pending-reconnect.json').exists());self.start([self.connected()]);self.assertEqual(cli.configuration(self.root)['PERLA_WORKER_TOKEN'],TOKEN)
 def test_same_machine_uses_current_credential_without_a_new_approval(self):
  self.install_old();out,request=self.start([self.connected()]);self.assertEqual(request.call_args.args[0],'worker/status');self.assertEqual(cli.configuration(self.root)['PERLA_WORKER_TOKEN'],'b'*64);self.assertIn('Reusing permanent Worker ID',out)
 def test_returning_to_an_old_machine_can_authorize_a_fresh_credential(self):
  self.install_old();self.start([s.CoordinatorError('revoked',401),self.pending(),self.connected()]);self.assertEqual(cli.configuration(self.root)['PERLA_WORKER_TOKEN'],TOKEN)
 def test_another_saved_identity_is_retained(self):
  self.install_old();before=(self.root/'config/worker.env').read_bytes()
  with self.assertRaisesRegex(RuntimeError,'another Worker ID'):self.start([{**self.connected(),'id':'a'*36}])
  self.assertEqual((self.root/'config/worker.env').read_bytes(),before)
 def test_reconnect_never_silently_changes_payout_flags(self):
  self.args.wallet=ADDRESS
  with patch.object(s,'call') as request:
   with self.assertRaisesRegex(RuntimeError,'without --wallet'):s.connect(self.root,self.args,cli)
   request.assert_not_called()
 def test_unknown_redirect_origin_is_rejected_without_writing_a_connection(self):
  with self.assertRaisesRegex(RuntimeError,'does not match'):self.start([{**self.pending(),'verificationUrl':'https://evil.test'}])
  self.assertFalse((self.root/'config/worker.env').exists())
 def test_expired_poll_clears_only_its_pending_request_for_same_command_retry(self):
  with self.assertRaisesRegex(RuntimeError,'same command'):self.start([self.pending(),s.CoordinatorError('expired',410)])
  self.assertFalse((self.root/'config/pending-reconnect.json').exists());self.assertFalse((self.root/'config/worker.env').exists())
 def test_malformed_id_is_rejected_before_network_or_registration(self):
  for id in ['testing',ID+';id','--flag',ID+'\n']:
   self.args.worker_id=id
   with patch.object(s,'call') as request:
    with self.assertRaises(RuntimeError):s.connect(self.root,self.args,cli)
    request.assert_not_called()
if __name__=='__main__':unittest.main()
