/** Generate the static SVG fallback from the same scene model as the canvas. */
import { build } from 'esbuild';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const temp=await mkdtemp(join(tmpdir(),'perla-poster-'));
try {
 await build({entryPoints:['components/perla/compute-shape.ts'],outfile:join(temp,'shape.mjs'),bundle:true,format:'esm',platform:'node'});
 const {surface,fieldTiles,sceneView}=await import(pathToFileURL(join(temp,'shape.mjs')));
 const width=1600,height=900,{eye,target,shift}=sceneView(width);
 const norm=p=>{const n=Math.hypot(...p)||1;return p.map(x=>x/n);};
 const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
 const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),back=norm(eye.map((v,i)=>v-target[i])),right=norm(cross([0,1,0],back)),up=cross(back,right);
 const project=p=>{const d=p.map((v,i)=>v-eye[i]),w=-dot(back,d),f=2.605;return [(dot(right,d)/w*f/(width/height)*.5+.5)*width,(.5-(dot(up,d)/w*f-shift)*.5)*height,w];};
 const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
 const faces=[{p:[[-1,1,-1],[1,1,-1],[1,1,1],[-1,1,1]],shade:1.04},{p:[[-1,-1,1],[-1,1,1],[1,1,1],[1,-1,1]],shade:.80},{p:[[-1,-1,-1],[-1,1,-1],[-1,1,1],[-1,-1,1]],shade:.66},{p:[[1,-1,1],[1,1,1],[1,1,-1],[1,-1,-1]],shade:.87}];
 const polygons=[];
 const path=points=>{let s='';for(let i=0;i<points.length;i++){const a=points[(i+3)%4],b=points[i],c=points[(i+1)%4],r=.11,start=[b[0]+(a[0]-b[0])*r,b[1]+(a[1]-b[1])*r],end=[b[0]+(c[0]-b[0])*r,b[1]+(c[1]-b[1])*r];s+=(i===0?'M':'L')+start.map(n=>n.toFixed(2)).join(',')+'Q'+b.slice(0,2).map(n=>n.toFixed(2)).join(',')+' '+end.map(n=>n.toFixed(2)).join(',');}return s+'Z';};
 for(const [x,z,id] of fieldTiles(false)){
  const [y,dx,dz]=surface(x,z,0),tangent=norm([1,dx,0]),normal=norm([-dx,1,-dz]),forward=norm(cross(tangent,normal)),size=(.49+.045*Math.sin(id*7.17))*.5;
  let mix=clamp((x+Math.sin(z*.35)*2+1)/7,0,1);mix=mix*mix*(3-2*mix);const tone=.94+.07*Math.sin(id*3.73),fog=(1-clamp((z+15)/18,0,1))*.68;
  const base=[.79,.49,.39].map((v,i)=>(v*(1-mix)+[.19,.20,.18][i]*mix)*255*tone);
  for(const face of faces){const points=face.p.map(c=>project([x+(tangent[0]*c[0]+normal[0]*c[1]+forward[0]*c[2])*size,y+(tangent[1]*c[0]+normal[1]*c[1]+forward[1]*c[2])*size,z+(tangent[2]*c[0]+normal[2]*c[1]+forward[2]*c[2])*size]));if(points.some(p=>p[2]<=0)||points.every(p=>p[0]<-80)||points.every(p=>p[0]>width+80)||points.every(p=>p[1]>height+80))continue;const rgb=base.map((v,i)=>Math.round(clamp(v*face.shade*(1-fog)+[240,239,234][i]*fog,0,255)));polygons.push({points,color:`rgb(${rgb.join(',')})`,depth:points.reduce((s,p)=>s+p[2],0)/4});}
 }
 polygons.sort((a,b)=>b.depth-a.depth);
 const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900"><defs><radialGradient id="shadow"><stop stop-color="#242622" stop-opacity=".13"/><stop offset="1" stop-color="#242622" stop-opacity="0"/></radialGradient></defs><rect width="1600" height="900" fill="#f0efea"/><ellipse cx="800" cy="770" rx="890" ry="240" fill="url(#shadow)"/>'+polygons.map(p=>`<path d="${path(p.points)}" fill="${p.color}" stroke="${p.color}" stroke-width=".5"/>`).join('')+'</svg>';
 await writeFile('public/brand/compute-field-poster.svg',svg);
 console.log('Generated text-free compute poster: '+polygons.length+' faces.');
}finally{await rm(temp,{recursive:true,force:true});}
