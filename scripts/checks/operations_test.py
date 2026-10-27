"""Real SQLite/OpenSSL backup tests with a local Docker transport double.

The isolated Docker runtime itself still needs VPS validation.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import tempfile
import unittest
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('ops',ROOT/'scripts/perla-ops.py');ops=importlib.util.module_from_spec(spec);spec.loader.exec_module(ops)

class BackupTests(unittest.TestCase):
 def setUp(self):
  self.directory=tempfile.TemporaryDirectory();self.temp=Path(self.directory.name);self.project=self.temp/'project';self.project.mkdir();self.db=self.project/'live.sqlite'
  connection=sqlite3.connect(self.db)
  for table in ['mining_workers','mining_jobs','mining_shares','mining_reward_epochs']:connection.execute('CREATE TABLE '+table+'(id INTEGER PRIMARY KEY)');connection.execute('INSERT INTO '+table+' VALUES(1)')
  connection.commit();connection.close();(self.project/'.env').write_text('PERLA_OPERATOR_TOKEN=DO_NOT_PUBLISH_ME\n')
  self.key=self.temp/'private.key';self.destination=self.temp/'backups';self.original=ops.run;self.original_compose=ops.compose
  def compose(project,*args):
   if args[:3]==('exec','-T','web'):
    if 'scripts/backup-vps.mjs' in args:
     source=sqlite3.connect(self.db);target=sqlite3.connect(args[-1]);source.backup(target);target.close();source.close();return args[-1]
    Path(args[-1]).unlink(missing_ok=True);return ''
   if args[0]=='cp':shutil.copyfile(args[1][4:],args[2]);return ''
   if args[0]=='ps':return 'test-container'
   raise AssertionError(args)
  def run(args,**kwargs):
   if args[:2]==['docker','inspect']:return 'local-test-image'
   if args[:2]==['docker','run']:
    mount=args[args.index('--mount')+1];source=mount.split('src=',1)[1].split(',dst=')[0];code=args[-1].replace('/backup.sqlite',source)
    return self.original(['node','-e',code])
   return self.original(args,**kwargs)
  ops.compose=compose;ops.run=run
 def tearDown(self):ops.run=self.original;ops.compose=self.original_compose;self.directory.cleanup()
 def test_encrypted_backup_and_real_sqlite_restore_drill(self):
  before=hashlib.sha256(self.db.read_bytes()).hexdigest();r=ops.backup(self.project,self.key,self.destination);archive=Path(r['archive']);self.assertTrue(r['encrypted']);self.assertEqual(r['restoreDrill']['counts']['mining_shares'],1);self.assertFalse(r['liveDatabaseChanged']);self.assertEqual(before,hashlib.sha256(self.db.read_bytes()).hexdigest());self.assertNotIn(b'DO_NOT_PUBLISH_ME',archive.read_bytes());self.assertEqual(self.key.stat().st_mode & 0o777,0o600)
 def test_tampered_ciphertext_is_rejected_before_decryption(self):
  r=ops.backup(self.project,self.key,self.destination);archive=Path(r['archive']);raw=bytearray(archive.read_bytes());raw[20]^=1;archive.write_bytes(raw)
  with self.assertRaisesRegex(RuntimeError,'authentication'):ops.restore_check(self.project,archive,self.key)
 def test_wrong_key_cannot_restore(self):
  r=ops.backup(self.project,self.key,self.destination);other=self.temp/'other.key';ops.backup_key(other,True)
  with self.assertRaisesRegex(RuntimeError,'authentication'):ops.restore_check(self.project,Path(r['archive']),other)
 def test_public_key_permissions_and_symlinks_rejected(self):
  ops.backup_key(self.key,True);self.key.chmod(0o644)
  with self.assertRaises(RuntimeError):ops.backup_key(self.key)
  link=self.temp/'link.key';link.symlink_to(self.key)
  with self.assertRaises(RuntimeError):ops.backup_key(link)
if __name__=='__main__':unittest.main(verbosity=2)
