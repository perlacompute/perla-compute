import {ImageResponse} from 'next/og';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
export const runtime='nodejs';
export const alt='Perla Compute — GPU work. Verified contributions.';
export const size={width:1200,height:630};
export const contentType='image/png';
export default async function Image(){
 const [serif,sans]=await Promise.all([readFile(join(process.cwd(),'public/fonts/instrument-serif.ttf')),readFile(join(process.cwd(),'public/fonts/dm-sans-og.ttf'))]);
 return new ImageResponse(<div style={{display:'flex',width:'100%',height:'100%',background:'#f1f1e9',padding:68,fontFamily:'DM',color:'#24261f',flexDirection:'column',justifyContent:'space-between'}}><div style={{display:'flex',alignItems:'center',gap:16,fontSize:28,fontWeight:600}}><svg width="44" height="44" viewBox="0 0 80 80" fill="none"><g stroke="#b87060" strokeWidth="3.5"><ellipse cx="40" cy="40" rx="12" ry="31" transform="rotate(-45 40 40)"/><ellipse cx="40" cy="40" rx="13" ry="27" transform="rotate(45 40 40)"/></g></svg>perla<span style={{fontSize:12,letterSpacing:3,fontWeight:400,marginLeft:5}}>COMPUTE</span></div><div style={{display:'flex',flexDirection:'column'}}><span style={{fontSize:12,letterSpacing:3,color:'#73766a',marginBottom:20}}>GPU WORK / VERIFIED CONTRIBUTIONS</span><span style={{fontFamily:'Instrument',fontSize:94,lineHeight:1.02,letterSpacing:-3}}>Your GPU.</span><span style={{fontFamily:'Instrument',fontSize:94,lineHeight:1.02,letterSpacing:-3,color:'#b87060'}}>A greater purpose.</span></div><div style={{display:'flex',justifyContent:'space-between',borderTop:'1px solid #d5d8cb',paddingTop:22,fontSize:17,color:'#64695a'}}><span>Mining · Proof Explorer · Reward Center</span><span>perlacompute.xyz</span></div></div>,{...size,fonts:[{name:'DM',data:sans,weight:400,style:'normal'},{name:'Instrument',data:serif,weight:400,style:'normal'}]});
}
