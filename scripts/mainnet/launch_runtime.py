"""Interactive public inputs; recoverable activation and a separate migration snapshot."""
from pathlib import Path
import json, os, re, subprocess, time

def public_address(value):
    value=value.strip()
    if not re.fullmatch(r'0x[0-9a-fA-F]{40}',value) or int(value[2:],16)==0:
        raise ValueError('Enter a nonzero public 0x address')
    return value

def public_report(output):
    rows=[line.split('=',1)[1] for line in output.splitlines() if line.startswith('PERLA_PUBLIC_REPORT=')]
    if len(rows)!=1: raise ValueError('Operator did not return one public report')
    return json.loads(rows[0])

def inspect(name):
    p=subprocess.run(['docker','inspect',name],capture_output=True,text=True)
    return json.loads(p.stdout)[0] if p.returncode==0 else None

def verifier_health(v,state):
    js="""const fs=require('node:fs');const token=fs.readFileSync('/app/mainnet-token','utf8').trim().split('=')[1];fetch('http://mainnet-verifier:8767/health',{headers:{authorization:'Bearer '+token},signal:AbortSignal.timeout(4000)}).then(async r=>{const x=await r.json();if(!r.ok||!x.ready||x.protocol!=='perla-mainnet-plain-v1'||x.round_target_policy!=='perla-mainnet-rounds-v1'||x.upstream_commit!=='82e6eee7076aafe10123e08db78f100d270c0582')process.exit(1)}).catch(()=>process.exit(1));"""
    return subprocess.run(['docker','run','--rm','--network',state['network'],'--mount','type=bind,source='+str(v.ROOT/'verifier.env')+',target=/app/mainnet-token,readonly','--user','0','--entrypoint','node',state['image'],'-e',js],capture_output=True).returncode==0

def ensure_verifier(v,state):
    old=inspect('perla-mainnet-verifier')
    wanted=subprocess.run(['docker','image','inspect',state['verifierImage'],'--format','{{.Id}}'],capture_output=True,text=True,check=True).stdout.strip()
    if old and old['Image']==wanted and old['State']['Running'] and verifier_health(v,state):return
    backup=None
    if old:
        backup='perla-mainnet-verifier-backup-'+str(time.time_ns())
        subprocess.run(['docker','stop','-t','5','perla-mainnet-verifier'],capture_output=True,check=True)
        subprocess.run(['docker','rename','perla-mainnet-verifier',backup],check=True)
    try:
        v.run(['docker','run','-d','--name','perla-mainnet-verifier','--network',state['network'],'--network-alias','mainnet-verifier','--restart','unless-stopped','--read-only','--tmpfs','/tmp:rw,noexec,nosuid,size=64m','--cap-drop','ALL','--security-opt','no-new-privileges','--cpus','4','--memory','5g','--env-file',v.ROOT/'verifier.env',state['verifierImage']],stdout=subprocess.DEVNULL)
        for _ in range(10):
            if verifier_health(v,state): return
            time.sleep(1)
        raise ValueError('Mainnet native verifier health did not pass; previous container retained')
    except Exception:
        subprocess.run(['docker','rm','-f','perla-mainnet-verifier'],capture_output=True)
        if backup:
            subprocess.run(['docker','rename',backup,'perla-mainnet-verifier'],check=True)
            subprocess.run(['docker','start','perla-mainnet-verifier'],capture_output=True)
        raise

def inputs(v,state,reader=input):
    path=v.ROOT/'launch-inputs.json'
    if path.exists():
        data=json.loads(path.read_text())
    else:
        token=public_address(reader('PERL MAINNET contract address: '))
        owner=public_address(reader('Dedicated MAINNET owner/dev PUBLIC wallet: '))
        treasury=public_address(reader('Treasury PUBLIC wallet [Enter = owner]: ').strip() or owner)
        cutoff=reader('Last eligible TESTNET UTC epoch [Enter = previous UTC day]: ').strip()
        cutoff=int(cutoff) if cutoff else int(time.time()//86400)-1
        if cutoff<0 or cutoff>=int(time.time()//86400):raise ValueError('Use a closed UTC testnet epoch')
        data={'token':token,'owner':owner,'treasury':treasury,'migrationCutoff':cutoff}
        v.atomic(path,json.dumps(data,indent=2)+'\n')
    for key in ['token','owner','treasury']:public_address(data[key])
    if type(data['migrationCutoff']) is not int or data['migrationCutoff']<0 or data['migrationCutoff']>=int(time.time()//86400):
        raise ValueError('Saved migration cutoff must be a closed UTC epoch')
    return data

def finish(v,state,args):
    if '--execute' not in args:raise ValueError('Use finish --execute for 1M initial funding (650k mining + 350k migration)')
    api_before=inspect('perla-api-only')
    if not api_before or not api_before['State']['Running']:raise ValueError('Existing API-only service must be running before this upgrade')
    data=inputs(v,state)
    path=v.ROOT/'config/config.json';raw=json.loads(path.read_text())
    if state.get('activated'):
        if raw.get('owner','').lower()!=data['owner'].lower() or raw.get('token','').lower()!=data['token'].lower():raise ValueError('Active token or owner differs from saved public inputs')
    else:
        raw['externalApi']=True;raw['migrationCutoff']=data['migrationCutoff']
        st=path.stat();v.atomic(path,json.dumps(raw,indent=2)+'\n',st.st_mode&0o777,(st.st_uid,st.st_gid))
        ensure_verifier(v,state)
        # Only a public wallet address returns from this isolated stdin-only check.
        def signer_address(key):
            # operator prints through subprocess stdout, so capture it explicitly.
            cmd=['docker','run','--rm','-i','--network','none','--env-file',str(v.ROOT/'runtime.env'),'--mount','type=volume,source='+state['volume']+',target=/app/data','--mount','type=bind,source='+str(v.ROOT/'config')+',target=/app/mainnet','--entrypoint','node',state['image'],'scripts/mainnet/operator.bundle.mjs','signer-address','--stdin-key']
            r=subprocess.run(cmd,input=key,capture_output=True)
            if r.returncode:raise ValueError('Cannot read dedicated signer identity; no signer content is printed')
            return public_report(r.stdout.decode())['address']
        key=v.signer() if (v.ROOT/'signer.cred').exists() else b''
        if not key or signer_address(key).lower()!=data['owner'].lower():
            candidate=v.getpass.getpass('Dedicated MAINNET owner private key (hidden, encrypted locally): ').strip()
            if not re.fullmatch(r'0x[0-9a-fA-F]{64}',candidate):raise ValueError('Expected a dedicated mainnet private key')
            key=(candidate+'\n').encode();candidate=''
            if signer_address(key).lower()!=data['owner'].lower():raise ValueError('Entered key does not match the public owner wallet')
            pending=v.ROOT/'signer.cred.pending';v.run(['systemd-creds','encrypt','--name=perla-mainnet-signer','-',pending],input=key);pending.chmod(0o600);os.replace(pending,v.ROOT/'signer.cred')
        plan=v.ROOT/'config/activation-plan.json'
        # Preserve the original plan even after expiry if any action may be signed.
        if plan.exists():
            previous=json.loads(plan.read_text())
            if previous.get('initialFunding',{}).get('total')!='1000000000000000000000000' or previous['expires']<=time.time() or previous['nextConfig']['startEpoch']<int(time.time()//86400):
                js="const{DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('/app/data/compute.sqlite',{readOnly:true});process.stdout.write(String(d.prepare('SELECT COUNT(*) n FROM compute_operator_journal').get().n));d.close()"
                count=subprocess.run(['docker','run','--rm','--network','none','--mount','type=volume,source='+state['volume']+',target=/app/data','--entrypoint','node',state['image'],'-e',js],capture_output=True,text=True,check=True)
                if int(count.stdout)==0:plan.rename(plan.with_name('superseded-plan-'+str(time.time_ns())+'.json'))
                elif previous.get('initialFunding',{}).get('total')!='1000000000000000000000000':raise ValueError('Legacy funding already has signed transactions; they must be reconciled before changing the plan')
        if not plan.exists():
            v.operator(state,['release'])
            v.operator(state,['plan','--owner',data['owner'],'--token',data['token'],'--treasury',data['treasury'],'--out','/app/mainnet/activation-plan.json'])
        saved=json.loads(plan.read_text())
        if any(saved['nextConfig'][x].lower()!=data[x].lower() for x in ['token','owner','treasury']):raise ValueError('Saved activation plan differs from public inputs')
        v.validate_compose(state,v.ROOT)
        v.operator(state,['activate','--plan','/app/mainnet/activation-plan.json','--execute','--stdin-key'],key)
        key=b''
        v.switch(state)
    api_after=inspect('perla-api-only')
    if not api_after or not api_after['State']['Running'] or api_after['Image']!=api_before['Image'] or api_after['Mounts']!=api_before['Mounts']:
        raise ValueError('Check the independent API service before proceeding; no API ledger was modified by this command')
    # Migration is eligible rewards -> mainnet, not token balance wrapping.
    capture=['docker','run','--rm','--network',state['network'],'--env-file',str(v.ROOT/'runtime.env'),'--mount','type=volume,source='+state['volume']+',target=/app/data','--mount','type=bind,source='+str(v.ROOT/'config')+',target=/app/mainnet','--entrypoint','node',state['image'],'scripts/mainnet/operator.bundle.mjs','migration-plan']
    r=subprocess.run(capture,capture_output=True,text=True)
    if r.returncode:raise ValueError('Migration snapshot validation pending. Mining and API remain deployed; settle eligible testnet epochs, then rerun finish')
    report=public_report(r.stdout)
    missing=int(report.get('missingBaseUnits','0'))
    published=False
    if report['eligible'] and missing==0:
        v.operator(state,['migration','--execute','--stdin-key'],v.signer());published=True
    elif report['eligible']:
        print('Migration snapshot retained; reserve top-up needed before publication: '+str(missing)+' base units',flush=True)
    print(json.dumps({'miningActivated':True,'migrationEligible':report['eligible'],'migrationPublished':published,'migrationTopupRequiredBaseUnits':str(missing),'initialFundingPERL':'1000000','migrationCutoff':data['migrationCutoff'],'apiServicePreserved':True,'migrationRatio':'100:7','migrationReserve':'70000000','dailyMigrationCap':'1000000','physicalGpuTestStillRequired':True},indent=2))
