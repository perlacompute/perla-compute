import hashlib,importlib.util,json,sys,tempfile,unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT));sys.path.insert(0,str(ROOT/'scripts/mainnet'))
import launch_runtime as l
class Completion(unittest.TestCase):
 def test_public_address_rejects_zero_and_private_keys(self):
  for s in ['0x'+'00'*20,'0x'+'12'*32,'not address','0x123']:
   with self.assertRaises(ValueError):l.public_address(s)
  self.assertEqual(l.public_address('0x'+'12'*20),'0x'+'12'*20)
 def test_inputs_are_cli_only_and_reused_without_second_prompt(self):
  with tempfile.TemporaryDirectory() as t:
   root=Path(t);v=SimpleNamespace(ROOT=root,atomic=lambda p,x:p.write_text(x));answers=iter(['0x'+'11'*20,'0x'+'22'*20,'',''])
   a=l.inputs(v,{},lambda _:next(answers));self.assertEqual(a['treasury'],a['owner'])
   self.assertEqual(l.inputs(v,{},lambda _:self.fail('should not prompt twice')),a)
 def test_cutoff_rejects_unclosed_epoch(self):
  with tempfile.TemporaryDirectory() as t:
   answers=iter(['0x'+'11'*20,'0x'+'22'*20,'','99999999'])
   with self.assertRaises(ValueError):l.inputs(SimpleNamespace(ROOT=Path(t),atomic=lambda *a:self.fail('no write')),{},lambda _:next(answers))
 def test_public_report_parser_never_treats_empty_output_as_success(self):
  with self.assertRaises(ValueError):l.public_report('stopped')
  self.assertEqual(l.public_report('PERLA_PUBLIC_REPORT={"eligible":false}'),{'eligible':False})
 def test_finish_without_execute_sends_no_transactions(self):
  with self.assertRaises(ValueError):l.finish(None,{},[])
 def test_changed_api_container_stops_before_migration_or_signing(self):
  with tempfile.TemporaryDirectory() as t:
   root=Path(t);(root/'config').mkdir();data={'token':'0x'+'11'*20,'owner':'0x'+'22'*20,'treasury':'0x'+'22'*20,'migrationCutoff':100}
   (root/'config/config.json').write_text(json.dumps(data))
   v=SimpleNamespace(ROOT=root)
   before={'State':{'Running':True},'Image':'old','Mounts':[]};after={**before,'Image':'changed'}
   with patch.object(l,'inputs',return_value=data),patch.object(l,'inspect',side_effect=[before,after]),patch.object(l.subprocess,'run') as calls:
    with self.assertRaisesRegex(ValueError,'independent API'):l.finish(v,{'activated':True},['--execute'])
    calls.assert_not_called()
if __name__=='__main__':unittest.main()
