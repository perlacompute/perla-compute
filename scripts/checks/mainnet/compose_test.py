"""Compose preservation tests; Docker rendering is an explicit fixture, never a live VPS claim."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import stat
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[3]
import sys
sys.path.insert(0, str(ROOT / "scripts/mainnet"))
import compose_runtime as c

class ComposeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.project, self.private = self.root/'project', self.root/'private'
        self.project.mkdir(); self.private.mkdir()
        self.base, self.override, self.env = self.project/'compose.yaml', self.project/'compose.override.yaml', self.project/'.env'
        self.base.write_text('name: perla-compute\nservices: {web: {build: .}}\n')
        self.override.write_text('services:\n  web:\n    extra_hosts: [host.docker.internal:host-gateway]\n    environment:\n      PERLA_VERIFIER_TOKEN: fixture-secret-not-for-output\n')
        self.env.write_text('INFERENCE_API_KEY=fixture-only\nPERLA_HTTP_PORT=3109\n')
        self.current = {'Config': {'Labels': {'com.docker.compose.project': 'perla-compute', 'com.docker.compose.project.working_dir': str(self.project), 'com.docker.compose.project.config_files': str(self.base)+','+str(self.override)}}, 'Mounts': [{'Type':'volume','Name':'perla-compute_perla_data','Destination':'/app/data'}]}
        self.config = {'name':'perla-compute','services':{'web':{'environment':{'PERLA_VERIFIER_TOKEN':'fixture-secret-not-for-output'},'volumes':[{'type':'volume','source':'perla_data','target':'/app/data'}]}},'volumes':{'perla_data':{'name':'perla-compute_perla_data'}}}
        self.calls = []
        self.runtime = 'PERLA_COMPUTE_CONFIG=/app/mainnet/config.json\nPERLA_AI_PROVIDER_KEY=fixture-mainnet\n'
        (self.private/'runtime.env').write_text(self.runtime)
        (self.private/'compose.override.json').write_text('{}')
    def tearDown(self): self.temp.cleanup()
    def runner(self, args, **kw):
        self.calls.append(args)
        data = copy.deepcopy(self.config)
        if str(self.private/'compose.override.json') in args:
            data['services']['web']['environment'].update(dict(line.split('=',1) for line in self.runtime.splitlines()))
        return SimpleNamespace(returncode=0,stdout=json.dumps(data))
    def prepared(self):
        snapshot = c.capture(self.project,self.current,self.runner)
        c.preserve(snapshot,self.project,self.private)
        return {'project':str(self.project),'composeSnapshot':snapshot}
    def test_capture_preserves_running_override_and_only_renders_config(self):
        originals=[p.read_bytes() for p in [self.base,self.override,self.env]]
        state=self.prepared()
        self.assertEqual(state['composeSnapshot']['files'],[str(self.base),str(self.override)])
        self.assertEqual([p.read_bytes() for p in [self.base,self.override,self.env]],originals)
        self.assertEqual(self.calls[0][-3:],['config','--format','json'])
        self.assertFalse(any('up' in call or 'down' in call for call in self.calls))
        for p in (self.private/'compose-original').iterdir():self.assertEqual(stat.S_IMODE(p.stat().st_mode),0o600)
    def test_default_override_is_retained_even_if_old_container_label_omitted_it(self):
        self.current['Config']['Labels']['com.docker.compose.project.config_files']=str(self.base)
        self.assertEqual(c.capture(self.project,self.current,self.runner)['files'],[str(self.base),str(self.override)])
    def test_migrated_missing_compose_label_falls_back_to_valid_existing_project_stack(self):
        self.current['Config']['Labels']['com.docker.compose.project.config_files']='/missing/old-vps/compose.yaml'
        self.assertEqual(c.capture(self.project,self.current,self.runner)['files'],[str(self.base),str(self.override)])
    def test_capture_refuses_wrong_volume_and_existing_mainnet_namespace(self):
        self.config['volumes']['perla_data']['name']='different-data'
        with self.assertRaisesRegex(ValueError,'differs'):c.capture(self.project,self.current,self.runner)
        self.config['volumes']['perla_data']['name']='perla-compute_perla_data'
        self.config['services']['web']['environment']['PERLA_COMPUTE_CONFIG']='foreign'
        with self.assertRaisesRegex(ValueError,'mainnet keys'):c.capture(self.project,self.current,self.runner)
    def test_compose_errors_do_not_disclose_interpolated_credentials(self):
        def fail(*a,**kw):return SimpleNamespace(returncode=1,stdout='',stderr='fixture-secret')
        with self.assertRaises(ValueError) as error:c.capture(self.project,self.current,fail)
        self.assertNotIn('fixture-secret',str(error.exception))
    def test_changed_override_and_deleted_environment_fail_before_activation(self):
        state=self.prepared();self.override.write_text('independent edit')
        with self.assertRaisesRegex(ValueError,'Compose source changed'):c.activate(state,self.private,self.runner)
        self.assertNotIn('COMPOSE_FILE=',self.env.read_text())
        self.override.write_bytes((self.private/'compose-original/1-compose.override.yaml').read_bytes())
        self.env.unlink()
        with self.assertRaisesRegex(ValueError,'environment changed'):c.activate(state,self.private,self.runner)
    def test_activation_keeps_original_override_and_runtime_values_and_is_repeatable(self):
        state=self.prepared(); original=self.override.read_bytes(); env=self.env.read_bytes()
        c.activate(state,self.private,self.runner)
        first=self.env.read_bytes()
        self.assertEqual(self.override.read_bytes(),original)
        self.assertTrue(first.startswith(env))
        self.assertIn('COMPOSE_FILE="'+str(self.base)+':'+str(self.override)+':'+str(self.private/'compose.override.json')+'"',self.env.read_text())
        c.activate(state,self.private,self.runner)
        self.assertEqual(self.env.read_bytes(),first)
        self.assertEqual((self.private/'compose-original/project.env').read_bytes(),env)
        saved=json.loads((self.private/'deployment.json').read_text())
        self.assertEqual(saved['composeSnapshot']['envActiveHash'],c.digest(self.env))
    def test_interrupted_environment_update_is_recoverable_with_old_or_new_hash(self):
        state=self.prepared(); original=c.atomic
        def fail(path,data):
            if path==self.env:raise OSError('fixture interruption')
            original(path,data)
        with patch.object(c,'atomic',side_effect=fail):
            with self.assertRaises(OSError):c.activate(state,self.private,self.runner)
        saved=json.loads((self.private/'deployment.json').read_text())
        self.assertIn('envActiveHash',saved['composeSnapshot'])
        c.activate(saved,self.private,self.runner)
        c.check(saved['composeSnapshot'],self.project)
    def test_configuration_that_shadows_mainnet_values_is_refused(self):
        state=self.prepared()
        def shadow(args,**kw):
            r=self.runner(args,**kw);d=json.loads(r.stdout);d['services']['web']['environment']['PERLA_AI_PROVIDER_KEY']='shadowed';return SimpleNamespace(returncode=0,stdout=json.dumps(d))
        with self.assertRaisesRegex(ValueError,'override mainnet'):c.activate(state,self.private,shadow)
        self.assertNotIn('COMPOSE_FILE=',self.env.read_text())
    def test_secure_build_preserves_custom_rules_and_excludes_runtime_compose_files(self):
        state=self.prepared();state['baselineFiles']={}
        stage=self.root/'prepared';stage.mkdir(); (self.project/'.dockerignore').write_text('node_modules\n.env*\ncustom-runtime/\n')
        c.secure_build(state,stage,self.project); first=(stage/'.dockerignore').read_bytes()
        c.secure_build(state,stage,self.project)
        self.assertEqual((stage/'.dockerignore').read_bytes(),first)
        self.assertTrue(first.startswith(b'node_modules\n.env*\ncustom-runtime/\n'))
        self.assertIn(b'compose*.yaml',first)
        self.assertIn('.dockerignore',state['baselineFiles'])
    def test_compose_command_orders_original_layers_before_private_mainnet_layer(self):
        state=self.prepared();cmd=c.command(self.project,state['composeSnapshot'],self.private/'compose.override.json')
        paths=[cmd[i+1] for i,p in enumerate(cmd) if p=='-f']
        self.assertEqual(paths,[str(self.base),str(self.override),str(self.private/'compose.override.json')])
    def test_switch_copies_source_and_keeps_the_original_override(self):
        state=self.prepared(); original=self.override.read_bytes()
        stage=self.root/'stage';stage.mkdir()
        target=self.project/'app.mjs';target.write_text('old source')
        (stage/'app.mjs').write_text('new source')
        state.update(source=str(stage),baselineFiles={'app.mjs':c.digest(target)},image='prepared:1',productionImage='production:1')
        source=ROOT/'payload/scripts/mainnet/vps.py'
        if not source.exists():source=ROOT/'scripts/mainnet/vps.py'
        spec=importlib.util.spec_from_file_location('compose_vps_integration',source)
        v=importlib.util.module_from_spec(spec);spec.loader.exec_module(v)
        with patch.object(v,'ROOT',self.private), patch.object(v,'validate_compose',side_effect=lambda s,p:c.validate(s,p,self.runner)), patch.object(v,'activate_compose',side_effect=lambda s,p:c.activate(s,p,self.runner)), patch.object(v,'run') as commands, patch.object(v,'install_units'), patch.object(v.subprocess,'run') as health:
            health.return_value.returncode=0
            v.switch(state)
        self.assertEqual(target.read_text(),'new source')
        self.assertEqual(self.override.read_bytes(),original)
        self.assertIn('COMPOSE_FILE=',self.env.read_text())
        compose=[call.args[0] for call in commands.call_args_list if call.args[0][:2]==['docker','compose']][0]
        paths=[compose[i+1] for i,p in enumerate(compose) if p=='-f']
        self.assertEqual(paths,[str(self.base),str(self.override),str(self.private/'compose.override.json')])
        self.assertTrue(state['activated'])
    def model_vps(self):
        source=ROOT/'payload/scripts/mainnet/vps.py'
        if not source.exists():source=ROOT/'scripts/mainnet/vps.py'
        spec=importlib.util.spec_from_file_location('model_vps',source)
        v=importlib.util.module_from_spec(spec);spec.loader.exec_module(v)
        path=self.private/'config/config.json';path.parent.mkdir(exist_ok=True)
        path.write_text(json.dumps({'origin':'https://perla.example','features':{'mining':False},'providerSmokeModel':'perla/claude-sonnet-5-5'}))
        return v,path
    def test_selected_model_is_forwarded_to_provider_smoke(self):
        v,path=self.model_vps()
        with patch.object(v,'ROOT',self.private),patch.object(v,'run') as run:
            v.operator({'network':'network','volume':'volume','image':'image'},['smoke'])
        self.assertEqual(run.call_args.args[0][-3:],['smoke','--model','perla/claude-sonnet-5-5'])
    def test_activation_uses_the_same_model_and_keeps_signer_stdin_only(self):
        v,path=self.model_vps();key=b'fixture-signer-stdin-only'
        with patch.object(v,'ROOT',self.private),patch.object(v,'run') as run:
            v.operator({'network':'network','volume':'volume','image':'image'},['activate','--execute','--stdin-key'],key)
        args=run.call_args.args[0];self.assertIn('--model',args);self.assertEqual(args[-1],'perla/claude-sonnet-5-5');self.assertNotIn(key.decode(),str(args));self.assertEqual(run.call_args.kwargs['input'],key)
    def test_explicit_smoke_model_takes_precedence(self):
        v,path=self.model_vps();path.unlink()
        with patch.object(v,'ROOT',self.private),patch.object(v,'run') as run:
            v.operator({'network':'network','volume':'volume','image':'image'},['smoke','--model','perla/other'])
        self.assertEqual(run.call_args.args[0][-3:],['smoke','--model','perla/other'])
    def test_other_operator_commands_do_not_read_smoke_configuration(self):
        v,path=self.model_vps();path.unlink()
        with patch.object(v,'ROOT',self.private),patch.object(v,'run') as run:
            v.operator({'network':'network','volume':'volume','image':'image'},['models'])
        self.assertNotIn('--model',run.call_args.args[0])
    def test_invalid_model_cannot_reach_the_operator(self):
        v,path=self.model_vps();d=json.loads(path.read_text());d['providerSmokeModel']='--execute';path.write_text(json.dumps(d))
        with patch.object(v,'ROOT',self.private),patch.object(v,'run') as run,self.assertRaisesRegex(ValueError,'catalog model'):
            v.operator({'network':'network','volume':'volume','image':'image'},['smoke'])
        run.assert_not_called()
    def test_remembered_model_preserves_configuration_and_file_ownership(self):
        v,path=self.model_vps();before=path.stat()
        with patch.object(v,'ROOT',self.private):v.remember_smoke_model('perla/new-tested-model')
        d=json.loads(path.read_text());self.assertEqual(d['providerSmokeModel'],'perla/new-tested-model');self.assertEqual(d['features'],{'mining':False});self.assertEqual(d['origin'],'https://perla.example');self.assertEqual(path.stat().st_uid,before.st_uid);self.assertEqual(path.stat().st_gid,before.st_gid)
    def test_symlink_override_is_rejected(self):
        self.override.unlink();self.override.symlink_to(self.base)
        with self.assertRaisesRegex(ValueError,'Compose path'):c.capture(self.project,self.current,self.runner)

if __name__=='__main__':unittest.main()
