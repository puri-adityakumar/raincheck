import { useEffect, useRef, useState } from 'react';

/**
 * React port of the user's original WebGL/Bayer-dither fishing diorama.
 * The shader and scene maths are preserved; lifecycle, input and fallbacks are
 * added for a production page. Original source is never modified.
 */

const FRAG = `
precision highp float;
uniform vec2  uRes;
uniform float uTime, uPx, uScale;
uniform vec3  uPal[16];
uniform vec4  uRip[8];   // x, z, startTime, strength
uniform vec4  uFish[4];  // x, z, heading, size
uniform vec3  uMouse;    // x, z, active

const vec3 TARGET = vec3(-0.35, 0.0, 0.25);

float hash(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
float fbm(vec2 p){ float s=0., a=.5; for(int i=0;i<4;i++){ s+=a*noise(p); p=p*2.03+17.1; a*=.5; } return s; }

// Bayer via the recursive trick (no lookup table): values in [0,1)
float bayer2(vec2 a){ a=floor(a); return fract(a.x*.5 + a.y*a.y*.75); }
float bayer4(vec2 a){ return bayer2(.5*a)*.25 + bayer2(a); }
float bayer8(vec2 a){ return bayer4(.5*a)*.25 + bayer2(a); }

float sdBox(vec3 p, vec3 b){ vec3 q=abs(p)-b; return length(max(q,0.))+min(max(q.x,max(q.y,q.z)),0.); }
float sdCap(vec3 p, vec3 a, vec3 b, float r){ vec3 pa=p-a, ba=b-a; float h=clamp(dot(pa,ba)/dot(ba,ba),0.,1.); return length(pa-ba*h)-r; }
float sdCyl(vec3 p, float r, float h){ vec2 d=abs(vec2(length(p.xz),p.y))-vec2(r,h); return min(max(d.x,d.y),0.)+length(max(d,0.)); }

vec3 rodTip(){ return vec3(1.7 + .05*sin(uTime*1.3), 1.55 + .04*sin(uTime*1.7), 1.25); }
vec3 bobber(){ float dip = smoothstep(.0,.15,fract(uTime/5.)) * (1.-smoothstep(.15,.35,fract(uTime/5.)));
  return vec3(1.75, .03*sin(uTime*2.2) - .06*dip, 1.75); }

vec2 opU(vec2 a, vec2 b){ return a.x<b.x ? a : b; }

// materials: 1 deck, 2 post, 3 skin, 4 shirt, 5 white, 6 pants, 7 red, 8 dark line, 9 bucket
vec2 map(vec3 p){
  vec2 r = vec2(1e5, 0.);
  // deck (above water only)
  r = opU(r, vec2(sdBox(p-vec3(-1.45,.36,0.), vec3(2.05,.05,.52)), 1.));
  // posts
  for(int i=0;i<4;i++){
    float x = -3.2 + float(i)*1.2;
    vec3 q = p - vec3(x,.12,0.); q.z = abs(q.z)-.48;
    r = opU(r, vec2(max(sdBox(q, vec3(.07,.30,.07)), -p.y), 2.));
  }
  // side rail beam
  r = opU(r, vec2(sdBox(p-vec3(-1.45,.24,.5), vec3(2.05,.04,.035)), 2.));

  float breath = .012*sin(uTime*2.);
  const float S = 1.25;                       // figure scale (deck top at y=.41)
  // fisherman (sitting at dock end, legs over the edge)
  vec3 f = (p - vec3(.15,.41,.2))/S + vec3(0.,.41,0.);
  vec2 fr = vec2(1e5,0.);
  fr = opU(fr, vec2(sdBox(f-vec3(0.,.58+breath,0.), vec3(.13,.17,.12))-.02, 4.));           // shirt
  fr = opU(fr, vec2(sdBox(f-vec3(.02,.86+breath,0.), vec3(.085,.09,.085))-.015, 3.));      // head
  fr = opU(fr, vec2(sdBox(f-vec3(.02,.97+breath,0.), vec3(.11,.03,.11)), 5.));             // white hat
  fr = opU(fr, vec2(sdBox(f-vec3(.2,.45,0.), vec3(.16,.06,.1))-.01, 6.));                  // thighs
  fr = opU(fr, vec2(sdBox(f-vec3(.36,.28,0.), vec3(.05,.15,.09)), 6.));                    // shins
  fr = opU(fr, vec2(sdBox(f-vec3(.17,.62+breath,.1), vec3(.16,.035,.035)), 4.));          // arm
  fr.x *= S; r = opU(r, fr);
  // rod + line
  vec3 hand = vec3(.15,.41,.2) + S*(vec3(.33,.62,.1)-vec3(0.,.41,0.)) + vec3(0.,breath,0.);
  r = opU(r, vec2(sdCap(p, hand, rodTip(), .025), 8.));
  r = opU(r, vec2(sdCap(p, rodTip(), bobber()+vec3(0.,.05,0.), .01), 8.));
  r = opU(r, vec2(length(p-bobber()-vec3(0.,.05,0.))-.07, 7.));
  // kid with red cap
  vec3 k = (p - vec3(-.55,.41,-.2))/S + vec3(0.,.41,0.);
  float sway = .03*sin(uTime*1.1+1.);
  vec2 kr = vec2(1e5,0.);
  kr = opU(kr, vec2(sdBox(k-vec3(sway*.3,.55,0.), vec3(.1,.13,.09))-.02, 5.));              // tee
  kr = opU(kr, vec2(sdBox(k-vec3(sway,.77,0.), vec3(.075,.075,.075))-.012, 3.));           // head
  kr = opU(kr, vec2(sdBox(k-vec3(sway+.03,.86,0.), vec3(.09,.025,.09)), 7.));              // red cap
  kr = opU(kr, vec2(sdBox(k-vec3(.15,.44,0.), vec3(.13,.05,.08)), 6.));
  kr.x *= S; r = opU(r, kr);
  // bucket
  r = opU(r, vec2(sdCyl(p-vec3(-.9,.52,.25), .11, .11), 9.));
  return r;
}

vec3 calcN(vec3 p){ vec2 e=vec2(.002,0.);
  return normalize(vec3(map(p+e.xyy).x-map(p-e.xyy).x, map(p+e.yxy).x-map(p-e.yxy).x, map(p+e.yyx).x-map(p-e.yyx).x)); }

vec2 march(vec3 ro, vec3 rd, float tmax){
  float t=0.; for(int i=0;i<90;i++){ vec2 h=map(ro+rd*t); if(h.x<.0015) return vec2(t,h.y); t+=h.x; if(t>tmax) break; }
  return vec2(-1.,0.);
}
float shadow(vec3 ro, vec3 rd){
  float s=1., t=.02; for(int i=0;i<40;i++){ float h=map(ro+rd*t).x; s=min(s, 10.*h/t); t+=clamp(h,.02,.25); if(s<.01||t>5.) break; }
  return clamp(s,0.,1.);
}

vec3 matCol(float m, vec3 p, vec3 n){
  if(m<1.5){ // deck planks across x
    float k = p.x*3.4; float id=floor(k); float g=fract(k);
    vec3 c = mix(vec3(.62,.40,.22), vec3(.86,.62,.36), hash(vec2(id,3.))*.8 + .2*fbm(p.xz*vec2(2.,9.)));
    if(n.y<.5) c = vec3(.45,.28,.15);
    if(g<.09 && n.y>.5) c = vec3(.2,.13,.08);
    return c; }
  if(m<2.5) return vec3(.18,.14,.12);
  if(m<3.5) return vec3(.88,.64,.48);
  if(m<4.5) return vec3(.28,.40,.62);
  if(m<5.5) return vec3(.95,.94,.90);
  if(m<6.5) return vec3(.16,.18,.24);
  if(m<7.5) return vec3(.80,.20,.18);
  if(m<8.5) return vec3(.12,.12,.14);
  return vec3(.55,.6,.65);
}

float blobR(vec2 xz){
  float a = atan(xz.y, xz.x);
  vec2 d = vec2(cos(a), sin(a));
  return 3.05 + .75*(fbm(d*1.6+3.)-.5)*2. + .25*noise(d*5.+uTime*.05);
}

vec3 L = normalize(vec3(.55,1.,-.45));

vec3 shadeObj(vec3 p, vec3 rd, float m){
  vec3 n = calcN(p);
  vec3 c = matCol(m,p,n);
  float dif = max(dot(n,L),0.) * shadow(p+n*.01, L);
  float top = .12*max(n.y,0.);
  return c*(.42 + .75*dif + top);
}

vec4 shadeWater(vec3 p, vec3 rd){
  vec2 q = p.xz;
  float r = length(q - vec2(-.3,.35));
  float R = blobR(q - vec2(-.3,.35));
  float alpha = smoothstep(R, R-.55, r);
  // base: animated fbm, deeper toward middle
  float n1 = fbm(q*1.3 + vec2(uTime*.12, -uTime*.07));
  float n2 = fbm(q*3.1 - vec2(uTime*.2, uTime*.05));
  vec3 deep = vec3(.20,.45,.55), mid = vec3(.33,.62,.69), lite = vec3(.62,.84,.87);
  vec3 c = mix(mid, deep, smoothstep(.0,2.5,R-r)*.55 + (n1-.5)*.6);
  float streak = smoothstep(.58,.66, n2*0.6 + n1*0.55);
  c = mix(c, lite, streak*.75);
  // fish (dark shapes under the surface)
  for(int i=0;i<4;i++){
    vec4 f = uFish[i];
    vec2 d = q - f.xy; float ca=cos(f.z), sa=sin(f.z);
    d = vec2(ca*d.x + sa*d.y, -sa*d.x + ca*d.y);
    float wig = .03*sin(uTime*9. + float(i)*2. + d.x*14.);
    float body = length(vec2(d.x, (d.y - wig*step(d.x,0.))*2.6)) - f.w;
    float tail = sdBox(vec3(d.x+f.w*1.15, 0., d.y-wig), vec3(f.w*.25,1.,f.w*.35));
    c = mix(c, vec3(.13,.28,.34), (1.-smoothstep(-.01,.01,min(body,tail)))*.85);
  }
  // ripples
  float ring = 0.;
  for(int i=0;i<8;i++){
    vec4 rp = uRip[i]; float age = uTime - rp.z;
    if(age>0. && age<3.5 && rp.w>0.){
      float d = length(q-rp.xy);
      for(int j=0;j<3;j++){
        float rr = age*.55 - float(j)*.16;
        if(rr>0.) ring += rp.w * exp(-pow((d-rr)*28.,2.)) * (1.-age/3.5) * (1.-float(j)*.3);
      }
    }
  }
  c = mix(c, vec3(.88,.96,.97), clamp(ring,0.,1.));
  // cursor glint
  if(uMouse.z>.5){ float dm = length(q-uMouse.xy); c = mix(c, lite, .35*exp(-dm*dm*9.)); }
  // reflection of the dock / people
  vec3 rr = reflect(rd, vec3(0.,1.,0.));
  vec2 h = march(p+vec3(0.,.01,0.), rr, 4.);
  if(h.x>0.){ vec3 rp = p+rr*h.x; c = mix(c, matCol(h.y, rp, vec3(0.,1.,0.))*.55 + deep*.3, .3); }
  // shadow from the dock
  float sh = shadow(p+vec3(0.,.01,0.), L);
  c *= .62 + .38*sh;
  // foamy lighter rim near the edge
  c = mix(c, lite, smoothstep(.35,.0,R-r)*.35);
  return vec4(c, alpha);
}

void main(){
  // pixelate: every fragment inside a uPx x uPx cell computes the cell centre
  vec2 cell = floor(gl_FragCoord.xy / uPx);
  vec2 frag = (cell + .5) * uPx;
  vec2 uv = (frag - .5*uRes) / (.5*uRes.y) * uScale;

  vec3 fw = normalize(-vec3(1.,.82,1.));
  vec3 rt = normalize(cross(fw, vec3(0.,1.,0.)));
  vec3 up = cross(rt, fw);
  vec3 ro = TARGET + rt*uv.x + up*uv.y - fw*20.;
  vec3 rd = fw;

  vec3 bg = uPal[0];
  vec4 col = vec4(bg, 0.);

  float tw = -ro.y/rd.y;               // analytic water plane y=0
  vec2 h = march(ro, rd, 40.);
  if(h.x>0. && h.x<tw){
    col = vec4(shadeObj(ro+rd*h.x, rd, h.y), 1.);
  } else {
    vec3 pw = ro + rd*tw;
    vec4 w = shadeWater(pw, rd);
    col = w;
    if(h.x>0. && w.a<.5) col = vec4(shadeObj(ro+rd*h.x, rd, h.y), 1.); // posts under a transparent edge
  }

  float th = bayer8(cell);
  // dithered alpha -> scene dissolves into the page like the posts
  if(col.a < th*.98 + .01) { gl_FragColor = vec4(bg,1.); return; }

  // palette quantization with ordered dithering between the 2 nearest colours
  vec3 c = clamp(col.rgb,0.,1.);
  float d1=1e9, d2=1e9; vec3 c1=bg, c2=bg;
  for(int i=1;i<16;i++){
    vec3 pc = uPal[i]; vec3 dv = c-pc; float d = dot(dv,dv*vec3(.9,1.2,.8));
    if(d<d1){ d2=d1; c2=c1; d1=d; c1=pc; } else if(d<d2){ d2=d; c2=pc; }
  }
  float mixT = sqrt(d1) / (sqrt(d1)+sqrt(d2)+1e-5);
  gl_FragColor = vec4(th < mixT ? c2 : c1, 1.);
}`;

const VERT = `attribute vec2 p; void main(){ gl_Position = vec4(p,0.,1.); }`;

const PALETTE = [
  '#fbfbfa', // 0 page
  '#1b1f2a',
  '#3a4150',
  '#6f7a88',
  '#f2efe8', // darks / whites
  '#2f6f80',
  '#4e97a6',
  '#8cc6cd',
  '#d3ecee', // water
  '#3b2516',
  '#7a4e2b',
  '#b98450',
  '#e2b57e', // wood
  '#c2352f',
  '#e3a37f',
  '#3d5b8f', // red, skin, shirt
];

const SCALE = 2.75;
const PIXEL_CSS = 3;

type Fish = {
  cx: number;
  cz: number;
  r: number;
  w: number;
  ph: number;
  s: number;
  x: number;
  z: number;
  a: number;
};

type RendererHandle = {
  setRunning: (running: boolean) => void;
  renderStill: (time?: number) => void;
  destroy: () => void;
};

function compileShader(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Could not create shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(info ?? 'Shader compilation failed');
  }
  return shader;
}

function buildRenderer(
  canvas: HTMLCanvasElement,
  onContextLost: () => void,
): RendererHandle | null {
  let gl: WebGLRenderingContext | null = null;
  try {
    gl = canvas.getContext('webgl', {
      antialias: false,
      preserveDrawingBuffer: true,
      alpha: false,
      powerPreference: 'low-power',
    });
  } catch {
    return null;
  }
  if (!gl) return null;

  const context = gl;
  let program: WebGLProgram | null = null;
  let buffer: WebGLBuffer | null = null;
  let running = false;
  let raf = 0;
  let last = 0;
  let currentTime = 4;
  let lastBob = 0;
  let activeDpr = 1;
  let destroyed = false;

  const mouse = { x: 0, z: 0, active: false };
  const ripples: number[][] = Array.from({ length: 8 }, () => [0, 0, -99, 0]);
  let rippleIndex = 0;
  const fish: Fish[] = [
    { cx: -1.3, cz: 1.6, r: 0.7, w: 0.9, ph: 0, s: 0.13, x: -0.6, z: 1.6, a: 0 },
    { cx: 1.0, cz: -0.9, r: 0.6, w: -0.7, ph: 2, s: 0.11, x: 1.6, z: -0.9, a: 0 },
    { cx: -2.2, cz: -0.4, r: 0.5, w: 1.1, ph: 4, s: 0.1, x: -1.7, z: -0.4, a: 0 },
    { cx: 0.6, cz: 2.1, r: 0.55, w: -1, ph: 1.3, s: 0.12, x: 1.15, z: 2.1, a: 0 },
  ];

  const TARGET = [-0.35, 0, 0.25];
  const norm = (v: number[]) => {
    const length = Math.hypot(...v);
    return v.map((x) => x / length);
  };
  const forward = norm([-1, -0.82, -1]);
  const right = norm([-forward[2], 0, forward[0]]);
  const up = [
    right[1] * forward[2] - right[2] * forward[1],
    right[2] * forward[0] - right[0] * forward[2],
    right[0] * forward[1] - right[1] * forward[0],
  ];

  function toWater(clientX: number, clientY: number): [number, number] {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return [0, 0];
    const u = ((clientX - rect.left - rect.width / 2) / (rect.height / 2)) * SCALE;
    const v = -((clientY - rect.top - rect.height / 2) / (rect.height / 2)) * SCALE;
    const rayOrigin = [0, 1, 2].map(
      (i) => TARGET[i] + right[i] * u + up[i] * v - forward[i] * 20,
    );
    const t = -rayOrigin[1] / forward[1];
    return [rayOrigin[0] + forward[0] * t, rayOrigin[2] + forward[2] * t];
  }

  const uniform = (name: string) => context.getUniformLocation(program!, name);
  const hex = (value: string) => [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);

  function addRipple(x: number, z: number, time: number, strength: number) {
    ripples[rippleIndex] = [x, z, time, strength];
    rippleIndex = (rippleIndex + 1) % 8;
  }

  function stepFish(time: number, dt: number) {
    fish.forEach((item, index) => {
      let tx = item.cx + Math.cos(time * item.w + item.ph) * item.r;
      let tz = item.cz + Math.sin(time * item.w + item.ph) * item.r;
      if (mouse.active) {
        const angle = index * 1.57 + time * 0.6;
        tx = mouse.x + Math.cos(angle) * 0.35;
        tz = mouse.z + Math.sin(angle) * 0.35;
      }
      const dx = tx - item.x;
      const dz = tz - item.z;
      const follow = Math.min(1, dt * (mouse.active ? 2.2 : 3));
      item.x += dx * follow;
      item.z += dz * follow;
      if (Math.hypot(dx, dz) > 1e-3) {
        const want = Math.atan2(dz, dx);
        let delta = want - item.a;
        delta = Math.atan2(Math.sin(delta), Math.cos(delta));
        item.a += delta * Math.min(1, dt * 6);
      }
    });
  }

  function resize() {
    if (destroyed) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, rect.width < 560 ? 1.5 : 2);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      context.viewport(0, 0, width, height);
    }
    activeDpr = dpr;
    draw(currentTime, 0);
  }

  function draw(time: number, dt: number) {
    if (destroyed) return;
    if (time - lastBob > 5) {
      lastBob = Math.floor(time / 5) * 5;
      addRipple(1.75, 1.75, lastBob + 0.55, 0.9);
    }
    stepFish(time, dt);
    currentTime = time;
    context.uniform2f(uniform('uRes'), canvas.width, canvas.height);
    context.uniform1f(uniform('uTime'), time);
    context.uniform1f(
      uniform('uPx'),
      PIXEL_CSS * activeDpr,
    );
    context.uniform1f(uniform('uScale'), SCALE);
    context.uniform4fv(uniform('uRip'), new Float32Array(ripples.flat()));
    context.uniform4fv(
      uniform('uFish'),
      new Float32Array(fish.flatMap((item) => [item.x, item.z, item.a, item.s])),
    );
    context.uniform3f(uniform('uMouse'), mouse.x, mouse.z, mouse.active ? 1 : 0);
    context.drawArrays(context.TRIANGLES, 0, 3);
  }

  function loop(now: number) {
    if (!running || destroyed) return;
    raf = requestAnimationFrame(loop);
    const time = (now - startedAt) / 1000;
    const dt = Math.min(0.05, Math.max(0, time - last));
    last = time;
    draw(time, dt);
  }

  function setRunning(next: boolean) {
    if (destroyed) return;
    if (next === running) return;
    running = next;
    if (running) {
      last = currentTime;
      raf = requestAnimationFrame(loop);
    } else {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  }

  function renderStill(time = Math.max(currentTime, 4)) {
    if (destroyed) return;
    addRipple(1.75, 1.75, time - 1.1, 0.9);
    draw(time, 0.016);
  }

  const startedAt =
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();

  const onPointerMove = (event: PointerEvent) => {
    const [x, z] = toWater(event.clientX, event.clientY);
    mouse.x = x;
    mouse.z = z;
    mouse.active = true;
  };
  const onPointerLeave = () => {
    mouse.active = false;
  };
  const onPointerDown = (event: PointerEvent) => {
    const [x, z] = toWater(event.clientX, event.clientY);
    addRipple(x, z, currentTime, 1);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    const x = mouse.active ? mouse.x : 1.1;
    const z = mouse.active ? mouse.z : 1.4;
    addRipple(x, z, currentTime, 1.25);
  };
  const onLost = (event: Event) => {
    event.preventDefault();
    running = false;
    cancelAnimationFrame(raf);
    onContextLost();
  };

  try {
    const vertex = compileShader(context, context.VERTEX_SHADER, VERT);
    const fragment = compileShader(context, context.FRAGMENT_SHADER, FRAG);
    program = context.createProgram();
    if (!program) throw new Error('Could not create program');
    context.attachShader(program, vertex);
    context.attachShader(program, fragment);
    context.linkProgram(program);
    context.deleteShader(vertex);
    context.deleteShader(fragment);
    if (!context.getProgramParameter(program, context.LINK_STATUS)) {
      throw new Error(context.getProgramInfoLog(program) ?? 'Program link failed');
    }
    context.useProgram(program);
    buffer = context.createBuffer();
    context.bindBuffer(context.ARRAY_BUFFER, buffer);
    context.bufferData(
      context.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      context.STATIC_DRAW,
    );
    const location = context.getAttribLocation(program, 'p');
    context.enableVertexAttribArray(location);
    context.vertexAttribPointer(location, 2, context.FLOAT, false, 0, 0);
    context.uniform3fv(
      uniform('uPal'),
      new Float32Array(PALETTE.flatMap((color) => hex(color))),
    );
    context.clearColor(0.984, 0.984, 0.98, 1);
    context.clear(context.COLOR_BUFFER_BIT);
  } catch {
    context.deleteBuffer(buffer);
    context.deleteProgram(program);
    return null;
  }

  const observer =
    typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => resize()) : null;
  observer?.observe(canvas);
  window.addEventListener('resize', resize);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerleave', onPointerLeave);
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('keydown', onKeyDown);
  canvas.addEventListener('webglcontextlost', onLost);
  resize();

  return {
    setRunning,
    renderStill,
    destroy() {
      destroyed = true;
      running = false;
      cancelAnimationFrame(raf);
      observer?.disconnect();
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('keydown', onKeyDown);
      canvas.removeEventListener('webglcontextlost', onLost);
      context.deleteBuffer(buffer);
      context.deleteProgram(program);
    },
  };
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!query) return;
    setReduced(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener?.('change', onChange);
    return () => query.removeEventListener?.('change', onChange);
  }, []);

  return reduced;
}

export type FishingDioramaProps = {
  className?: string;
  ariaLabel?: string;
};

export function FishingDiorama({
  className = '',
  ariaLabel = 'A small interactive fishing diorama. Move the pointer to guide the fish, click to drop a pebble, or press Enter when focused.',
}: FishingDioramaProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<RendererHandle | null>(null);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const [paused, setPaused] = useState(false);
  const [motionRequested, setMotionRequested] = useState(false);
  const [inView, setInView] = useState(true);
  const [hidden, setHidden] = useState(
    () => typeof document !== 'undefined' && document.visibilityState === 'hidden',
  );
  const prefersReducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    const onVisibility = () => setHidden(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => setInView(entries[0]?.isIntersecting ?? true),
      { threshold: 0.01 },
    );
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = buildRenderer(canvas, () => setFailed(true));
    if (!renderer) {
      setFailed(true);
      return;
    }
    rendererRef.current = renderer;
    setReady(true);
    return () => {
      renderer.destroy();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => { setMotionRequested(false); }, [prefersReducedMotion]);

  const motionPaused = paused || (prefersReducedMotion && !motionRequested);
  const animating = ready && !failed && !motionPaused && inView && !hidden;

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.setRunning(animating);
    if (!animating && motionPaused) {
      renderer.renderStill();
    }
  }, [animating, motionPaused]);

  return (
    <div
      className={`relative overflow-hidden bg-paper ${className}`}
      data-diorama-state={failed ? 'fallback' : ready ? 'ready' : 'loading'}
      data-animation-state={animating ? 'playing' : 'paused'}
    >
      {!failed && (
        <>
          <canvas
            ref={canvasRef}
            className="diorama-canvas block h-full w-full cursor-crosshair bg-paper"
            role="img"
            aria-label={ariaLabel}
            tabIndex={0}
          />
          {!ready && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center bg-paper/95">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
                Waking the dock…
              </p>
            </div>
          )}
          <div className="absolute bottom-2 right-2 flex items-center gap-2">
            {prefersReducedMotion && !motionRequested && (
              <span className="rounded-sm border border-rule bg-paper/90 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.14em] text-ink-soft">
                Still scene
              </span>
            )}
              <button
                type="button"
                onClick={() => {
                  if (motionPaused) { setPaused(false); setMotionRequested(true); }
                  else setPaused(true);
                }}
                className="rounded-sm border border-rule bg-paper/90 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.14em] text-ink-soft transition-colors hover:border-teal hover:text-teal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal"
                aria-label={motionPaused ? 'Play the dock animation' : 'Pause the dock animation'}
                aria-pressed={!motionPaused}
              >
                {motionPaused ? 'Play scene' : 'Pause scene'}
              </button>
          </div>
        </>
      )}

      {failed && (
        <div className="flex aspect-[760/600] w-full items-center justify-center border border-rule bg-paper-warm p-8">
          <div className="max-w-sm text-center">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
              Small plays — fishing
            </p>
            <p className="mt-3 font-pixel text-xl text-ink">The dock is resting.</p>
            <p className="mt-3 text-sm leading-6 text-ink-soft">
              This browser could not start WebGL. Everything else on the page still works
              without the little scene.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
