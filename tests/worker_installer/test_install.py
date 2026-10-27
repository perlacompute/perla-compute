import argparse,contextlib,copy,hashlib,importlib.util,io,json,os,subprocess,tarfile,tempfile,unittest
from pathlib import Path
from unittest import mock
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('worker_installer',ROOT/'scripts/perla-worker.py');w=importlib.util.module_from_spec(spec);spec.loader.exec_module(w)
class InstallerTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.artifacts=tempfile.TemporaryDirectory();subprocess.run(['python3',str(ROOT/'scripts/package-worker-release.py'),'--output',cls.artifacts.name,'--tag',w.DEFAULT_RELEASE],check=True,capture_output=True)
  cls.files={p.name:p.read_bytes() for p in Path(cls.artifacts.name).iterdir()}
 @classmethod
 def tearDownClass(cls):cls.artifacts.cleanup()
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)/'state';self.bin=Path(self.tmp.name)/'bin';self.root.mkdir();self.bin.mkdir();self.data=dict(self.files);self.calls=[]
 def tearDown(self):self.tmp.cleanup()
 def fetch(self,url,limit):
  if url.startswith('https://api.github.com/'):
   base='https://github.com/'+w.REPO+'/releases/download/'+w.DEFAULT_RELEASE+'/'
   return json.dumps({'tag_name':w.DEFAULT_RELEASE,'draft':False,'prerelease':True,'assets':[{'name':n,'browser_download_url':base+n,'digest':'sha256:'+w.digest(v)} for n,v in self.data.items()]}).encode()
  return self.data[url.rsplit('/',1)[1]]
 def runner(self,args,**kwargs):
  self.calls.append(args)
  if args[:3]==['docker','container','inspect']:raise w.WorkerError('No container')
  if args[0]=='nvidia-smi':return '0, NVIDIA GeForce RTX 5090, 32768 MiB, 12.0, 580.0\n1, NVIDIA H100, 81920 MiB, 9.0, 580.0'
  return ''
 def install(self,profile='rtx',fetch=None):
  with contextlib.redirect_stdout(io.StringIO()),mock.patch.object(w.shutil,'which',return_value=None):return w.install(self.root,self.bin,w.DEFAULT_RELEASE,profile,fetch or self.fetch,self.data['install.py'],self.runner)
 def config(self):
  p=Path(self.tmp.name)/'worker.env';p.write_text('PERLA_ENDPOINT=https://perlacompute.xyz\nPERLA_WORKER_TOKEN='+'a'*64+'\n');return p
 def resign(self,name,data):
  self.data[name]=data;self.data['SHA256SUMS']=''.join(w.digest(v)+'  '+n+'\n' for n,v in self.data.items() if n!='SHA256SUMS').encode()
 def test_installs_verified_rtx_without_starting_or_building(self):
  s=self.install();self.assertEqual(w.state(self.root)['release'],w.DEFAULT_RELEASE);self.assertTrue((self.bin/'perla').exists());self.assertEqual(self.calls,[]);self.assertFalse((self.root/'config/worker.env').exists())
  self.assertEqual(s['image'],'perla-rtx-worker:0.5.0');self.assertNotIn('contracts',s['inventory'])
 def test_installs_hopper_with_existing_adapter_and_licenses(self):
  s=self.install('hopper');self.assertEqual(s['image'],'perla-worker:0.1');self.assertIn('worker-entrypoint.sh',s['inventory']);self.assertIn('PERLA-MIT-LICENSE.txt',s['inventory'])
 def test_download_checksum_mismatch_stops_before_activation(self):
  original=self.fetch
  def corrupt(url,limit):return original(url,limit)+b'changed' if url.endswith('perla-rtx-worker.tar.gz') else original(url,limit)
  with self.assertRaisesRegex(w.WorkerError,'digest differs'):self.install(fetch=corrupt)
  self.assertFalse((self.root/'current.json').exists())
 def test_released_checksum_is_enforced_even_without_api_digest(self):
  original=self.fetch
  def corrupt(url,limit):
   if url.startswith('https://api.github.com/'):
    m=json.loads(original(url,limit));[a.pop('digest',None) for a in m['assets']];return json.dumps(m).encode()
   return original(url,limit)+b'changed' if url.endswith('perla-rtx-worker.tar.gz') else original(url,limit)
  with self.assertRaisesRegex(w.WorkerError,'Checksum mismatch'):self.install(fetch=corrupt)
  self.assertFalse((self.root/'current.json').exists())
 def test_draft_release_is_not_installable(self):
  def fetch(url,limit):
   data=self.fetch(url,limit)
   if url.startswith('https://api.github.com/'):m=json.loads(data);m['draft']=True;return json.dumps(m).encode()
   return data
  with self.assertRaisesRegex(w.WorkerError,'not published'):self.install(fetch=fetch)
 def test_redirected_asset_metadata_cannot_change_repository(self):
  def fetch(url,limit):
   data=self.fetch(url,limit)
   if url.startswith('https://api.github.com/'):m=json.loads(data);next(a for a in m['assets'] if a['name']=='SHA256SUMS')['browser_download_url']='https://example.invalid/payload';return json.dumps(m).encode()
   return data
  with self.assertRaisesRegex(w.WorkerError,'missing'):self.install(fetch=fetch)
 def test_duplicate_and_malformed_checksums_fail(self):
  for data in [b'a  install.py\n',(b'a'*64+b'  install.py\n')*2,b'a'*64+b'  ../payload\n']:
   with self.assertRaises(w.WorkerError):w.checksums(data)
 def tar(self,names):
  output=io.BytesIO()
  with tarfile.open(fileobj=output,mode='w:gz') as tar:
   for name,kind in names:
    i=tarfile.TarInfo(name)
    if kind=='link':i.type=tarfile.SYMTYPE;i.linkname='../../outside';tar.addfile(i)
    else:i.size=1;tar.addfile(i,io.BytesIO(b'x'))
  return output.getvalue()
 def test_archive_traversal_symlinks_and_duplicate_paths_are_rejected(self):
  for names in [[('perla-rtx-worker/../../outside','file')],[('perla-rtx-worker/link','link')],[('perla-rtx-worker/a','file'),('perla-rtx-worker/./a','file')]]:
   dst=Path(self.tmp.name)/('extract-'+str(len(str(names))));dst.mkdir(exist_ok=True)
   with self.assertRaises(w.WorkerError):w.extract(self.tar(names),dst,'perla-rtx-worker')
  self.assertFalse((Path(self.tmp.name)/'outside').exists())
 def test_installer_code_must_match_the_release(self):
  self.data['install.py']+=b'\n# changed\n';self.resign('install.py',self.data['install.py'])
  with contextlib.redirect_stdout(io.StringIO()):
   with self.assertRaisesRegex(w.WorkerError,'Installer program'):w.install(self.root,self.bin,w.DEFAULT_RELEASE,'rtx',self.fetch,self.files['install.py'],self.runner)
 def test_wrong_chain_manifest_is_rejected(self):
  m=json.loads(self.data['worker-release.json']);m['chainId']=4663;self.resign('worker-release.json',json.dumps(m).encode())
  with self.assertRaisesRegex(w.WorkerError,'manifest'):self.install()
 def test_reinstall_is_idempotent_and_preserves_configuration(self):
  first=self.install();w.configure(self.root,self.config());before=(self.root/'config/worker.env').read_bytes();second=self.install()
  self.assertEqual(first['archiveSha256'],second['archiveSha256']);self.assertEqual(before,(self.root/'config/worker.env').read_bytes())
 def test_another_command_at_the_perla_path_is_preserved(self):
  (self.bin/'perla').write_text('another command')
  with self.assertRaisesRegex(w.WorkerError,'preserved'):self.install()
  self.assertEqual((self.bin/'perla').read_text(),'another command')
 def test_modified_installed_source_is_detected(self):
  s=self.install();(Path(s['directory'])/'miner.py').write_text('edited source')
  with self.assertRaisesRegex(w.WorkerError,'changed'):w.state(self.root)
 def test_symlink_installation_directory_is_rejected(self):
  alias=Path(self.tmp.name)/'alias';alias.symlink_to(self.root,target_is_directory=True)
  with self.assertRaisesRegex(w.WorkerError,'symlink'):w.directory(alias)
 def test_private_worker_configuration_is_saved_without_printing_token(self):
  out=io.StringIO()
  with contextlib.redirect_stdout(out):w.configure(self.root,self.config())
  path=self.root/'config/worker.env';self.assertEqual(path.stat().st_mode&0o777,0o600);self.assertNotIn('a'*64,out.getvalue());self.assertEqual(w.configuration(self.root)['PERLA_ENDPOINT'],'https://perlacompute.xyz')
 def test_wallet_keys_unknown_variables_and_duplicate_fields_are_rejected(self):
  for tail in ['PERLA_PRIVATE_KEY=fixture\n','PERLA_WORKER_TOKEN='+'b'*64+'\n','HF_TOKEN=fixture\n']:
   p=self.config();p.write_text(p.read_text()+tail)
   with self.assertRaises(w.WorkerError):w.configure(self.root,p)
  self.assertFalse((self.root/'config/worker.env').exists())
 def test_endpoint_credentials_paths_and_insecure_remote_http_are_rejected(self):
  for endpoint in ['http://example.invalid','https://user:pass@example.invalid','https://example.invalid/path','https://example.invalid?q=1']:
   p=self.config();p.write_text(p.read_text().replace('https://perlacompute.xyz',endpoint))
   with self.assertRaises(w.WorkerError):w.configure(self.root,p)
 def test_symlink_configuration_source_and_destination_are_rejected(self):
  p=self.config();link=Path(self.tmp.name)/'link.env';link.symlink_to(p)
  with self.assertRaises(w.WorkerError):w.configure(self.root,link)
  (self.root/'config').symlink_to(Path(self.tmp.name),target_is_directory=True)
  with self.assertRaises(w.WorkerError):w.configure(self.root,p)
 def test_doctor_selects_requested_gpu_in_a_mixed_rig_without_a_coordinator_call(self):
  s=self.install()
  with contextlib.redirect_stdout(io.StringIO()):self.assertTrue(w.doctor(self.root,s,0,self.runner));self.assertFalse(w.doctor(self.root,s,1,self.runner))
  self.assertTrue(all(a[0] in ('docker','nvidia-smi') for a in self.calls))
 def test_rtx_selftest_has_no_network_and_does_not_start_mining(self):
  s=self.install();w.runtime(self.root,s,argparse.Namespace(command='selftest',device=1),self.runner);args=self.calls[-1];self.assertIn('none',args);self.assertIn('selftest',args);self.assertNotIn('--env-file',args);self.assertNotIn('run',args[2:])
 def test_hopper_does_not_claim_to_have_a_standalone_gpu_selftest(self):
  s=self.install('hopper')
  with self.assertRaisesRegex(w.WorkerError,'Hopper inference'):w.runtime(self.root,s,argparse.Namespace(command='selftest',device=0),self.runner)
 def test_start_is_explicit_uses_scoped_file_and_disables_automatic_restarts(self):
  s=self.install();w.configure(self.root,self.config());self.calls=[]
  with contextlib.redirect_stdout(io.StringIO()):w.runtime(self.root,s,argparse.Namespace(command='start',device=0,shares=1,interval=10,model=None,tensor_parallel_size=2),self.runner)
  args=self.calls[-1];self.assertEqual(args[:2],['docker','run']);self.assertEqual(args[args.index('--restart')+1],'no');self.assertIn('--env-file',args);self.assertNotIn('a'*64,' '.join(args));self.assertEqual(args[-5:],['0','--shares','1','--interval','10'])
 def test_a_foreign_named_container_is_never_stopped_or_removed(self):
  def runner(args,**_):return json.dumps([{'Config':{'Labels':{'io.perla.installation':'another-installation'}},'State':{'Running':True}}])
  with self.assertRaisesRegex(w.WorkerError,'another installation'):w.owned_container(self.root,runner)
 def test_start_rejects_world_readable_worker_config(self):
  s=self.install();w.configure(self.root,self.config());(self.root/'config/worker.env').chmod(0o644)
  with self.assertRaisesRegex(w.WorkerError,'private permissions'):w.runtime(self.root,s,argparse.Namespace(command='start'),self.runner)
 def test_update_downloads_and_verifies_the_release_installer_before_executing_it(self):
  s=self.install();observed=[]
  def runner(args,**_):
   observed.append(args);self.assertEqual(Path(args[1]).read_bytes(),self.data['install.py']);return ''
  with mock.patch.object(w.shutil,'which',return_value=None):w.upgrade(self.root,s,w.DEFAULT_RELEASE,self.fetch,runner)
  self.assertEqual(len(observed),1);self.assertIn('--root',observed[0]);self.assertIn('--release',observed[0])
 def test_downgrade_fails_without_executing_a_downloaded_program(self):
  s=self.install()
  with self.assertRaisesRegex(w.WorkerError,'downgrade'):w.upgrade(self.root,s,'worker-v0.4.0',lambda *_:self.fail('Unexpected fetch'),self.runner)
 def test_update_releases_parent_lock_before_the_child_installer_takes_it(self):
  self.install();original=w.upgrade;checked=[]
  def child(args,**kwargs):
   with (self.root/'worker.lock').open('a') as lock:
    w.fcntl.flock(lock,w.fcntl.LOCK_EX|w.fcntl.LOCK_NB);checked.append(True)
   return ''
  def invoke(root,installed,release,before_execute=None):return original(root,installed,release,self.fetch,child,before_execute)
  with mock.patch.object(w,'upgrade',side_effect=invoke),mock.patch.object(w.shutil,'which',return_value=None):w.main(['--root',str(self.root),'update','--release',w.DEFAULT_RELEASE])
  self.assertEqual(checked,[True])
 def test_installed_launcher_executes_the_verified_cli(self):
  self.install();p=subprocess.run([str(self.bin/'perla'),'version'],capture_output=True,text=True);self.assertEqual(p.returncode,0,p.stderr);self.assertEqual(json.loads(p.stdout)['release'],w.DEFAULT_RELEASE)
 def test_bootstrap_help_works_without_network_or_mining(self):
  p=subprocess.run(['bash',str(ROOT/'install.sh'),'--help'],capture_output=True,text=True);self.assertEqual(p.returncode,0);self.assertIn('Does not build or start',p.stdout)
 def bootstrap(self,bad_checksum=False):
  source=Path(self.tmp.name)/'bootstrap-assets';source.mkdir();marker=Path(self.tmp.name)/'bootstrap-executed.json'
  code=b'import json,os,sys\nfrom pathlib import Path\nPath(os.environ["PERLA_BOOTSTRAP_MARKER"]).write_text(json.dumps(sys.argv[1:]))\n'
  (source/'install.py').write_bytes(code);(source/'SHA256SUMS').write_text(('0'*64 if bad_checksum else w.digest(code))+'  install.py\n')
  bins=Path(self.tmp.name)/'bootstrap-bin';bins.mkdir();curl=bins/'curl'
  curl.write_text('#!/usr/bin/env python3\nimport os,shutil,sys\nfrom pathlib import Path\na=sys.argv[1:];out=a[a.index("-o")+1];url=a[a.index("-o")-1]\nshutil.copyfile(Path(os.environ["PERLA_BOOTSTRAP_ASSETS"])/url.rsplit("/",1)[1],out)\n');curl.chmod(0o755)
  env=dict(os.environ,PATH=str(bins)+':'+os.environ['PATH'],PERLA_BOOTSTRAP_MARKER=str(marker),PERLA_BOOTSTRAP_ASSETS=str(source))
  result=subprocess.run(['bash',str(ROOT/'install.sh'),'--profile','rtx','--root',str(self.root),'--bin-dir',str(self.bin)],env=env,capture_output=True,text=True)
  return result,marker
 def test_bootstrap_downloads_verifies_and_forwards_installation_options(self):
  result,marker=self.bootstrap();self.assertEqual(result.returncode,0,result.stderr);args=json.loads(marker.read_text());self.assertIn('--profile',args)
  parsed=w.parser().parse_args(args);self.assertEqual(parsed.install_root,self.root);self.assertEqual(parsed.bin_dir,self.bin)
 def test_bootstrap_does_not_execute_a_program_with_a_bad_checksum(self):
  result,marker=self.bootstrap(True);self.assertNotEqual(result.returncode,0);self.assertFalse(marker.exists());self.assertIn('checksum failed',result.stderr+result.stdout)
 def test_launcher_write_failure_does_not_activate_an_incomplete_installation(self):
  original=w.atomic
  def fail(path,data,mode=0o600):
   if path==self.bin/'perla':raise OSError('Fixture write failure')
   return original(path,data,mode)
  with mock.patch.object(w,'atomic',side_effect=fail):
   with self.assertRaises(OSError):self.install()
  self.assertFalse((self.root/'current.json').exists());self.assertFalse((self.bin/'perla').exists())
 def test_release_packaging_is_reproducible(self):
  with tempfile.TemporaryDirectory() as folder:
   subprocess.run(['python3',str(ROOT/'scripts/package-worker-release.py'),'--output',folder,'--tag',w.DEFAULT_RELEASE],check=True,capture_output=True)
   self.assertEqual(self.files,{p.name:p.read_bytes() for p in Path(folder).iterdir()})
if __name__=='__main__':unittest.main()
