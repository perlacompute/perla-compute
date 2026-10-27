import { createCanvasField } from './compute-field-canvas';
import { surface, waveGLSL, fieldTiles, sceneView } from './compute-shape';
/** Small, dependency-free WebGL renderer for the decorative homepage field. */
type Vec3 = [number, number, number];
type Options = { onReady: (ready: boolean) => void };
export type ComputeField = { setPaused: (paused: boolean) => void; reset: () => void; dispose: () => void };
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const normalize = (v: Vec3): Vec3 => { const n = Math.hypot(...v) || 1; return v.map(x => x / n) as Vec3; };
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const dot = (a: Vec3, b: Vec3) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
function multiply(a: Float32Array, b: Float32Array) {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) out[c*4+r] += a[k*4+r]*b[c*4+k];
  return out;
}
function lookAt(eye: Vec3, target: Vec3) {
  const z = normalize(eye.map((v,i) => v-target[i]) as Vec3), x = normalize(cross([0,1,0],z)), y = cross(z,x);
  return new Float32Array([x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,-dot(x,eye),-dot(y,eye),-dot(z,eye),1]);
}
function perspective(aspect: number) {
  const f = 1/Math.tan(42*Math.PI/360), near = .1, far = 100;
  return new Float32Array([f/aspect,0,0,0,0,f,0,0,0,0,(far+near)/(near-far),-1,0,0,2*far*near/(near-far),0]);
}
function geometry() {
  // Rounded cube faces with explicit edge samples: small mesh, smooth bevels.
  const vertices: number[] = [], values = [-.5,-.41,.41,.5];
  for (let axis = 0; axis < 3; axis++) for (const sign of [-1,1]) {
    const u = (axis+1)%3, v = (axis+2)%3;
    const sample = (i: number,j: number) => {
      const p: Vec3 = [0,0,0]; p[axis]=sign*.5; p[u]=values[i]; p[v]=values[j];
      const q=p.map(n=>clamp(n,-.41,.41)) as Vec3, n=normalize(p.map((x,k)=>x-q[k]) as Vec3);
      return [...q.map((x,k)=>x+n[k]*.09),...n];
    };
    for (let i=0;i<3;i++) for(let j=0;j<3;j++) {
      const a=sample(i,j), b=sample(i+1,j), c=sample(i+1,j+1), d=sample(i,j+1);
      vertices.push(...(sign>0?[...a,...b,...c,...a,...c,...d]:[...a,...c,...b,...a,...d,...c]));
    }
  }
  return new Float32Array(vertices);
}
const vertex = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPosition;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec4 aTile;
uniform mat4 uView; uniform mat4 uLight;
uniform float uTime; uniform float uYaw; uniform float uTilt; uniform float uSelected; uniform float uFloor; uniform float uShift;
out vec3 vNormal; out vec3 vWorld; out vec3 vColor; out vec4 vLight; out float vSelected;
${waveGLSL}
mat3 turn(float a){float c=cos(a),s=sin(a);return mat3(c,0.,-s,0.,1.,0.,s,0.,c);}
void main(){
 vec3 p; vec3 n;
 if(uFloor>.5){p=vec3(aPosition.x*90.,-2.,aPosition.z*90.);n=vec3(0.,1.,0.);vColor=vec3(.9412,.9373,.9176);vSelected=0.;}
 else{
 float x=aTile.x,z=aTile.y,id=aTile.z;
 vec3 wave=surface(x,z,uTime);
 float y=wave.x,dx=wave.y,dz=wave.z;
 vec3 up=normalize(vec3(-dx,1.,-dz)); vec3 right=normalize(vec3(1.,dx,0.));vec3 forward=normalize(cross(right,up));
 mat3 basis=mat3(right,up,forward);
 vSelected=1.-step(.1,abs(id-uSelected));
 float size=.49+.045*sin(id*7.17);
 p=basis*(aPosition*size)+vec3(x,y+vSelected*.24,z);
 mat3 rotation=turn(uYaw);p=rotation*p; p.y+=p.z*uTilt;
 n=normalize(rotation*basis*aNormal);
 float tone=.94+.07*sin(id*3.73);
 vColor=mix(vec3(.79,.49,.39),vec3(.19,.20,.18),smoothstep(-1.,6.,x+sin(z*.35)*2.))*tone;
 }
 vWorld=p;vNormal=n;vLight=uLight*vec4(p,1.);gl_Position=uView*vec4(p,1.);gl_Position.y-=uShift*gl_Position.w;
}`;
const fragment = `#version 300 es
precision highp float;
in vec3 vNormal;in vec3 vWorld;in vec3 vColor;in vec4 vLight;in float vSelected;
uniform sampler2D uShadow;uniform float uFloor;
out vec4 color;
float shadow(){vec3 q=vLight.xyz/vLight.w*.5+.5;if(q.x<0.||q.x>1.||q.y<0.||q.y>1.)return 1.;float s=0.;vec2 pixel=1./vec2(textureSize(uShadow,0));float bias=max(.0004*(1.-dot(normalize(vNormal),normalize(vec3(-.5,1.,.4)))),.00018);for(int x=-1;x<=1;x++)for(int y=-1;y<=1;y++){s+=q.z-bias<=texture(uShadow,q.xy+vec2(x,y)*pixel*1.3).r?1.:0.;}return .52+s/9.*.48;}
void main(){
 vec3 n=normalize(vNormal);float light=max(dot(n,normalize(vec3(-.5,1.,.4))),0.);float shade=shadow();
 vec3 base=pow(vColor,vec3(2.2));
 vec3 lit=base*(.44+light*.76*shade);
 float grain=fract(sin(dot(vWorld.xz,vec2(127.1,311.7)))*43758.5453)-.5;
 lit+=grain*.006;lit=mix(lit,lit+vec3(.14,.08,.03),vSelected*.24);
 vec3 rgb=pow(max(lit,vec3(0.)),vec3(1./2.2));
 vec3 paper=vec3(.9412,.9373,.9176);
 if(uFloor>.5)rgb=paper*(.85+.15*shade);
 float fog=(1.-smoothstep(-15.,3.,vWorld.z))*.68;
 rgb=mix(rgb,paper,fog);color=vec4(rgb,1.);
}`;
const depthFragment = `#version 300 es
precision highp float;out vec4 color;void main(){color=vec4(1.);}`;

export function createComputeField(canvas: HTMLCanvasElement, options: Options): ComputeField | null {
 const gl=canvas.getContext('webgl2',{alpha:false,antialias:true,powerPreference:'low-power',preserveDrawingBuffer:false});
 if(!gl)return createCanvasField(canvas,options);
 const buffers: WebGLBuffer[]=[], programs: WebGLProgram[]=[], shaders: WebGLShader[]=[], vaos: WebGLVertexArrayObject[]=[];
 let shadowTexture: WebGLTexture|null=null, shadowTarget: WebGLFramebuffer|null=null;
 const compile=(kind:number,source:string)=>{const s=gl.createShader(kind);if(!s)throw Error('Shader unavailable');shaders.push(s);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error('Shader compilation failed: '+gl.getShaderInfoLog(s));return s;};
 const program=(frag:string)=>{const p=gl.createProgram();if(!p)throw Error('Program unavailable');programs.push(p);gl.attachShader(p,compile(gl.VERTEX_SHADER,vertex));gl.attachShader(p,compile(gl.FRAGMENT_SHADER,frag));gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error('Program linking failed: '+gl.getProgramInfoLog(p));return p;};
 const destroyResources=()=>{buffers.forEach(b=>gl.deleteBuffer(b));programs.forEach(p=>gl.deleteProgram(p));shaders.forEach(s=>gl.deleteShader(s));vaos.forEach(v=>gl.deleteVertexArray(v));gl.deleteTexture(shadowTexture);gl.deleteFramebuffer(shadowTarget);};
 try {
 const visibleProgram=program(fragment), shadowProgram=program(depthFragment);
 const mobile=window.innerWidth<700;
 const tiles=fieldTiles(mobile).flatMap(([x,z,id])=>[x,z,id,0]);
 const instances=new Float32Array(tiles), mesh=geometry();
 const makeVAO=(data:Float32Array)=>{
  const vao=gl.createVertexArray();if(!vao)throw Error('VAO unavailable');vaos.push(vao);gl.bindVertexArray(vao);
  const buffer=gl.createBuffer();if(!buffer)throw Error('Buffer unavailable');buffers.push(buffer);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,data,gl.STATIC_DRAW);
  for(let i=0;i<2;i++){gl.enableVertexAttribArray(i);gl.vertexAttribPointer(i,3,gl.FLOAT,false,24,i*12);}
  const instanceBuffer=gl.createBuffer();if(!instanceBuffer)throw Error('Instance buffer unavailable');buffers.push(instanceBuffer);gl.bindBuffer(gl.ARRAY_BUFFER,instanceBuffer);gl.bufferData(gl.ARRAY_BUFFER,instances,gl.STATIC_DRAW);gl.enableVertexAttribArray(2);gl.vertexAttribPointer(2,4,gl.FLOAT,false,16,0);gl.vertexAttribDivisor(2,1);return vao;
 };
 const cubeVAO=makeVAO(mesh), floorVAO=makeVAO(new Float32Array([-.5,0,-.5,0,1,0,.5,0,.5,0,1,0,.5,0,-.5,0,1,0,-.5,0,-.5,0,1,0,-.5,0,.5,0,1,0,.5,0,.5,0,1,0]));
 shadowTexture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,shadowTexture);gl.texImage2D(gl.TEXTURE_2D,0,gl.DEPTH_COMPONENT24,1536,1536,0,gl.DEPTH_COMPONENT,gl.UNSIGNED_INT,null);
 gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
 shadowTarget=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,shadowTarget);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.TEXTURE_2D,shadowTexture,0);gl.drawBuffers([gl.NONE]);gl.readBuffer(gl.NONE);
 if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Shadow framebuffer unavailable');
 gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.enable(gl.DEPTH_TEST);
 const lightProjection=new Float32Array([1/26,0,0,0,0,1/22,0,0,0,0,-2/65,0,0,0,-1,1]);
 const light=multiply(lightProjection,lookAt([-15,28,15],[0,0,0]));
 let width=1,height=1,view=new Float32Array(16),shift=.27,frame=0,disposed=false,paused=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
 let inView=true,hidden=document.hidden,time=0,last=0,drawn=0,selected=-1,pointerX=-100,pointerY=-100,dragging=false,downX=0,downY=0,startYaw=0,startTilt=0;
 let yaw=0,tilt=0,targetYaw=0,targetTilt=0,hoverX=0,hoverY=0;
 const uniforms=(p:WebGLProgram,matrix:Float32Array,floor:number,shadow:boolean)=>{
  gl.useProgram(p);gl.uniformMatrix4fv(gl.getUniformLocation(p,'uView'),false,matrix);gl.uniformMatrix4fv(gl.getUniformLocation(p,'uLight'),false,light);
  for(const [name,value] of Object.entries({uTime:time,uYaw:yaw,uTilt:tilt,uSelected:selected,uFloor:floor,uShift:shadow?0:shift}))gl.uniform1f(gl.getUniformLocation(p,name),value);
 };
 const project=(x:number,z:number,id:number)=>{
  let y=surface(x,z,time)[0]+(id===selected?.24:0);
  const xx=Math.cos(yaw)*x+Math.sin(yaw)*z,zz=-Math.sin(yaw)*x+Math.cos(yaw)*z;y+=zz*tilt;
  const w=view[3]*xx+view[7]*y+view[11]*zz+view[15];
  return [((view[0]*xx+view[4]*y+view[8]*zz+view[12])/w*.5+.5)*width,(.5-((view[1]*xx+view[5]*y+view[9]*zz+view[13])/w-shift)*.5)*height,w];
 };
 const pick=()=>{
  let nearest=-1,dist=400;
  if(pointerY>height*.38)for(let i=0;i<instances.length;i+=4){const p=project(instances[i],instances[i+1],instances[i+2]);const d=(p[0]-pointerX)**2+(p[1]-pointerY)**2;if(p[2]>0&&d<dist){dist=d;nearest=instances[i+2];hoverX=p[0];hoverY=p[1];}}
  if(dragging)nearest=-1;
  selected=nearest;

 };
 const draw=()=>{
  pick();gl.bindFramebuffer(gl.FRAMEBUFFER,shadowTarget);gl.viewport(0,0,1536,1536);gl.clear(gl.DEPTH_BUFFER_BIT);uniforms(shadowProgram,light,0,true);gl.bindVertexArray(cubeVAO);gl.drawArraysInstanced(gl.TRIANGLES,0,mesh.length/6,instances.length/4);
  gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,canvas.width,canvas.height);gl.clearColor(.9412,.9373,.9176,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,shadowTexture);
  uniforms(visibleProgram,view,1,false);gl.uniform1i(gl.getUniformLocation(visibleProgram,'uShadow'),0);gl.bindVertexArray(floorVAO);gl.drawArraysInstanced(gl.TRIANGLES,0,6,1);
  uniforms(visibleProgram,view,0,false);gl.bindVertexArray(cubeVAO);gl.drawArraysInstanced(gl.TRIANGLES,0,mesh.length/6,instances.length/4);
 };
 const tick=(stamp:number)=>{
  frame=0;if(disposed||!inView||hidden)return;
  if(stamp-drawn>32){if(!paused)time+=Math.min((stamp-(last||stamp))/1000,.06);last=stamp;drawn=stamp;yaw+=(targetYaw-yaw)*.12;tilt+=(targetTilt-tilt)*.12;draw();}
  if(!paused||Math.abs(targetYaw-yaw)>.001||Math.abs(targetTilt-tilt)>.001)frame=requestAnimationFrame(tick);
 };
 const wake=()=>{if(!frame&&!disposed&&inView&&!hidden)frame=requestAnimationFrame(tick);};
 const resize=()=>{const rect=canvas.getBoundingClientRect();width=Math.max(1,rect.width);height=Math.max(1,rect.height);const dpr=Math.min(window.devicePixelRatio||1,mobile?1.25:1.6);canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);const camera=sceneView(width);shift=camera.shift;view=multiply(perspective(width/height),lookAt(camera.eye,camera.target));wake();};
 const pointerMove=(e:PointerEvent)=>{const rect=canvas.getBoundingClientRect();pointerX=e.clientX-rect.left;pointerY=e.clientY-rect.top;
  if(dragging){targetYaw=clamp(startYaw+(e.clientX-downX)*.0017,-.38,.38);targetTilt=clamp(startTilt+(e.clientY-downY)*.0005,-.10,.10);}
  else if(e.pointerType==='mouse'&&!paused){targetYaw=(pointerX/width-.5)*.08;targetTilt=(pointerY/height-.5)*.025;}
  wake();};
 const pointerDown=(e:PointerEvent)=>{if(e.button!==0)return;dragging=true;downX=e.clientX;downY=e.clientY;startYaw=targetYaw;startTilt=targetTilt;if(e.pointerType==='mouse')canvas.setPointerCapture(e.pointerId);canvas.dataset.dragging='true';wake();};
 const pointerUp=()=>{dragging=false;delete canvas.dataset.dragging;wake();};
 const leave=()=>{pointerX=-100;pointerY=-100;selected=-1;if(!dragging)wake();};
 const key=(e:KeyboardEvent)=>{if(e.ctrlKey||e.metaKey||e.altKey||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home'].includes(e.key))return;e.preventDefault();if(e.key==='Home'){targetYaw=0;targetTilt=0;}else if(e.key==='ArrowLeft')targetYaw=clamp(targetYaw-.05,-.38,.38);else if(e.key==='ArrowRight')targetYaw=clamp(targetYaw+.05,-.38,.38);else if(e.key==='ArrowUp')targetTilt=clamp(targetTilt-.025,-.1,.1);else targetTilt=clamp(targetTilt+.025,-.1,.1);wake();};
 const visibility=()=>{hidden=document.hidden;last=0;if(hidden&&frame){cancelAnimationFrame(frame);frame=0;}else wake();};
 const lost=(e:Event)=>{e.preventDefault();if(frame)cancelAnimationFrame(frame);frame=0;inView=false;options.onReady(false);};
 canvas.addEventListener('pointermove',pointerMove);canvas.addEventListener('pointerdown',pointerDown);canvas.addEventListener('pointerup',pointerUp);canvas.addEventListener('pointercancel',pointerUp);canvas.addEventListener('pointerleave',leave);canvas.addEventListener('keydown',key);canvas.addEventListener('webglcontextlost',lost);document.addEventListener('visibilitychange',visibility);
 const resizeObserver=new ResizeObserver(resize);resizeObserver.observe(canvas);
 const intersection=new IntersectionObserver(([entry])=>{inView=entry.isIntersecting;last=0;if(!inView&&frame){cancelAnimationFrame(frame);frame=0;}else wake();},{rootMargin:'80px'});intersection.observe(canvas);
 resize();draw();canvas.dataset.renderer='webgl2';options.onReady(true);wake();
 return {setPaused(value){paused=value;last=0;wake();},reset(){targetYaw=0;targetTilt=0;pointerX=-100;pointerY=-100;wake();},dispose(){disposed=true;if(frame)cancelAnimationFrame(frame);resizeObserver.disconnect();intersection.disconnect();canvas.removeEventListener('pointermove',pointerMove);canvas.removeEventListener('pointerdown',pointerDown);canvas.removeEventListener('pointerup',pointerUp);canvas.removeEventListener('pointercancel',pointerUp);canvas.removeEventListener('pointerleave',leave);canvas.removeEventListener('keydown',key);canvas.removeEventListener('webglcontextlost',lost);document.removeEventListener('visibilitychange',visibility);destroyResources();}};
 }catch(error){canvas.dataset.renderer='static';console.warn('Perla compute illustration:',error instanceof Error?error.message:'Renderer unavailable');destroyResources();options.onReady(false);return null;}
}
