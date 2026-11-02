import contextlib,importlib.util,io,json,tempfile,types,unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[2]
def module(name,file):
 spec=importlib.util.spec_from_file_location(name,file);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
s=module('fresh_session',ROOT/'scripts/worker-session.py');w=module('fresh_cli',ROOT/'scripts/perla-worker.py')
class FreshConnectionTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
  w.atomic(self.root/'config/worker.env',('PERLA_ENDPOINT='+s.ENDPOINT+'\nPERLA_WORKER_TOKEN='+'a'*64+'\n').encode())
  self.old=(self.root/'config/worker.env').read_bytes();self.args=types.SimpleNamespace(new_worker=True,worker_id=None,wallet='0x'+'1'*40,worker='new-rig',endpoint=None)
  self.response={'state':'connected','id':'new-id','address':self.args.wallet,'name':'new-rig','endpoint':s.ENDPOINT,'protocol':'perla-pearl-plain-v4'}
 def tearDown(self):self.tmp.cleanup()
 def test_invalid_fresh_wallet_cannot_destroy_the_old_connection(self):
  self.args.wallet='0x'+'0'*40
  with self.assertRaises(RuntimeError):s.connect(self.root,self.args,w)
  self.assertEqual((self.root/'config/worker.env').read_bytes(),self.old)
 def test_fresh_success_replaces_only_connection_and_clears_stale_reconnect(self):
  w.atomic(self.root/'config/pending-reconnect.json',b'{"old":true}');cache=self.root/'cuda-cache/proof.so';cache.parent.mkdir();cache.write_bytes(b'unchanged-verified-core')
  output=io.StringIO()
  with patch.object(w.shutil,'which',return_value=None),patch.object(s,'call',return_value=self.response),contextlib.redirect_stdout(output):s.connect(self.root,self.args,w)
  self.assertNotEqual((self.root/'config/worker.env').read_bytes(),self.old);self.assertFalse((self.root/'config/pending-reconnect.json').exists());self.assertEqual(cache.read_bytes(),b'unchanged-verified-core')
  token=w.configuration(self.root)['PERLA_WORKER_TOKEN'];self.assertNotIn(token,output.getvalue())
 def test_failed_registration_preserves_original_and_retries_same_pending_credential(self):
  with patch.object(w.shutil,'which',return_value=None),patch.object(s,'call',side_effect=RuntimeError('unreachable')):
   with self.assertRaises(RuntimeError):s.connect(self.root,self.args,w)
  self.assertEqual((self.root/'config/worker.env').read_bytes(),self.old)
  pending=json.loads((self.root/'config/pending-new-connection.json').read_text())
  with patch.object(w.shutil,'which',return_value=None),patch.object(s,'call',return_value=self.response) as request,contextlib.redirect_stdout(io.StringIO()):s.connect(self.root,self.args,w)
  self.assertEqual(request.call_args.args[2],pending['token'])
 def test_new_identity_refuses_a_running_docker_worker(self):
  with patch.object(w.shutil,'which',return_value='/usr/bin/docker'),patch.object(w,'owned_container',return_value=('name',{'State':{'Running':True}})),patch.object(s,'call') as call:
   with self.assertRaisesRegex(RuntimeError,'Stop the running'):s.connect(self.root,self.args,w)
   call.assert_not_called()
 def test_reuse_and_new_identity_flags_cannot_be_combined(self):
  self.args.worker_id='old-id'
  with self.assertRaises(RuntimeError):s.connect(self.root,self.args,w)
  self.assertEqual((self.root/'config/worker.env').read_bytes(),self.old)
 def test_expired_saved_credential_gets_reset_recovery_guidance_before_gpu_work(self):
  self.args.new_worker=False;self.args.wallet=None;self.args.worker=None
  with patch.object(s,'call',side_effect=s.CoordinatorError('invalid',401)):
   with self.assertRaisesRegex(RuntimeError,'--new-worker'):s.connect(self.root,self.args,w)
  self.assertEqual((self.root/'config/worker.env').read_bytes(),self.old)
 def test_parser_supports_new_identity_and_continuous_default(self):
  args=w.parser().parse_args(['start','--new-worker','--wallet',self.args.wallet,'--worker','rig01'])
  self.assertTrue(args.new_worker);self.assertEqual(args.shares,0);self.assertEqual(args.device,0)
