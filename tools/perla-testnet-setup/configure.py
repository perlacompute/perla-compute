#!/usr/bin/env python3
"""Read deployment configuration and install verified public addresses."""
import argparse,json,os,re,secrets,shutil,tempfile,time
from pathlib import Path

KEYS=['PERLA_RPC_URL','PERLA_REWARD_TOKEN','PERLA_DISTRIBUTOR_ADDRESS','PERLA_MINING_ENABLED','PERLA_PUBLIC_ORIGIN']
def read_env(path):
    text=path.read_text();values={}
    for line in text.splitlines():
        match=re.match(r'^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$',line)
        if match:
            key,value=match.groups()
            if key in values:raise ValueError('Duplicate environment key: '+key)
            if len(value)>=2 and value[0]==value[-1] and value[0] in ['"',"'"]:value=value[1:-1]
            values[key]=value
    return text,values

def inspect(target):
    _,values=read_env(target/'.env')
    if values.get('PERLA_MINING_ENABLED')=='true':raise ValueError('Pause mining admission before changing reward token configuration.')
    for key in KEYS:
        value=values.get(key,'')
        if '\n' in value or '\r' in value:raise ValueError('Invalid environment value.')
        print(value)

def install(target):
    path=target/'.env';text,values=read_env(path)
    report=json.loads((target/'data/testnet-deployment/public-report.json').read_text())
    if report.get('chainId')!=46630 or report.get('supply')!='1000000000':raise ValueError('Invalid verified testnet report.')
    updates={'PERLA_REWARD_TOKEN':report['token'],'PERLA_DISTRIBUTOR_ADDRESS':report['distributor']}
    for key,value in updates.items():
        if not re.fullmatch(r'0x[0-9a-fA-F]{40}',value):raise ValueError('Invalid deployment address.')
        if values.get(key) and values[key].lower()!=value.lower():raise ValueError('Existing '+key+' differs; configuration was not overwritten.')
    if values.get('PERLA_MINING_ENABLED')=='true':raise ValueError('Mining admission changed while setup was running; configuration was not overwritten.')
    if not values.get('PERLA_OPERATOR_TOKEN'):updates['PERLA_OPERATOR_TOKEN']=secrets.token_hex(32)
    elif len(values['PERLA_OPERATOR_TOKEN'])<32:raise ValueError('Existing operator token is too short; replace it before setup.')
    if not values.get('PERLA_MINING_ENABLED'):updates['PERLA_MINING_ENABLED']='false'
    if not values.get('PERLA_RPC_URL'):updates['PERLA_RPC_URL']='https://rpc.testnet.chain.robinhood.com'
    updates={key:value for key,value in updates.items() if values.get(key)!=value}
    if not updates:print('UNCHANGED');return
    backup=target/'data/testnet-deployment'/('env-backup-'+time.strftime('%Y%m%d-%H%M%S')+'-'+str(os.getpid()))
    shutil.copyfile(path,backup);backup.chmod(0o600)
    lines=text.splitlines()
    for key,value in updates.items():
        for index,line in enumerate(lines):
            if re.match(r'^\s*'+re.escape(key)+r'\s*=',line):lines[index]=key+'='+value;break
        else:lines.append(key+'='+value)
    fd,temporary=tempfile.mkstemp(prefix='.perla-env-',dir=target)
    try:
        with os.fdopen(fd,'w') as stream:stream.write('\n'.join(lines)+'\n')
        os.chmod(temporary,0o600);os.chown(temporary,path.stat().st_uid,path.stat().st_gid);os.replace(temporary,path)
    finally:
        if os.path.exists(temporary):os.unlink(temporary)
    print('UPDATED')

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('action',choices=['inspect','install']);parser.add_argument('project',type=Path);args=parser.parse_args()
    try:
        target=args.project.resolve()
        if not (target/'compose.yaml').exists():raise ValueError('Not the Perla VPS project.')
        (inspect if args.action=='inspect' else install)(target)
    except Exception as error:raise SystemExit(str(error))
