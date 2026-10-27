#!/usr/bin/env python3
"""VPS operations: redacted health checks, encrypted backups, isolated restore drills."""
import argparse
import hashlib
import fcntl
import hmac
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import tarfile
import tempfile
import time
import urllib.error
import urllib.request


def run(args, **kwargs):
    result = subprocess.run(args, check=True, capture_output=True, **kwargs)
    return result.stdout.decode().strip()


def environment(project):
    values = {}
    for line in (project/'.env').read_text().splitlines():
        key, sep, value = line.partition('=')
        if sep and not key.lstrip().startswith('#'):
            values[key.strip()] = value.strip().strip('\"\'')
    return values


def health(project):
    env = environment(project)
    origin = env.get('PERLA_PUBLIC_ORIGIN','').rstrip('/')
    token = env.get('PERLA_OPERATOR_TOKEN','')
    if not origin.startswith('https://') or len(token) < 32:
        raise RuntimeError('Public origin or operator configuration is missing')
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self,*args,**kwargs): return None
    req = urllib.request.Request(origin+'/api/mining/operator/health', headers={'Authorization':'Bearer '+token})
    with urllib.request.build_opener(NoRedirect()).open(req,timeout=35) as response:
        raw=response.read(100000)
        if len(raw)>=100000: raise RuntimeError('Health response too large')
        data=json.loads(raw)
    native=data.get('native',{})
    if native.get('ready') is not True: raise RuntimeError('Native verifier is not ready')
    treasury=data.get('treasury',{})
    if treasury.get('status')=='unavailable' or (treasury.get('data') or {}).get('coverage')=='attention':raise RuntimeError('Testnet RPC or treasury reconciliation needs attention')
    return {'healthy':True,'checkedAt':int(time.time()),'policy':data.get('policy',{}).get('status'), 'operations':data.get('operations'), 'nativeProtocol':native.get('supported_protocols')}


def compose(project,*args):
    return run(['docker','compose',*args],cwd=project)


def backup_key(path,create=False):
    if path.is_symlink(): raise RuntimeError('Backup key cannot be a symlink')
    if create and not path.exists():
        path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
        fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        with os.fdopen(fd,'w') as f: f.write(secrets.token_hex(32)+'\n')
    if not path.is_file() or path.stat().st_mode & 0o077: raise RuntimeError('Backup key must exist with mode 600')
    raw=path.read_bytes().strip()
    if len(raw)!=64: raise RuntimeError('Invalid backup key')
    return hashlib.sha256(b'perla-backup-mac-v1|'+raw).digest()


def signature(path,key):
    mac=hmac.new(key,digestmod=hashlib.sha256)
    with path.open('rb') as f:
        for block in iter(lambda:f.read(1024*1024),b''):mac.update(block)
    return mac.hexdigest()


def restore_check(project,archive,keyfile,create=False):
    key=backup_key(keyfile)
    meta=json.loads(Path(str(archive)+'.json').read_text())
    if meta.get('format')!='perla-encrypted-backup-v1' or not hmac.compare_digest(meta.get('mac',''),signature(archive,key)):
        raise RuntimeError('Encrypted backup authentication failed; no decryption attempted')
    with tempfile.TemporaryDirectory(prefix='perla-restore-') as directory:
        temp=Path(directory); os.chmod(temp,0o700)
        clear=temp/'backup.tar'
        run(['openssl','enc','-d','-aes-256-cbc','-pbkdf2','-iter','600000','-in',str(archive),'-out',str(clear),'-pass','file:'+str(keyfile)])
        with tarfile.open(clear) as tar:
            names=tar.getnames()
            if sorted(names)!=['deployment.env','perla.sqlite'] or any(not member.isfile() for member in tar.getmembers()): raise RuntimeError('Unexpected backup members')
            stream=tar.extractfile('perla.sqlite')
            with (temp/'perla.sqlite').open('wb') as f: shutil.copyfileobj(stream,f)
        container=compose(project,'ps','-q','web')
        image=run(['docker','inspect','--format','{{.Image}}',container])
        code="const{DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('/backup.sqlite',{readOnly:true});if(d.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||d.prepare('PRAGMA foreign_key_check').all().length)throw Error('Restore integrity failed');const counts={};for(const t of ['mining_workers','mining_jobs','mining_shares','mining_reward_epochs'])counts[t]=d.prepare('SELECT COUNT(*) n FROM '+t).get().n;console.log(JSON.stringify({integrity:'ok',foreignKeys:'ok',counts}));d.close()"
        result=run(['docker','run','--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','64','--memory','512m','--user','0:0','--mount','type=bind,src='+str(temp/'perla.sqlite')+',dst=/backup.sqlite,readonly','--entrypoint','node',image,'-e',code])
        return {'restoreDrill':json.loads(result),'liveDatabaseChanged':False,'checkedAt':int(time.time())}


def backup(project,keyfile,destination):
    key=backup_key(keyfile,create=True)
    destination.mkdir(parents=True,exist_ok=True,mode=0o700); os.chmod(destination,0o700)
    archive=destination/('perla-'+time.strftime('%Y%m%dT%H%M%SZ',time.gmtime())+'-'+secrets.token_hex(3)+'.tar.enc')
    with tempfile.TemporaryDirectory(prefix='perla-backup-') as directory:
        temp=Path(directory); os.chmod(temp,0o700)
        remote='/tmp/perla-backup-'+secrets.token_hex(16)+'.sqlite'
        try:
            compose(project,'exec','-T','web','node','scripts/backup-vps.mjs',remote)
            compose(project,'cp','web:'+remote,str(temp/'perla.sqlite'))
        finally:
            try:compose(project,'exec','-T','web','node','-e',"require('node:fs').rmSync(process.argv[1],{force:true})",remote)
            except subprocess.CalledProcessError: pass
        shutil.copyfile(project/'.env',temp/'deployment.env')
        bundle=temp/'backup.tar'
        with tarfile.open(bundle,'w') as tar:
            for name in ['perla.sqlite','deployment.env']:tar.add(temp/name,arcname=name,recursive=False)
        partial=Path(str(archive)+'.partial')
        try:
            run(['openssl','enc','-aes-256-cbc','-pbkdf2','-iter','600000','-salt','-in',str(bundle),'-out',str(partial),'-pass','file:'+str(keyfile)])
            os.chmod(partial,0o600); partial.rename(archive)
        finally:partial.unlink(missing_ok=True)
    meta={'format':'perla-encrypted-backup-v1','mac':signature(archive,key),'bytes':archive.stat().st_size,'createdAt':int(time.time())}
    metadata=Path(str(archive)+'.json');metadata.write_text(json.dumps(meta,indent=2)+'\n');os.chmod(metadata,0o600)
    drill=restore_check(project,archive,keyfile)
    # Only completed matching backup pairs from this tool are retained/deleted.
    old=sorted(destination.glob('perla-*.tar.enc'),key=lambda p:p.stat().st_mtime,reverse=True)[14:]
    for path in old:
        if Path(str(path)+'.json').is_file():path.unlink();Path(str(path)+'.json').unlink()
    return {'archive':str(archive),'encrypted':True,'authenticated':True,'keyFile':str(keyfile),**drill,'offsiteConfigured':False}


def install(project,keyfile,destination):
    if os.geteuid()!=0:raise RuntimeError('Run timer installation as root')
    # Make a usable backup and exercise restore before scheduling unattended work.
    report=backup(project,keyfile,destination)
    for kind,description,schedule in [('health','Perla authenticated verifier health','*-*-* *:0/5:00'),('backup','Perla encrypted backup and restore drill','*-*-* 03:15:00 UTC')]:
        command=f'/usr/bin/python3 {project}/scripts/perla-ops.py {kind} --project {project} --key {keyfile} --destination {destination}'
        if any(ch.isspace() for value in (project,keyfile,destination) for ch in str(value)):raise RuntimeError('Use paths without whitespace for systemd installation')
        Path('/etc/systemd/system/perla-'+kind+'.service').write_text('[Unit]\nDescription='+description+'\nAfter=docker.service network-online.target\n\n[Service]\nType=oneshot\nUMask=0077\nExecStart='+command+'\nTimeoutStartSec=15min\n')
        Path('/etc/systemd/system/perla-'+kind+'.timer').write_text('[Unit]\nDescription='+description+' timer\n\n[Timer]\nOnCalendar='+schedule+'\nPersistent=true\nRandomizedDelaySec=45\n\n[Install]\nWantedBy=timers.target\n')
    run(['systemctl','daemon-reload']);run(['systemctl','enable','--now','perla-health.timer','perla-backup.timer'])
    return {'timersInstalled':True,'initialBackup':report,'alerts':'Failures are visible in systemd/journal. No external notification destination is configured.'}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command',choices=['health','backup','restore-check','install'])
    parser.add_argument('--project',default='/var/www/perla-vps')
    parser.add_argument('--key',default='/etc/perla/backup.key')
    parser.add_argument('--destination',default='/var/backups/perla')
    parser.add_argument('--archive')
    args=parser.parse_args();project=Path(args.project).resolve();key=Path(args.key).resolve();destination=Path(args.destination).resolve()
    os.umask(0o077)
    lock=None
    try:
        if args.command!='health':
            state=project/'data';state.mkdir(exist_ok=True,mode=0o700)
            lock=(state/'operations.lock').open('a');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        if args.command=='health':report=health(project)
        elif args.command=='backup':report=backup(project,key,destination)
        elif args.command=='install':report=install(project,key,destination)
        else:
            if not args.archive:raise RuntimeError('--archive is required')
            report=restore_check(project,Path(args.archive).resolve(),key)
        print(json.dumps(report,indent=2));return 0
    except (RuntimeError,ValueError,KeyError,OSError,subprocess.CalledProcessError,tarfile.TarError):
        # Do not print subprocess outputs or exception objects containing secrets.
        print(json.dumps({'healthy':False,'error':'Operation failed. Check service availability, private file permissions, backup authentication and the runbook.'}));return 1
if __name__=='__main__':raise SystemExit(main())
