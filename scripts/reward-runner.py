#!/usr/bin/env python3
"""Testnet rewards: encrypted automatic settlement, review, smoke and launch readiness."""
import fcntl,getpass,json,os,re,subprocess,sys
from pathlib import Path
PROJECT=Path(__file__).resolve().parents[1]
CREDENTIAL=Path('/etc/perla/testnet-owner.cred')
SERVICE='perla-rewards-auto.service';TIMER='perla-rewards-auto.timer'
NAME='perla-testnet-owner'
def execute(action,key=None,capture=True,expected_plan=None,admin=True):
    request={'action':action}
    if key is not None:request['key']=key
    if expected_plan:request['expectedPlan']=expected_plan
    bundle='testnet-admin.bundle.mjs' if admin else 'reward-settle.bundle.mjs'
    prefix=['docker','compose','run','--rm','--no-deps','-T','--entrypoint','node','web'] if os.environ.get('PERLA_OPERATOR_ONEOFF')=='1' else ['docker','compose','exec','-T','web','node']
    result=subprocess.run([*prefix,'/app/scripts/'+bundle],cwd=PROJECT,input=json.dumps(request)+'\n',text=True,stdout=subprocess.PIPE if capture else None,stderr=subprocess.PIPE)
    if result.returncode:
        detail=result.stderr.strip()
        # The bundled entrypoint emits bounded public errors, never raw RPC exceptions.
        if detail:print(detail[:700],file=sys.stderr)
        raise RuntimeError('Testnet reward operation stopped. Its journals were retained; retry the same command.')
    if not capture:return None
    values=[json.loads(l) for l in result.stdout.splitlines() if l.startswith('{')]
    if not values:raise RuntimeError('The reward operation did not return its report.')
    return values[-1]
def run(args,**kw):
    r=subprocess.run(args,check=False,**kw)
    if r.returncode:raise RuntimeError('Local service command failed: '+' '.join(args[:2]))
    return r

def units(project):
    if not re.fullmatch(r'/[A-Za-z0-9_./-]+',str(project)):raise RuntimeError('Use a deployment path without spaces or shell characters.')
    service='''[Unit]
Description=Perla earned testnet rewards and readiness
After=docker.service network-online.target
Requires=docker.service
Wants=network-online.target
[Service]
Type=oneshot
WorkingDirectory={project}
ExecStart=/usr/bin/python3 {project}/scripts/reward-runner.py auto
LoadCredentialEncrypted={name}:{credential}
UMask=0077
TimeoutStartSec=900
Environment=PYTHONUNBUFFERED=1
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths={project}/.perla-backups
'''.format(project=project,name=NAME,credential=CREDENTIAL)
    timer='''[Unit]
Description=Settle earned Perla testnet rewards and reconcile pending transactions
[Timer]
OnBootSec=90s
OnUnitInactiveSec=120s
AccuracySec=5s
Unit=perla-rewards-auto.service
[Install]
WantedBy=timers.target
'''
    return service,timer

def configure_auto():
    if os.geteuid()!=0:raise RuntimeError('Configure automatic settlement as root on the website VPS.')
    CREDENTIAL.parent.mkdir(mode=0o700,exist_ok=True)
    if CREDENTIAL.is_symlink() or CREDENTIAL.parent.is_symlink():raise RuntimeError('Use a regular operator credential directory.')
    if CREDENTIAL.exists():
        key=run(['systemd-creds','decrypt','--name='+NAME,str(CREDENTIAL),'-'],capture_output=True,text=True).stdout.strip()
        execute('validate-key',key);key=None
        print('Existing encrypted testnet signer verified; no key was requested.',flush=True)
    else:
        if not sys.stdin.isatty():raise RuntimeError('Run the installer in an interactive VPS terminal to enter the dedicated testnet owner key privately.')
        print('Automatic rewards use only Robinhood Testnet 46630 and the pinned PERL distributor. The local key is encrypted with this VPS host key and supplied only to the settlement service.',flush=True)
        key=getpass.getpass('Dedicated testnet owner private key (hidden): ').strip()
        execute('validate-key',key)
        temp=CREDENTIAL.with_suffix('.cred.new')
        run(['systemd-creds','encrypt','--with-key=host','--name='+NAME,'-',str(temp)],input=key+'\n',text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        key=None;temp.chmod(0o600);temp.replace(CREDENTIAL)
    service,timer=units(PROJECT)
    for name,text in [(SERVICE,service),(TIMER,timer)]:
        path=Path('/etc/systemd/system')/name
        if path.is_symlink():raise RuntimeError('Use regular Perla systemd unit files.')
        path.write_text(text);path.chmod(0o644)
    run(['systemctl','daemon-reload'],capture_output=True)
    print('Encrypted signer and automatic settlement units configured. The updater starts them after the fresh reset.',flush=True)

def credential():
    directory=os.environ.get('CREDENTIALS_DIRECTORY')
    if not directory:raise RuntimeError('Automatic signing runs through the encrypted systemd service. Use systemctl start '+SERVICE+'.')
    file=Path(directory)/NAME
    if file.is_symlink() or not file.is_file() or file.stat().st_size>100:raise RuntimeError('The encrypted systemd signer is unavailable.')
    key=file.read_text().strip()
    if not re.fullmatch(r'0x[0-9a-fA-F]{64}',key):raise RuntimeError('The systemd signer format is invalid.')
    return key

def main():
    action=sys.argv[1] if len(sys.argv)>1 else 'review'
    if action=='configure-auto':configure_auto();return
    if action=='enable-auto':
        subprocess.run(['systemctl','disable','--now','perla-rewards-prepare.timer'],capture_output=True)
        run(['systemctl','enable','--now',TIMER],capture_output=True)
        run(['systemctl','start',SERVICE],capture_output=True)
        print(json.dumps(execute('readiness'),indent=2));return
    if action not in ('review','prepare','settle','auto','smoke','health','live'):raise RuntimeError('Use review, settle, configure-auto, enable-auto, health or live.')
    directory=PROJECT/'.perla-backups';directory.mkdir(mode=0o700,exist_ok=True)
    if directory.is_symlink():raise RuntimeError('Use a regular deployment backup directory.')
    with (directory/'rewards.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        if action in ('health','live'):
            print(json.dumps(execute('readiness' if action=='health' else 'live'),indent=2));return
        if action=='auto':
            key=credential()
            print(json.dumps(execute('auto',key),indent=2));key=None;return
        if action=='smoke':
            if not sys.stdin.isatty():raise RuntimeError('Run smoke interactively, or start the encrypted settlement service.')
            key=getpass.getpass('Dedicated testnet owner private key (hidden): ').strip()
            print(json.dumps(execute('smoke',key),indent=2));key=None;return
        report=execute('review' if action=='settle' else 'prepare',admin=False)
        print('Robinhood Testnet 46630 — earned PERL settlement',flush=True)
        for row in report['epochs']:print(f"Epoch {row['epoch']}: {row['budgetPERL']} PERL | {row['wonRounds']} won rounds | {row['recipients']} recipients",flush=True)
        print('Earned budget: '+report['totalScheduledPERL']+' testnet PERL. Mainnet remains closed.',flush=True)
        if not report['epochs']:
            print('No closed epoch has unsettled earned rounds. The automatic service will prepare, fund and activate real earnings after UTC close + 5 minutes.',flush=True);return
        if action!='settle':return
        if report.get('rpcReady') is not True:raise RuntimeError('The reward RPC is unavailable. Run the installer diagnostics or restore PERLA_RPC_URL.')
        if not sys.stdin.isatty():raise RuntimeError('Run settle interactively, or start the encrypted automatic service.')
        key=getpass.getpass('Dedicated testnet owner private key (hidden): ').strip()
        print(json.dumps(execute('settle',key,expected_plan=report['planHash'],admin=False),indent=2));key=None
if __name__=='__main__':
    os.umask(0o077)
    try:main()
    except BlockingIOError:
        print('Another Perla update or settlement holds the lock. The timer will retry.',file=sys.stderr);raise SystemExit(75)
    except (RuntimeError,KeyboardInterrupt,OSError) as e:
        print(str(e) if not isinstance(e,KeyboardInterrupt) else 'Operation stopped; existing journals retained.',file=sys.stderr);raise SystemExit(1)
