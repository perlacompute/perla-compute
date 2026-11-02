"""Exercise the actual job validator without importing native or CUDA dependencies."""
import ast,base64,copy,hashlib,json,struct,unittest,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
# Compile the unchanged validator function from source. Its code uses only SHA256,
# base64 and policy constants; no substitute proof/hash implementation is supplied.
tree=ast.parse((ROOT/'services/rtx-worker/protocol.py').read_text())
fn=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='validate_job')
rules=json.loads((ROOT/'services/rtx-worker/round-rules.json').read_text())
profiles=json.loads((ROOT/'services/rtx-worker/work-profiles.json').read_text())
h=hashlib.sha256(json.dumps(rules,sort_keys=True,separators=(',',':')).encode()).hexdigest()
ns={'base64':base64,'hashlib':hashlib,'struct':struct,'ROUND_RULES':rules,'ROUND_HASH':h,'PROFILES':{r['bits']:r for r in profiles['profiles']},'PROTOCOL':'perla-pearl-plain-v4'}
exec(compile(ast.Module(body=[fn],type_ignores=[]),'<actual Perla job validator>','exec'),ns)
class RoundJobTests(unittest.TestCase):
 def fixture(self):
  now=20760*86400+1000;epoch=now//86400;origin='https://perla.test';job=str(uuid.uuid4());rid=str(uuid.uuid4());worker=str(uuid.uuid4());wallet='0x'+'11'*20
  prev=hashlib.sha256(f'perla-work-v4|46630|{origin}|{epoch}|round={rid}|policy={h}'.encode()).digest()[::-1]
  commitment=hashlib.sha256(f'perla-recipient-v4|46630|{worker}|{wallet}|{epoch}|{job}'.encode()).digest()[::-1]
  header=struct.pack('<I',1)+prev+commitment+struct.pack('<II',now,0x1d00ffff)
  return now,origin,dict(id=job,epoch=epoch,workerId=worker,recipient=wallet,expires=now+300,protocol=ns['PROTOCOL'],chainId=46630,workPolicy={'profile':'p1','bits':0x1d00ffff,'points':1},round={'id':rid,'epoch':epoch,'policy':rules['policy'],'policyHash':h,'bits':0x1c00ffff,'workUnits':256,'windowWorkUnits':512,'rewardBaseUnits':'1000'},mining_job={'cert_version':3,'target':str(0xffff<<208),'incomplete_header_bytes':base64.b64encode(header).decode()})
 def test_policy_hash_matches_coordinator_and_original_header_is_retained(self):
  self.assertEqual(h,'815efedf86e62a15e709bddfb4bad13569ddc24e714614e56fdcccaba8bc15d5');n,o,j=self.fixture();self.assertEqual(len(ns['validate_job'](j,n,o)),76)
 def test_changed_round_id_cannot_reuse_an_original_header(self):
  n,o,j=self.fixture();j['round']['id']=str(uuid.uuid4())
  with self.assertRaisesRegex(ValueError,'commitment'):ns['validate_job'](j,n,o)
 def test_policy_target_window_and_reward_tampering_fail_closed(self):
  for key,value in [('policyHash','0'*64),('bits',0x207fffff),('workUnits',1),('windowWorkUnits',513),('rewardBaseUnits','0'),('epoch',1)]:
   n,o,j=self.fixture();j['round'][key]=value
   with self.assertRaises(ValueError):ns['validate_job'](j,n,o)
 def test_docker_runtime_contains_both_files_required_by_the_job_validator(self):
  text=(ROOT/'services/rtx-worker/Dockerfile').read_text();line=next(x for x in text.splitlines() if x.startswith('COPY protocol.py '))
  self.assertIn('work-profiles.json',line);self.assertIn('round-rules.json',line)

 def test_old_coordinator_jobs_without_round_metadata_are_refused(self):
  n,o,j=self.fixture();j.pop('round')
  with self.assertRaisesRegex(ValueError,'round reward policy'):ns['validate_job'](j,n,o)
