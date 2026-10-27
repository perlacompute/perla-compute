import contextlib,hashlib,importlib.util,io,json,subprocess,tempfile,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('release_publisher',ROOT/'scripts/publish-worker-release.py');r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
class ReleaseTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.folder=Path(self.tmp.name);subprocess.run(['python3',str(ROOT/'scripts/package-worker-release.py'),'--output',str(self.folder),'--tag','worker-v0.5.0'],check=True,capture_output=True)
  self.sha='1'*40;self.release=None;self.calls=[];self.private=False
 def tearDown(self):self.tmp.cleanup()
 def asset(self,name):return {'name':name,'digest':'sha256:'+hashlib.sha256((self.folder/name).read_bytes()).hexdigest()}
 def gh(self,args):
  self.calls.append(args)
  if args[:2]==['gh','api']:
   if '/commits/' in args[2]:return self.sha
   if '/releases?' in args[2]:return json.dumps([self.release] if self.release else [])
   return json.dumps({'private':self.private,'visibility':'private' if self.private else 'public'})
  if args[:3]==['gh','release','create']:
   self.release={'tag_name':'worker-v0.5.0','prerelease':True,'draft':True,'html_url':'https://github.com/'+r.REPO+'/releases/tag/worker-v0.5.0','assets':[]};return ''
  if args[:3]==['gh','release','upload']:
   for path in args[6:]:self.release['assets'].append(self.asset(Path(path).name))
   return ''
  if args[:3]==['gh','release','edit']:self.release['draft']=False;return ''
  raise AssertionError(args)
 def publish(self,verify=False):return r.publish(self.folder,'worker-v0.5.0',self.sha,verify,self.gh)
 def test_new_release_is_checked_then_published_as_a_prerelease(self):
  result=self.publish();self.assertTrue(result['published']);self.assertTrue(result['checksumsVerified']);self.assertFalse(self.release['draft']);self.assertTrue(self.release['prerelease']);self.assertFalse(any('--clobber' in a for a in self.calls))
 def test_repeat_verifies_without_replacing_any_asset(self):
  self.publish();self.calls=[];self.publish();self.assertFalse(any(a[:2]==['gh','release'] for a in self.calls))
 def test_partial_draft_upload_resumes_only_missing_assets(self):
  self.gh(['gh','release','create']);self.release['assets']=[self.asset('install.py')];self.calls=[];self.publish()
  uploaded=[a for a in self.calls if a[:3]==['gh','release','upload']];self.assertEqual(len(uploaded),1);self.assertNotIn(str(self.folder/'install.py'),uploaded[0])
 def test_changed_existing_asset_is_not_overwritten(self):
  self.publish();self.release['assets'][0]['digest']='sha256:'+'0'*64;self.calls=[]
  with self.assertRaisesRegex(r.ReleaseError,'differs'):self.publish()
  self.assertFalse(any(a[:2]==['gh','release'] for a in self.calls))
 def test_incomplete_published_release_is_not_modified(self):
  self.publish();self.release['assets'].pop();self.calls=[]
  with self.assertRaisesRegex(r.ReleaseError,'incomplete'):self.publish()
  self.assertFalse(any(a[:2]==['gh','release'] for a in self.calls))
 def test_wrong_tag_commit_cannot_create_a_release(self):
  with self.assertRaisesRegex(r.ReleaseError,'tag'):r.publish(self.folder,'worker-v0.5.0','2'*40,runner=self.gh)
  self.assertIsNone(self.release)
 def test_private_repo_stays_private_and_is_not_reported_as_publicly_installable(self):
  self.private=True;result=self.publish();self.assertFalse(result['publicInstallAvailable']);self.assertFalse(result['visibilityChanged']);self.assertFalse(any('--visibility' in a for a in self.calls))
 def test_verify_only_never_creates_a_release(self):
  with self.assertRaisesRegex(r.ReleaseError,'not been created'):self.publish(True)
  self.assertIsNone(self.release)
 def test_changed_local_archive_is_rejected_before_github_calls(self):
  p=self.folder/'perla-rtx-worker.tar.gz';p.write_bytes(p.read_bytes()+b'changed')
  with self.assertRaisesRegex(r.ReleaseError,'checksum'):self.publish()
  self.assertEqual(self.calls,[])
if __name__=='__main__':unittest.main()
