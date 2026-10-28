#!/usr/bin/env python3
"""One local command: prepare, review, then fund/activate closed testnet epochs."""
import fcntl, getpass, json, os, re, subprocess, sys
from pathlib import Path
PROJECT = Path(__file__).resolve().parents[1]
def execute(action, key=None, capture=False, expected_plan=None):
    request = json.dumps({'action': action, **({'key': key, 'expectedPlan': expected_plan} if key else {})}) + '\n'
    result = subprocess.run(['docker', 'compose', 'exec', '-T', 'web', 'node', '/app/scripts/reward-settle.bundle.mjs'], cwd=PROJECT, input=request, text=True, stdout=subprocess.PIPE if capture else None)
    if result.returncode: raise RuntimeError('Reward operation stopped; preserve existing manifests and transaction journals. Rerunning reconciles completed funding.')
    return result.stdout
def main():
    action = sys.argv[1] if len(sys.argv)>1 else 'settle'
    if action not in ('review','prepare','settle'): raise RuntimeError('Usage: perla-rewards.sh [review|prepare|settle]')
    directory=PROJECT/'.perla-backups'; directory.mkdir(mode=0o700,exist_ok=True)
    if directory.is_symlink(): raise RuntimeError('Use a regular deployment backup directory.')
    with (directory/'rewards.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        output=execute('review' if action=='settle' else 'prepare',capture=True)
        for line in output.splitlines():
            if line.startswith('{'): report=json.loads(line)
        if 'report' not in locals(): raise RuntimeError('The reward review was unavailable.')
        print('Robinhood Testnet 46630 — PERL reward settlement',flush=True)
        for row in report['epochs']:
            print(f"Epoch {row['epoch']}: {row['budgetPERL']} PERL | {row['recipients']} recipients | {row['points']} points\nRoot: {row['root']}",flush=True)
        print('Total scheduled budget: '+report['totalScheduledPERL']+' testnet PERL. Mainnet stays closed.',flush=True)
        if not report['epochs']:
            from datetime import datetime,timezone
            at=datetime.fromtimestamp(report['settlementOpensAt'],timezone.utc)
            print('No closed, unsettled epoch contains accepted work. Current epoch can settle from '+at.isoformat()+'. No wallet key or transaction is needed.',flush=True);return
        if action!='settle':
            print('Manifests prepared. Funding requires: bash scripts/perla-rewards.sh settle',flush=True);return
        if report.get('rpcReady') is not True: raise RuntimeError('The configured testnet RPC did not confirm the reviewed token/distributor. No key was requested. Restore RPC access or use a Robinhood Testnet provider in PERLA_RPC_URL, then recreate web and rerun settlement.')
        if not sys.stdin.isatty(): raise RuntimeError('Run settle in an interactive terminal to review and enter the dedicated testnet owner key privately.')
        print('The following key authorizes exact-budget testnet approvals and funding for the displayed epochs, followed by activation. Ctrl+C leaves them pending.',flush=True)
        key=getpass.getpass('Dedicated testnet owner private key (hidden; never saved): ')
        if not re.fullmatch(r'0x[0-9a-fA-F]{64}',key): raise RuntimeError('Invalid local private-key format.')
        execute('settle',key,expected_plan=report['planHash']);key=None
if __name__=='__main__':
    os.umask(0o077)
    try:main()
    except (RuntimeError,BlockingIOError,KeyboardInterrupt) as error:
        print(str(error) if isinstance(error,RuntimeError) else 'Another settlement is running, or the operation was cancelled.',file=sys.stderr);raise SystemExit(1)
