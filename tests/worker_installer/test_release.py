import contextlib,copy,hashlib,importlib.util,io,json,os,subprocess,tempfile,unittest
from pathlib import Path
from unittest import mock
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('release_publisher',ROOT/'scripts/publish-worker-release.py');r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
class ReleaseTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.folder=Path(self.tmp.name);subprocess.run(['python3',str(ROOT/'scripts/package-worker-release.py'),'--output',str(self.folder),'--tag','worker-v0.8.1'],check=True,capture_output=True)
  self.sha='1'*40;self.release=None;self.calls=[];self.private=False;self.stale_list=False;self.stale_reads=[]
 def tearDown(self):self.tmp.cleanup()
 def asset(self,name):return {'name':name,'digest':'sha256:'+hashlib.sha256((self.folder/name).read_bytes()).hexdigest()}
 def gh(self,args):
  self.calls.append(args)
  if args[:2]==['gh','api']:
   if '/commits/' in args[2]:return self.sha
   if '/releases?' in args[2]:return json.dumps([self.release] if self.release and not self.stale_list else [])
   if args[2].endswith('/releases') and '--method' in args and args[args.index('--method')+1]=='POST':
    self.release={'id':123,'tag_name':'worker-v0.8.1','prerelease':True,'draft':True,'html_url':'https://github.com/'+r.REPO+'/releases/tag/worker-v0.8.1','assets':[]};return json.dumps(self.release)
   if args[2].endswith('/releases/123'):
    if '--method' in args:
     self.release['draft']=False;self.release['prerelease']=True
    elif self.stale_reads:return json.dumps(self.stale_reads.pop(0))
    return json.dumps(self.release)
   return json.dumps({'private':self.private,'visibility':'private' if self.private else 'public'})
  if args[:3]==['gh','release','create']:
   self.release={'id':123,'tag_name':'worker-v0.8.1','prerelease':True,'draft':True,'html_url':'https://github.com/'+r.REPO+'/releases/tag/worker-v0.8.1','assets':[]};return ''
  if args[:3]==['gh','release','upload']:
   for path in args[6:]:self.release['assets'].append(self.asset(Path(path).name))
   return ''
  if args[:3]==['gh','release','edit']:self.release['draft']=False;return ''
  raise AssertionError(args)
 def publish(self,verify=False):return r.publish(self.folder,'worker-v0.8.1',self.sha,verify,self.gh,sleep=lambda seconds:None)
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
  with self.assertRaisesRegex(r.ReleaseError,'tag'):r.publish(self.folder,'worker-v0.8.1','2'*40,runner=self.gh)
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
 def test_creation_response_is_retained_when_the_release_list_is_stale(self):
  self.stale_list=True;self.assertTrue(self.publish()['published']);self.assertEqual(sum('/releases?' in a[2] for a in self.calls if a[:2]==['gh','api']),1)
 def test_a_resumed_draft_without_the_prerelease_flag_is_validated_before_publishing(self):
  self.gh(['gh','release','create']);self.release['prerelease']=False;self.release['assets']=[self.asset('install.py')];self.assertTrue(self.publish()['published']);self.assertTrue(self.release['prerelease'])
 def test_a_full_published_release_is_never_converted_or_uploaded_to(self):
  self.gh(['gh','release','create']);self.release['draft']=False;self.release['prerelease']=False;self.calls=[]
  with self.assertRaisesRegex(r.ReleaseError,'full release'):self.publish()
  self.assertFalse(any('PATCH' in a or a[:3]==['gh','release','upload'] for a in self.calls))
 def test_upload_acknowledgement_waits_for_the_same_release_id(self):
  self.gh(['gh','release','create']);self.stale_reads=[copy.deepcopy(self.release)];self.assertTrue(self.publish()['published']);self.assertEqual(self.stale_reads,[])
 def test_unconfirmed_uploaded_assets_are_not_published(self):
  self.gh(['gh','release','create']);self.stale_reads=[copy.deepcopy(self.release) for i in range(6)]
  with self.assertRaisesRegex(r.ReleaseError,'not confirmed'):self.publish()
  self.assertTrue(self.release['draft']);self.assertFalse(any('PATCH' in a for a in self.calls))
 def test_a_response_for_another_tag_is_not_accepted(self):
  self.gh(['gh','release','create']);other=copy.deepcopy(self.release);other['tag_name']='unrelated';self.stale_reads=[other]
  with self.assertRaisesRegex(r.ReleaseError,'tag changed'):self.publish()
  self.assertTrue(self.release['draft'])
 def test_permission_errors_are_reported_without_leaking_the_token(self):
  token='temporary-fixture-token-not-a-real-credential'
  with mock.patch.dict(os.environ,{'GH_TOKEN':token}),mock.patch.object(r.subprocess,'run',return_value=subprocess.CompletedProcess(['gh'],1,'','HTTP 403: contents write required '+token)):
   with self.assertRaises(r.ReleaseError) as raised:r.command(['gh','release','upload'])
  self.assertIn('HTTP 403',str(raised.exception));self.assertNotIn(token,str(raised.exception))
 def test_owner_discovered_draft_id_can_resume_when_list_results_are_empty(self):
  self.gh(['gh','release','create']);self.stale_list=True;self.calls=[]
  result=r.publish(self.folder,'worker-v0.8.1',self.sha,runner=self.gh,sleep=lambda seconds:None,known_release_id=123)
  self.assertTrue(result['published']);self.assertFalse(any('/releases?' in a[2] or 'POST' in a for a in self.calls if a[:2]==['gh','api']))
 def test_an_owner_supplied_id_for_another_tag_cannot_publish(self):
  self.gh(['gh','release','create']);self.release['tag_name']='unrelated';self.calls=[]
  with self.assertRaisesRegex(r.ReleaseError,'does not match'):r.publish(self.folder,'worker-v0.8.1',self.sha,runner=self.gh,known_release_id=123)
  self.assertFalse(any('PATCH' in a or a[:3]==['gh','release','upload'] for a in self.calls))
if __name__=='__main__':unittest.main()
