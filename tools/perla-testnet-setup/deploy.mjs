import {readFile,writeFile,rename,mkdir,chmod} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createPublicClient,createWalletClient,http,defineChain,isAddress,keccak256,concat,formatEther,encodeDeployData} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';

export const CHAIN_ID=46630;
export const SUPPLY=1_000_000_000n*10n**18n;
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
export const contractDigest=contracts=>keccak256(concat([contracts.PerlaTestToken.bytecode,contracts.PerlaRewards.bytecode]));

/** State contains public addresses and transaction hashes only. */
export async function setupTestnet({publicClient,walletClient,account,contracts,stateDir,expectedDigest,configuredToken='',configuredDistributor='',log=console.log}) {
 if(await publicClient.getChainId()!==CHAIN_ID)throw Error('Refusing this network. Only Robinhood Testnet 46630 is supported.');
 if(contractDigest(contracts)!==expectedDigest)throw Error('Contract source differs from the reviewed 0.2.3 contracts. Apply that patch before deployment.');
 await mkdir(stateDir,{recursive:true,mode:0o700});await chmod(stateDir,0o700);
 const file=resolve(stateDir,'deployment.json');
 let state;try{state=JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 if(state&&(state.chainId!==CHAIN_ID||!same(state.owner,account.address)||state.contractsDigest!==expectedDigest))throw Error('Saved deployment belongs to a different wallet, network or contract version.');
 if(!state)state={version:1,chainId:CHAIN_ID,owner:account.address,contractsDigest:expectedDigest,createdAt:new Date().toISOString(),contracts:{}};
 for(const [value,name] of [[configuredToken,'PerlaTestToken'],[configuredDistributor,'PerlaRewards']]) {
  if(value&&(!isAddress(value)||!same(value,state.contracts[name]?.address)))throw Error('Existing '+name+' configuration does not match this deployment record. No new transaction sent.');
 }
 const save=async()=>{const temporary=file+'.tmp';await writeFile(temporary,JSON.stringify(state,null,2)+'\n',{mode:0o600});await chmod(temporary,0o600);await rename(temporary,file);};
 const read=(name,address,functionName)=>publicClient.readContract({address,abi:contracts[name].abi,functionName});
 async function verifyToken(address){
  if(!isAddress(address)||(await publicClient.getCode({address}))==='0x')throw Error('Test token has no deployed code.');
  const [supply,decimals,symbol]=await Promise.all([read('PerlaTestToken',address,'totalSupply'),read('PerlaTestToken',address,'decimals'),read('PerlaTestToken',address,'symbol')]);
  if(supply!==SUPPLY||Number(decimals)!==18||symbol!=='tPERLA')throw Error('Test token supply or metadata differs from 1B tPERLA.');
 }
 async function verifyRewards(address,token){
  if(!isAddress(address)||(await publicClient.getCode({address}))==='0x')throw Error('Reward distributor has no deployed code.');
  const [owner,asset]=await Promise.all([read('PerlaRewards',address,'owner'),read('PerlaRewards',address,'rewardToken')]);
  if(!same(owner,account.address)||!same(asset,token))throw Error('Reward distributor owner or token mismatch.');
 }
 async function deploy(name,args,verify){
  let record=state.contracts[name];
  if(record?.status==='verified'){await verify(record.address);return record.address;}
  if(record?.status==='submitting'&&!record.transaction)throw Error(name+': an earlier broadcast returned no hash. Review the wallet history before another attempt; automatic redeployment is blocked.');
  if(record?.status==='reverted')throw Error(name+': the saved transaction reverted. Review it before replacing the deployment record.');
  if(!record?.transaction){
   const balance=await publicClient.getBalance({address:account.address});
   if(balance===0n)throw Error('Wallet '+account.address+' needs test ETH on Robinhood Testnet before deployment.');
   const prepared=await walletClient.prepareTransactionRequest({account,data:encodeDeployData({...contracts[name],args})});
   const gasBudget=prepared.gas*(prepared.maxFeePerGas??prepared.gasPrice??0n);
   if(balance<gasBudget)throw Error('Wallet '+account.address+' needs more test ETH before deployment. Estimated maximum gas budget: '+formatEther(gasBudget));
   log('Deployer: '+account.address+' | Test ETH: '+formatEther(balance));
   record={status:'submitting'};state.contracts[name]=record;await save();
   const transaction=await walletClient.deployContract({...prepared,account,...contracts[name],args});
   record.transaction=transaction;record.status='pending';await save();
   log(name+' transaction: '+transaction);
  }else log('Resume '+name+' transaction: '+record.transaction);
  const receipt=await publicClient.waitForTransactionReceipt({hash:record.transaction,timeout:90000,confirmations:1});
  if(receipt.status!=='success'){record.status='reverted';await save();throw Error(name+' deployment reverted: '+record.transaction);}
  if(!receipt.contractAddress)throw Error('Deployment receipt contains no contract address.');
  await verify(receipt.contractAddress);
  record.status='verified';record.address=receipt.contractAddress;record.blockNumber=receipt.blockNumber.toString();await save();
  return record.address;
 }
 const token=await deploy('PerlaTestToken',[],verifyToken);
 const distributor=await deploy('PerlaRewards',[token],address=>verifyRewards(address,token));
 state.verifiedAt=new Date().toISOString();await save();
 const report={chainId:CHAIN_ID,owner:account.address,token,distributor,supply:'1000000000',symbol:'tPERLA',decimals:18,
  tokenTransaction:state.contracts.PerlaTestToken.transaction,distributorTransaction:state.contracts.PerlaRewards.transaction,
  miningEnabledBySetup:false,rewardEpochFundedBySetup:false,
  explorer:'https://explorer.testnet.chain.robinhood.com',verifiedAt:state.verifiedAt};
 await writeFile(resolve(stateDir,'public-report.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
 log(JSON.stringify(report,null,2));return report;
}

async function main(){
 const rpc=process.env.PERLA_RPC_URL||'https://rpc.testnet.chain.robinhood.com';
 const url=new URL(rpc);if(url.protocol!=='https:'||url.username||url.password)throw Error('Use an HTTPS testnet RPC.');
 const chain=defineChain({id:CHAIN_ID,name:'Robinhood Testnet',nativeCurrency:{name:'Test ETH',symbol:'ETH',decimals:18},rpcUrls:{default:{http:[rpc]}}});
 const publicClient=createPublicClient({chain,transport:http(rpc,{retryCount:0,timeout:20000})});
 if(await publicClient.getChainId()!==CHAIN_ID)throw Error('RPC is not Robinhood Testnet 46630.');
 let key='';for await(const chunk of process.stdin)key+=chunk.toString();key=key.trim();
 if(!/^(0x)?[0-9a-fA-F]{64}$/.test(key))throw Error('Enter the private key of your dedicated test wallet in the terminal.');
 const account=privateKeyToAccount(key.startsWith('0x')?key:'0x'+key);key='';
 const walletClient=createWalletClient({chain,account,transport:http(rpc,{retryCount:0,timeout:20000})});
 const {compileContracts}=await import('./perla-rewards.mjs');
 const contracts=await compileContracts();
 const expectedDigest=JSON.parse(await readFile('/perla-setup/reviewed-contracts.json','utf8')).contractsDigest;
 await setupTestnet({publicClient,walletClient,account,contracts,stateDir:'/perla-state',expectedDigest,
  configuredToken:process.env.PERLA_CONFIGURED_TOKEN||'',configuredDistributor:process.env.PERLA_CONFIGURED_DISTRIBUTOR||''});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{console.error(error.shortMessage||error.message||'Testnet deployment failed.');process.exitCode=1;});
