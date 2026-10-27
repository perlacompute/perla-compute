/** Projected geometry fallback for browsers without a WebGL context. */
import type { ComputeField } from './compute-field';
import { surface, fieldTiles, sceneView } from './compute-shape';
type Options={onReady:(ready:boolean)=>void};
type Point=[number,number,number];
const clamp=(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n));
const norm=(p:Point):Point=>{const n=Math.hypot(...p)||1;return p.map(x=>x/n) as Point;};
const cross=(a:Point,b:Point):Point=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const dot=(a:Point,b:Point)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
export function createCanvasField(canvas:HTMLCanvasElement,options:Options):ComputeField|null {
 const ctx=canvas.getContext('2d',{alpha:false});if(!ctx)return null;
 const mobile=innerWidth<700,tiles=fieldTiles(mobile);
 let width=1,height=1,dpr=1,time=0,yaw=0,tilt=0,targetYaw=0,targetTilt=0,paused=matchMedia('(prefers-reduced-motion: reduce)').matches;
 let visible=true,disposed=false,frame=0,last=0,drawn=0,selected=-1,pointerX=-100,pointerY=-100,dragging=false,downX=0,downY=0,startYaw=0,startTilt=0;
 let eye:Point=[0,8.5,17],back:Point=[0,0,1],right:Point=[1,0,0],up:Point=[0,1,0],shift=.27;
 const faces=[{p:[[-1,1,-1],[1,1,-1],[1,1,1],[-1,1,1]],shade:1.04},{p:[[-1,-1,1],[-1,1,1],[1,1,1],[1,-1,1]],shade:.80},{p:[[-1,-1,-1],[-1,1,-1],[-1,1,1],[-1,-1,1]],shade:.66},{p:[[1,-1,1],[1,1,1],[1,1,-1],[1,-1,-1]],shade:.87}];
 const projection=(p:Point):Point=>{const d=p.map((v,i)=>v-eye[i]) as Point,w=-dot(back,d),f=2.605;return [(dot(right,d)/w*f/(width/height)*.5+.5)*width,(.5-(dot(up,d)/w*f-shift)*.5)*height,w];};
 const rotate=(p:Point):Point=>{const xx=Math.cos(yaw)*p[0]+Math.sin(yaw)*p[2],zz=-Math.sin(yaw)*p[0]+Math.cos(yaw)*p[2];return [xx,p[1]+zz*tilt,zz];};
 const rounded=(p:Point[])=>{ctx.beginPath();for(let i=0;i<p.length;i++){const a=p[(i+p.length-1)%p.length],b=p[i],c=p[(i+1)%p.length],r=.11;const s=[b[0]+(a[0]-b[0])*r,b[1]+(a[1]-b[1])*r],e=[b[0]+(c[0]-b[0])*r,b[1]+(c[1]-b[1])*r];if(i===0)ctx.moveTo(...s as [number,number]);else ctx.lineTo(...s as [number,number]);ctx.quadraticCurveTo(b[0],b[1],e[0],e[1]);}ctx.closePath();};
 const draw=()=>{
  ctx.setTransform(dpr,0,0,dpr,0,0);ctx.fillStyle='#f0efea';ctx.fillRect(0,0,width,height);
  const shadow=ctx.createRadialGradient(width*.5,height*.81,0,width*.5,height*.81,width*.63);shadow.addColorStop(0,'#2426221b');shadow.addColorStop(1,'#24262200');ctx.fillStyle=shadow;ctx.fillRect(0,height*.4,width,height*.6);
  const polygons:{points:Point[];color:string;depth:number}[]=[];let nearest=-1,nearestDist=400,hover:Point=[0,0,0];
  for(const [x,z,id] of tiles){
   const [y,dx,dz]=surface(x,z,time);
   const tangent=norm([1,dx,0]),normal=norm([-dx,1,-dz]),forward=norm(cross(tangent,normal));
   const size=(.49+.045*Math.sin(id*7.17))*.5,center=projection(rotate([x,y,z]));
   const dist=(center[0]-pointerX)**2+(center[1]-pointerY)**2;
   if(!dragging&&pointerY>height*.38&&center[2]>0&&dist<nearestDist){nearestDist=dist;nearest=id;hover=center;}
   let mix=clamp((x+Math.sin(z*.35)*2+1)/7,0,1);mix=mix*mix*(3-2*mix);const tone=.94+.07*Math.sin(id*3.73),fog=(1-clamp((z+15)/18,0,1))*.68;
   const base=[.79,.49,.39].map((v,i)=>(v*(1-mix)+[.19,.20,.18][i]*mix)*255*tone);
   for(const face of faces){
    const points=face.p.map(c=>projection(rotate([x+(tangent[0]*c[0]+normal[0]*c[1]+forward[0]*c[2])*size,y+(tangent[1]*c[0]+normal[1]*c[1]+forward[1]*c[2])*size+(id===selected?.24:0),z+(tangent[2]*c[0]+normal[2]*c[1]+forward[2]*c[2])*size])));
    if(points.some(p=>p[2]<=0)||points.every(p=>p[0]<-80)||points.every(p=>p[0]>width+80)||points.every(p=>p[1]>height+80))continue;
    const rgb=base.map((v,i)=>Math.round(clamp(v*face.shade*(1-fog)+[240,239,234][i]*fog+(id===selected?9:0),0,255)));
    polygons.push({points,color:`rgb(${rgb.join(',')})`,depth:points.reduce((s,p)=>s+p[2],0)/4});
   }
  }
  polygons.sort((a,b)=>b.depth-a.depth);
  ctx.lineWidth=.55;
  for(const p of polygons){rounded(p.points);ctx.fillStyle=p.color;ctx.strokeStyle=p.color;ctx.fill();ctx.stroke();}
  selected=nearest;

 };
 const tick=(stamp:number)=>{frame=0;if(disposed||!visible||document.hidden)return;if(stamp-drawn>(mobile?48:40)){if(!paused)time+=Math.min((stamp-(last||stamp))/1000,.08);last=stamp;drawn=stamp;yaw+=(targetYaw-yaw)*.18;tilt+=(targetTilt-tilt)*.18;draw();}if(!paused||Math.abs(targetYaw-yaw)>.001||Math.abs(targetTilt-tilt)>.001)frame=requestAnimationFrame(tick);};
 const wake=()=>{if(!frame&&!disposed&&visible&&!document.hidden)frame=requestAnimationFrame(tick);};
 const resize=()=>{const rect=canvas.getBoundingClientRect();width=Math.max(1,rect.width);height=Math.max(1,rect.height);dpr=Math.min(devicePixelRatio||1,mobile?1.25:1.5);canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);const camera=sceneView(width);eye=camera.eye;back=norm(eye.map((n,i)=>n-camera.target[i]) as Point);right=norm(cross([0,1,0],back));up=cross(back,right);shift=camera.shift;wake();};
 const move=(e:PointerEvent)=>{const rect=canvas.getBoundingClientRect();pointerX=e.clientX-rect.left;pointerY=e.clientY-rect.top;if(dragging){targetYaw=clamp(startYaw+(e.clientX-downX)*.0017,-.38,.38);targetTilt=clamp(startTilt+(e.clientY-downY)*.0005,-.10,.10);}else if(e.pointerType==='mouse'&&!paused){targetYaw=(pointerX/width-.5)*.08;targetTilt=(pointerY/height-.5)*.025;}wake();};
 const down=(e:PointerEvent)=>{if(e.button!==0)return;dragging=true;downX=e.clientX;downY=e.clientY;startYaw=targetYaw;startTilt=targetTilt;if(e.pointerType==='mouse')canvas.setPointerCapture(e.pointerId);canvas.dataset.dragging='true';wake();};
 const end=()=>{dragging=false;delete canvas.dataset.dragging;wake();};
 const leave=()=>{pointerX=-100;pointerY=-100;selected=-1;wake();};
 const key=(e:KeyboardEvent)=>{if(e.ctrlKey||e.metaKey||e.altKey||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home'].includes(e.key))return;e.preventDefault();if(e.key==='Home'){targetYaw=0;targetTilt=0;}else if(e.key==='ArrowLeft')targetYaw=clamp(targetYaw-.05,-.38,.38);else if(e.key==='ArrowRight')targetYaw=clamp(targetYaw+.05,-.38,.38);else if(e.key==='ArrowUp')targetTilt=clamp(targetTilt-.025,-.1,.1);else targetTilt=clamp(targetTilt+.025,-.1,.1);wake();};
 const visibility=()=>{last=0;if(document.hidden&&frame){cancelAnimationFrame(frame);frame=0;}else wake();};
 canvas.addEventListener('pointermove',move);canvas.addEventListener('pointerdown',down);canvas.addEventListener('pointerup',end);canvas.addEventListener('pointercancel',end);canvas.addEventListener('pointerleave',leave);canvas.addEventListener('keydown',key);document.addEventListener('visibilitychange',visibility);
 const resizeObserver=new ResizeObserver(resize);resizeObserver.observe(canvas);const intersection=new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;last=0;if(!visible&&frame){cancelAnimationFrame(frame);frame=0;}else wake();},{rootMargin:'80px'});intersection.observe(canvas);
 resize();draw();canvas.dataset.renderer='canvas2d';options.onReady(true);wake();
 return {setPaused(value){paused=value;last=0;wake();},reset(){targetYaw=0;targetTilt=0;pointerX=-100;pointerY=-100;wake();},dispose(){disposed=true;if(frame)cancelAnimationFrame(frame);resizeObserver.disconnect();intersection.disconnect();canvas.removeEventListener('pointermove',move);canvas.removeEventListener('pointerdown',down);canvas.removeEventListener('pointerup',end);canvas.removeEventListener('pointercancel',end);canvas.removeEventListener('pointerleave',leave);canvas.removeEventListener('keydown',key);document.removeEventListener('visibilitychange',visibility);}};
}
