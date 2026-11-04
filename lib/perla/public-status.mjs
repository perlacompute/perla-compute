/** Labels require observed coordinator state; an enabled switch alone is not public admission. */
/** @param {{miningEnabled:boolean,launch?:{phase:string}|null}|null} data @param {boolean} failed */
export function publicNetworkState(data,failed=false){
 if(failed)return {label:'Status unavailable',tone:'neutral'};
 if(!data)return {label:'Checking the network',tone:'neutral'};
 if(!data.miningEnabled)return {label:'Work admission paused',tone:'neutral'};
 if(data.launch?.phase==='live')return {label:'Public testnet open',tone:'green'};
 if(data.launch?.phase==='testing')return {label:'Validation in progress',tone:'neutral'};
 return {label:'Mining available',tone:'green'};
}
