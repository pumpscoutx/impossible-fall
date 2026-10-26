precision highp float;
precision highp int;

uniform sampler2D uImg;
uniform sampler2D uSem1;
uniform sampler2D uSem2;
uniform sampler2D uSem3;
uniform sampler2D uSem4;
uniform sampler2D uField;
uniform float uP;
uniform float uTime;
uniform float uVel;
uniform float uPulse;
uniform float uFreeze;
uniform float uAspect;
uniform float uImgAspect;
uniform float uQuality;
uniform float uIntensity;
uniform vec2 uPointer;
uniform vec2 uPortal;
uniform vec2 uClick;
uniform float uStarted;
uniform float uStill;
uniform vec3 uAttn;
uniform float uSpeedMode;
uniform vec4 uEvt;

in vec2 vUv;
out vec4 fragColor;

const float PI = 3.141592653589793;
const vec2 WFALL = vec2(0.42, 0.55);

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453123); }

float vnoise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f*f*(3.0-2.0*f);
  float a = hash(i);
  float b = hash(i+vec2(1.0,0.0));
  float c = hash(i+vec2(0.0,1.0));
  float d = hash(i+vec2(1.0,1.0));
  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
}

float fbm(vec2 p, int oct){
  float s = 0.0; float a = 0.5; float t = 0.0;
  for(int i=0;i<5;i++){
    if(i>=oct) break;
    s += a * vnoise(p);
    t += a;
    p *= 2.03; a *= 0.5;
  }
  return s / max(t, 1e-4);
}

vec2 coverUV(vec2 uv){
  float sa = uAspect;
  float ia = uImgAspect;
  vec2 c = uv - 0.5;
  if(sa > ia){
    c.y *= (ia / sa);
  } else {
    c.x *= (sa / ia);
  }
  return c + 0.5;
}

vec4 sem1(vec2 uv){ return texture(uSem1, clamp(uv,0.0,1.0)); }
vec4 sem2(vec2 uv){ return texture(uSem2, clamp(uv,0.0,1.0)); }
vec4 sem3(vec2 uv){ return texture(uSem3, clamp(uv,0.0,1.0)); }
vec4 sem4(vec2 uv){ return texture(uSem4, clamp(uv,0.0,1.0)); }
vec4 field(vec2 uv){ return texture(uField, clamp(uv,0.0,1.0)); }

vec3 sampleImg(vec2 uv){ return texture(uImg, clamp(coverUV(uv),0.0,1.0)).rgb; }

// rock-edge curl turbulence (small secondary detail)
vec2 curlNoise(vec2 p, float t){
  float e = 0.06;
  float n1 = fbm(p + vec2(t*0.05, 0.0), 3);
  float n2 = fbm(p + vec2(e, 0.0) + vec2(t*0.05,0.0), 3);
  float n3 = fbm(p + vec2(0.0, e) + vec2(t*0.05,0.0), 3);
  return vec2(n3 - n1, -(n2 - n1)) / max(e, 1e-3);
}

// main pigment-advection function
vec3 livingWater(vec2 iuv){
  vec2 c = clamp(coverUV(iuv), 0.0, 1.0);
  vec4 s3 = sem3(c);
  vec4 s4 = sem4(c);
  vec4 s1 = sem1(c);
  vec4 s2 = sem2(c);

  float human  = s3.b;
  float matRaw = s3.a;
  float fold   = s4.r;
  float edgeM  = s4.g;
  float highM  = s4.b;
  float blueM  = s4.a;
  float rock   = s1.b;
  float dark   = s1.a;
  float robe   = s1.g;
  float water  = s1.r;
  float rockG  = length(vec2(dFdx(rock), dFdy(rock)));

  // slow modulation of material state toward 0.35..0.65
  float modN = fbm(c*3.0 + vec2(uTime*0.03,0.0), 3);
  float m = clamp(mix(matRaw, mix(0.35, 0.65, modN), 0.35), 0.0, 1.0);

  // flow vector (image-uv, y down)
  vec2 flow = (s3.rg - 0.5) * 2.0;
  float flowLen = length(flow);
  if(flowLen > 1e-4) flow /= max(flowLen, 0.05);

  // base speed
  float baseSpeed = 0.6 + 0.4*uSpeedMode;
  float started = clamp(uStarted, 0.0, 1.0);
  float speedMul = mix(0.08, 1.0, started);
  speedMul *= mix(0.55, 1.35, m);          // liquid (m low) fast, cloth slow
  speedMul *= 1.0 + 0.35*clamp(uVel,0.0,1.0);
  if(uFreeze > 0.5) speedMul = 0.05;

  // reverse-flow event (thin vertical band goes up)
  float revPhase = clamp(uEvt.x, 0.0, 1.0);
  float revEnv = (revPhase > 0.0 && revPhase < 1.0) ? sin(PI*revPhase) : 0.0;
  float bandX = mix(0.35, 0.65, fract(uEvt.w*7.13));
  float revBand = smoothstep(0.05,0.0, abs(c.x - bandX)) * smoothstep(0.25,0.05,c.y) * water;
  // if inside reverse band: override flow to go up
  flow = mix(flow, vec2(0.0, -1.0), revBand * revEnv);

  // gravity graph: stream bends 90deg along a ledge, upward in hidden band
  float gravityAmt = smoothstep(0.20, 0.26, uP);
  if(gravityAmt > 0.001){
    float ledge = smoothstep(0.12,0.0, abs(c.y - 0.42)) * smoothstep(0.35,0.55,c.x) * smoothstep(0.85,0.65,c.x);
    // rotate 90 deg inside ledge
    vec2 rot90 = vec2(flow.y, -flow.x);
    flow = mix(flow, rot90, ledge * gravityAmt * 0.85);
    // upward narrow band hidden between rocks
    float band = smoothstep(0.03,0.0, abs(c.x - 0.72)) * smoothstep(0.55,0.35,c.y) * smoothstep(0.85,0.65,c.y);
    band *= smoothstep(0.3, 0.6, rock) * smoothstep(0.5, 0.3, dark);
    flow = mix(flow, vec2(0.0,-1.0), band * gravityAmt * 0.9);
  }

  // curl turbulence near rock edges
  float rockEdgeAmt = smoothstep(0.15, 0.4, rockG) * (1.0 - rock);
  vec2 curl = curlNoise(c*6.0 + vec2(uTime*0.03), uTime*0.4);
  float turbAmt = mix(0.06, 0.16, uSpeedMode) * (0.5 + 0.5*uVel) * rockEdgeAmt * started;
  turbAmt += (1.0 - m) * 0.02 * started; // liquid edge instability
  flow += curl * turbAmt;
  flowLen = length(flow);
  if(flowLen > 1e-4) flow /= max(flowLen, 0.4);

  // anchoring multiplier
  float anchor = 1.0;
  anchor *= mix(1.0, 0.03, smoothstep(0.4, 0.8, human));    // faces/hands barely move
  float robeSil = smoothstep(0.7, 0.95, m) * (1.0 - smoothstep(0.25, 0.55, highM));
  anchor *= mix(1.0, 0.22, robeSil);                          // robe silhouettes
  anchor *= mix(1.0, 0.5, highM * smoothstep(0.55,0.85,m));   // robe highlights
  // foam/water: full anchor
  float liquidW = (1.0 - m) * water;
  anchor *= mix(1.0, 1.0, liquidW);
  // rocks: zero displacement
  anchor *= 1.0 - smoothstep(0.35, 0.7, rock);

  // increase anchor for figure emergent event
  float figPhase = clamp(uEvt.y, 0.0, 1.0);
  float figEnv = (figPhase > 0.0 && figPhase < 1.0) ? sin(PI*figPhase) : 0.0;
  float figRegion = smoothstep(0.06,0.0, distance(c, vec2(mix(0.3,0.7,fract(uEvt.w*3.71)), 0.68))) * robe;
  if(figPhase > 0.0 && figPhase < 0.5){
    anchor = mix(anchor, 1.0, figRegion * figEnv * 0.7);
  } else if(figPhase > 0.5 && figPhase < 1.0){
    anchor = mix(anchor, 0.0, figRegion * figEnv * 0.85);
  }

  // stillness: robe motion fades, water continues (handled by anchor via robeSil reduction)
  float stillBoost = smoothstep(10.0, 15.0, uStill);
  anchor = mix(anchor, 1.0, stillBoost * robeSil * 0.5); // water flows through robes
  anchor = 1.0 - (1.0 - anchor) * (1.0 - stillBoost * 0.3 * robeSil);

  // observation
  if(uAttn.z > 2.0){
    vec2 mirrored = vec2(1.0 - uAttn.x, 0.5 - (uAttn.y - 0.5));
    float distPer = distance(c, mirrored);
    // z 2-4: waterfall fold shift
    float foldShift = smoothstep(2.0,4.0,uAttn.z) * (1.0 - smoothstep(4.0,5.0,uAttn.z));
    float wfMask = smoothstep(0.12,0.0, distance(c, WFALL)) * water;
    flow.y += foldShift * wfMask * 0.5;
    // z 4-6: nearest dark opening deepens (darken + inward zoom handled outside)
    float darkDeep = smoothstep(4.0,6.0,uAttn.z) * (1.0 - smoothstep(6.0,7.0,uAttn.z));
    // z > 6: figure dissolves toward water - lower anchor
    float figDissolve = smoothstep(6.0,8.0,uAttn.z);
    anchor = mix(anchor, 0.3, figDissolve * robe * smoothstep(0.08,0.0,distPer));
    // use darkDeep externally via metadata read - store via slight anchor change
    anchor = mix(anchor, 0.95, darkDeep * smoothstep(0.15,0.0,distPer) * dark);
  }

  // column transformation: uP 0.36 - 0.50, robe -> stone column
  float colW = smoothstep(0.36,0.42,uP) * (1.0 - smoothstep(0.46,0.50,uP));
  float colRegion = smoothstep(0.15,0.05, distance(c, vec2(0.58, 0.45))) * robe;
  if(colW > 0.001 && colRegion > 0.001){
    flow = mix(flow, vec2(0.0, 1.0), colRegion * colW);
    anchor = mix(anchor, anchor * 0.4, colRegion * colW);
  }

  // ambient mist subtle
  float mist = smoothstep(0.7, 0.9, highM) * water * 0.02 * started;

  // classic flow-map two-phase sampling with hidden loop
  vec2 adv = flow * anchor;
  float maxOff = 0.012;
  float nm1 = fbm(c*8.0 + vec2(uTime*0.11, 0.0), 3) - 0.5;
  float nm2 = fbm(c*5.0 - vec2(uTime*0.08, 0.0), 3) - 0.5;
  vec2 noiseOff = vec2(nm1, nm2) * 0.008;

  float speed = baseSpeed * speedMul;
  float phase0 = fract(uTime * speed * 0.35);
  float phase1 = fract(uTime * speed * 0.35 + 0.5);
  float w0 = abs(1.0 - 2.0 * phase0);
  float w1 = abs(1.0 - 2.0 * phase1);

  // advection per-category: details, highlights x2, shadows x0.4
  float advScaleDet = mix(0.6, 1.0, m); // liquid faster
  float advScaleHi = mix(1.2, 2.0, 1.0 - m);
  float advScaleSh = 0.4;

  // low frequency (blurred)
  vec3 low = textureLod(uImg, c, 4.0).rgb;

  // two-phase samples of pigment
  vec2 off0 = adv * maxOff * phase0 * advScaleDet + noiseOff * phase0;
  vec2 off1 = adv * maxOff * phase1 * advScaleDet + noiseOff * phase1;
  vec2 uv0 = clamp(c + off0, 0.0, 1.0);
  vec2 uv1 = clamp(c + off1, 0.0, 1.0);

  // highlights & shadows biases
  vec2 hOff = flow * maxOff * (0.5 + phase0) * anchor * advScaleHi * 0.35;
  vec2 sOff = flow * maxOff * (0.5 + phase1) * anchor * advScaleSh * 0.6;

  vec3 full0 = texture(uImg, clamp(uv0 + hOff + sOff, 0.0, 1.0)).rgb;
  vec3 full1 = texture(uImg, clamp(uv1 - hOff - sOff, 0.0, 1.0)).rgb;

  // detail separation
  vec3 det0 = full0 - low;
  vec3 det1 = full1 - low;
  vec3 detail = mix(det0, det1, 0.5);

  // recompose
  vec3 col = low + detail;

  // dissolve event -> toward blurred low-freq
  if(figPhase > 0.5 && figPhase < 1.0){
    float figDiss = smoothstep(0.5, 1.0, figPhase) * figRegion * 0.7;
    col = mix(col, low, figDiss);
  }

  // robe-edge mist event
  float mistPhase = clamp(uEvt.z, 0.0, 1.0);
  float mistEnv = (mistPhase > 0.0 && mistPhase < 1.0) ? sin(PI*mistPhase) : 0.0;
  if(mistEnv > 0.001){
    float mistPatch = smoothstep(0.05,0.0, distance(c, vec2(mix(0.25,0.75,fract(uEvt.w*5.37)), 0.35)));
    float mistMask = edgeM * smoothstep(0.6,0.85,m) * mistPatch * mistEnv;
    vec2 nOff = vec2(fbm(c*12.0 + uTime*0.3, 3), fbm(c*12.0 - uTime*0.25, 3)) * 0.04;
    vec3 mistCol = textureLod(uImg, clamp(c + nOff, 0.0, 1.0), 3.0).rgb;
    col = mix(col, col*0.6 + mistCol*0.7 + vec3(0.3,0.3,0.28)*0.4, mistMask * 0.5);
  }

  // column: vertical groove shading + slight desaturation toward nearby rock
  if(colW > 0.001 && colRegion > 0.001){
    float grooves = sin(c.x * 90.0) * 0.5 + 0.5;
    grooves *= smoothstep(0.2, 0.7, blueM);
    col *= mix(1.0, 0.85 + grooves*0.15, colRegion * colW * 0.6);
    vec3 rockSample = texture(uImg, clamp(c + vec2(0.15,0.0),0.0,1.0)).rgb;
    float lum = dot(col, vec3(0.33));
    vec3 rockLum = rockSample * (lum / max(dot(rockSample, vec3(0.33)), 0.1));
    col = mix(col, mix(col, rockLum, 0.4), colRegion * colW * 0.35);
  }

  // fold shading for cloth (subtle darkening along fold lines)
  float foldShade = (fold - 0.5) * smoothstep(0.5, 0.85, m);
  col *= 1.0 - foldShade * 0.12 * (0.6 + 0.4*uSpeedMode);

  // mist veil for fast mode (from painting's own white)
  float veil = smoothstep(0.7, 0.9, highM) * uSpeedMode * 0.04 * water;
  col = mix(col, vec3(0.92, 0.92, 0.9), veil);

  return col;
}

// process order: extract darkening / inward zoom from observation metadata
float attnDarkDeep = 0.0;
vec2  attnZoomDir = vec2(0.0);
float attnZoomAmt = 0.0;

void main(){
  vec2 uv = vUv;
  vec2 sUv = uv;

  float p = clamp(uP, 0.0, 1.0);
  float I = max(uIntensity, 0.0);
  float vel = clamp(uVel, 0.0, 1.0);
  float pulse = clamp(uPulse, 0.0, 1.0);

  // ---- chapter weights ----
  float chCalm   = 1.0 - smoothstep(0.02, 0.06, p);
  float chDepth  = smoothstep(0.05,0.12,p) * (1.0-smoothstep(0.24,0.30,p));
  float chLiquid = smoothstep(0.16,0.22,p) * (1.0-smoothstep(0.36,0.42,p));
  float chDescent= smoothstep(0.30,0.38,p) * (1.0-smoothstep(0.44,0.50,p));
  float chRot    = smoothstep(0.44,0.50,p) * (1.0-smoothstep(0.54,0.58,p));
  float chPortal = smoothstep(0.54,0.60,p) * (1.0-smoothstep(0.64,0.68,p));
  float chGallery= smoothstep(0.62,0.66,p) * (1.0-smoothstep(0.74,0.78,p));
  float chLiving = smoothstep(0.72,0.76,p) * (1.0-smoothstep(0.84,0.88,p));
  float chFrac   = smoothstep(0.82,0.86,p) * (1.0-smoothstep(0.90,0.93,p));
  float chRecon  = smoothstep(0.90,0.94,p);

  float stillT = uStill;
  float breathFade = 1.0 - smoothstep(10.0, 15.0, stillT);
  float distanceBreath = smoothstep(15.0, 20.0, stillT); // one distant figure resumes

  // ---- click ripple ----
  float cd = distance(sUv, uClick);
  float ripple = sin(cd*40.0 - uTime*6.0) * exp(-cd*8.0) * pulse * 0.02 * I;
  sUv += vec2(ripple);

  // ---- field interaction ----
  vec4 fld = field(sUv);
  vec2 fDisp = (fld.rg - 0.5) * 2.0;
  float fEnergyL = fld.b;
  float fEnergyC = fld.a;

  // masks at nominal
  vec2 baseC = clamp(coverUV(sUv),0.0,1.0);
  vec4 bs1 = sem1(baseC);
  vec4 bs2 = sem2(baseC);
  vec4 bs3 = sem3(baseC);
  float bDepth = bs2.r;
  float bSky = bs2.g;
  float bWater = bs1.r;
  float bRobe = bs1.g;
  float bRock = bs1.b;
  float bDark = bs1.a;
  float bM = bs3.a;

  vec2 sampleUv = sUv;

  // ---- CALM ----
  if(chCalm > 0.001){
    float drift = fbm(sampleUv*3.0 + vec2(uTime*0.02, 0.0), 4) * 0.015 * I * chCalm;
    sampleUv.x += drift * bSky;
    float flow = fract(sampleUv.y*30.0 - uTime*(1.0-uFreeze)*1.2);
    sampleUv.y += (flow-0.5)*0.003 * bWater * I * chCalm;
    sampleUv += uPointer * (bDepth - 0.5) * 0.004 * sin(uTime*0.6) * I * chCalm;
  }

  // ---- DEPTH ----
  if(chDepth > 0.001){
    float k = chDepth * 0.09 * I;
    float rev = smoothstep(0.15, 0.25, p);
    k *= mix(1.0, -1.0, rev);
    vec2 off = uPointer * (bDepth - 0.5) * k;
    sampleUv += off * (0.7 + 0.6*bDepth);
    // speed mode parallax
    sampleUv += off * uSpeedMode * 0.15;
  }

  // ---- LIQUID / FABRIC ----
  float shadeVal = 0.0;
  if(chLiquid > 0.001){
    vec2 c = clamp(coverUV(sampleUv),0.0,1.0);
    vec4 s1 = sem1(c);
    vec4 s3 = sem3(c);
    vec4 s4 = sem4(c);
    float w = s1.r; float r = s1.g; float rk = s1.b;
    float m = s3.a;
    float cloth = smoothstep(0.5, 0.9, m);
    float liq = 1.0 - cloth;
    float fold = s4.r;
    float hiM = s4.b;

    // water: refraction + concentric micro ripples + specular glint
    vec2 waterDisp = vec2(0.0);
    float wfStreak = (vnoise(vec2(sampleUv.x*80.0, sampleUv.y*20.0 - uTime*(1.0-uFreeze)*4.0))-0.5);
    waterDisp.y += wfStreak * 0.020 * w * I;
    vec2 pw = WFALL;
    float dW = distance(sampleUv, pw);
    float waterRipple = sin(dW*60.0 - uTime*8.0)*exp(-dW*6.0) * 0.012 * w * I;
    waterDisp.y += waterRipple;

    // field interaction over liquid
    float liquidF = liq * w;
    waterDisp += fDisp * 0.06 * liquidF * I;
    // concentric micro ripples around cursor
    float cDist = length(sUv - uPointer);
    float microRip = sin(cDist*50.0 - uTime*8.0) * exp(-cDist*5.0) * fEnergyL * 0.02;
    waterDisp += normalize(sUv - uPointer + 1e-4) * microRip;

    // cloth: broader fold displacement + fold-like sinusoid
    float folds = sin(sampleUv.y*18.0 + fbm(sampleUv*2.0,3)*3.0) * 0.6 + 0.4;
    vec2 clothDisp = vec2(0.0, (folds - 0.5) * 0.018 * r * I);
    clothDisp += fDisp * 0.08 * cloth * fEnergyC;
    // fold-line sinusoid shading
    float foldLine = sin(sampleUv.x*40.0 + sampleUv.y*12.0 + fbm(sampleUv*3.0,2)*4.0);
    foldLine = smoothstep(0.7, 1.0, abs(foldLine));
    shadeVal -= foldLine * 0.06 * (0.6 + 0.4*uSpeedMode);

    vec2 disp = waterDisp * liq + clothDisp * cloth;
    sampleUv += disp * (w + r) * 0.8;

    // fake normal shading for cloth highlights
    float n1 = fbm(sampleUv*10.0, 3);
    float n2 = fbm(sampleUv*10.0 + vec2(0.01,0.0), 3);
    float n3 = fbm(sampleUv*10.0 + vec2(0.0,0.01), 3);
    vec2 grad = vec2(n2-n1, n3-n1);
    shadeVal += dot(grad, normalize(vec2(0.3,0.9)+1e-3)) * 0.5 * cloth;
  }

  // ---- DESCENT ----
  if(chDescent > 0.001){
    float z = 1.0 + chDescent * 2.5 * I;
    vec2 c = WFALL;
    vec2 d = sampleUv - c;
    float zl = mix(z, z*1.4, bDepth);
    sampleUv = c + d / zl;
    float mist = fbm(sampleUv*4.0 + uTime*0.1, 4) * (bWater*0.8 + bDepth*0.2) * chDescent * 0.3 * I;
    float dro = vnoise(vec2(sampleUv.x*120.0, sampleUv.y*10.0 - uTime*6.0));
    dro = pow(dro, 8.0) * chDescent * I;
    sampleUv.y -= dro * 0.012;
  }

  // ---- GRAVITY ROTATION (monotonic, holds at 90 deg) ----
  if(chRot > 0.001 || p > 0.44){
    float rotAmt = smoothstep(0.44, 0.54, p); // holds at 1 through chRot end and into portal
    // rotation continues holding 90deg until portal fully covers
    float ang = rotAmt * (PI*0.5) * I;
    vec2 c = vec2(0.5,0.5);
    vec2 d = sampleUv - c;
    float ca = cos(ang), sa = sin(ang);
    sampleUv = c + vec2(d.x*ca - d.y*sa, d.x*sa + d.y*ca);
  }

  // ---- PORTAL ----
  if(chPortal > 0.001){
    vec2 c = uPortal;
    float z = 1.0 + chPortal * 5.0 * I;
    vec2 d = sampleUv - c;
    sampleUv = c + d / z;
  }

  // ---- observation z 4-6: darkening/zoom on nearest dark opening ----
  float attnDarken = 0.0;
  if(uAttn.z > 4.0){
    vec2 mirrored = vec2(1.0 - uAttn.x, 0.5 - (uAttn.y - 0.5));
    float near = smoothstep(0.14, 0.0, distance(baseC, mirrored)) * smoothstep(0.4,0.7, bDark);
    attnDarken = near * smoothstep(4.0,6.0,uAttn.z) * (1.0 - smoothstep(6.0,8.0,uAttn.z));
  }

  // ---- main scene sample via livingWater ----
  vec3 col;
  if(p < 0.86){
    col = livingWater(sampleUv);
  } else {
    col = sampleImg(sampleUv);
  }

  // apply observation darkening
  col *= 1.0 - attnDarken * 0.35;

  // resample masks
  vec2 cUv = clamp(coverUV(sampleUv), 0.0, 1.0);
  vec4 f1 = sem1(cUv);
  vec4 f2 = sem2(cUv);
  float dDepth = f2.r;
  float dSky = f2.g;
  float dEdges = f2.b;
  float dWater = f1.r;
  float dRobe = f1.g;
  float dRock = f1.b;
  float dDark = f1.a;

  // liquid/cloth shading
  if(chLiquid > 0.001){
    float mask = clamp(dWater + dRobe, 0.0, 1.0);
    col += shadeVal * mask * 0.18 * I * chLiquid;
  }

  // ---- PORTAL tunnel with painterly stone ----
  if(chPortal > 0.001){
    float dkMask = smoothstep(0.25, 0.55, dDark);
    if(dkMask > 0.001){
      vec2 c = uPortal;
      vec3 tcol = vec3(0.0);
      float tw = 0.0;
      float rot = 0.0;
      vec2 luv = sampleUv;
      for(int i=0;i<8;i++){
        float fi = float(i);
        if(fi >= 6.0) break;
        float s = 1.0 / (1.0 + fi*0.9);
        rot += 0.10;
        vec2 ld = luv - c;
        float lc = cos(rot), ls = sin(rot);
        vec2 lp = c + vec2(ld.x*lc - ld.y*ls, ld.x*ls + ld.y*lc) * s;
        vec3 tc = texture(uImg, clamp(coverUV(lp),0.0,1.0)).rgb;
        float f = pow(1.0 - fi*0.14, 2.0);
        float fog = exp(-fi*0.55);
        tcol += tc * f * fog;
        tw += f * fog;
      }
      tcol /= max(tw, 1e-3);
      float dust = pow(vnoise(sampleUv*40.0 + uTime*0.4), 12.0);
      tcol += dust * 0.15;
      // painterly stone background instead of flat black
      vec2 stoneUv = clamp(coverUV(sampleUv*0.7 + vec2(0.31,0.72)), 0.0, 1.0);
      vec3 stoneTex = texture(uImg, stoneUv).rgb * 0.35;
      float stoneNoise = fbm(sampleUv*8.0, 3);
      stoneTex = mix(stoneTex, stoneTex*1.3, stoneNoise);
      tcol = mix(stoneTex, tcol, 0.7);
      float mixw = chPortal * dkMask;
      col = mix(col, tcol * 0.6, mixw);
    }
    // painterly frame border: eroded soft edges of dark interior
    float frameMask = smoothstep(0.30, 0.48, dDark) * (1.0 - smoothstep(0.48, 0.62, dDark));
    float erode = fbm(cUv*14.0 + uTime*0.05, 3);
    float soften = smoothstep(0.35, 0.65, erode);
    // sample rock texture from nearby bRock area for frame
    vec2 rockOffset = vec2(erode - 0.5, fbm(cUv*9.0+3.1,2) - 0.5) * 0.08;
    vec2 frameSampleUv = clamp(coverUV(sampleUv + rockOffset), 0.0, 1.0);
    vec3 frameCol = texture(uImg, frameSampleUv).rgb;
    float frameW = frameMask * (1.0 - soften) * chPortal * 0.8;
    col = mix(col, frameCol * 0.85, frameW);
  }

  // ---- GALLERY (painterly stone frames, no hard black rect) ----
  if(chGallery > 0.001){
    // painterly dark stone background from painting, not flat black
    vec2 stoneUv = clamp(coverUV(sampleUv*0.55 + vec2(0.42, 0.31)), 0.0, 1.0);
    vec3 stoneBg = texture(uImg, stoneUv).rgb * 0.28;
    float bgNoise = fbm(sampleUv*7.0, 3);
    stoneBg = mix(stoneBg, stoneBg*1.4, bgNoise);
    stoneBg *= 0.6 + 0.4*bgNoise;

    vec2 target = vec2(0.35, -0.2);
    vec2 alignDelta = uPointer - target;
    float aligned = smoothstep(0.35, 0.05, length(alignDelta));
    float pAlign = smoothstep(0.62, 0.72, p);
    float alignAmt = max(aligned, pAlign*0.8);

    float cells = 12.0;
    vec3 galleryCol = stoneBg;
    bool hit = false;
    for(int i=0;i<14;i++){
      float fi = float(i);
      if(fi >= cells) break;
      float fx = hash(vec2(fi, 1.7));
      float fy = hash(vec2(fi, 3.3));
      float fz = hash(vec2(fi, 5.1));
      float fsx = hash(vec2(fi, 7.9));
      float fsy = hash(vec2(fi, 9.3));
      float fd = 0.2 + fz * 0.8;
      vec2 disp = alignDelta * fd * 0.5 * chGallery * (1.0 - alignAmt*0.9);
      disp += vec2(sin(uTime*0.3 + fi*1.7), cos(uTime*0.25 + fi*2.3)) * 0.01 * chGallery;
      float gx = fract(fi / 4.0);
      float gy = floor(fi / 4.0) / 3.0;
      vec2 home = vec2(0.1 + gx*0.7, 0.15 + gy*0.6);
      vec2 fcenter = mix(home + disp, home, alignAmt);
      vec2 fsize = vec2(0.14 + fsx*0.10, 0.12 + fsy*0.10);
      float fr = (hash(vec2(fi, 11.1))-0.5) * 0.3 * chGallery * (1.0-alignAmt);
      vec2 rel = sampleUv - fcenter;
      float cr = cos(fr), sr = sin(fr);
      vec2 rrel = vec2(rel.x*cr - rel.y*sr, rel.x*sr + rel.y*cr);
      vec2 frel = rrel / fsize;
      // irregular painterly frame border using noise erosion
      float ng = fbm(sampleUv*18.0 + fi*2.3, 2);
      float borderErode = 0.92 + 0.06*ng;
      float inside = step(abs(frel.x), borderErode) * step(abs(frel.y), borderErode);
      if(inside > 0.5 && !hit){
        vec2 fuv = home + frel * fsize * 0.5;
        vec2 fCc = clamp(coverUV(fuv), 0.0, 1.0);
        vec3 fc = texture(uImg, fCc).rgb;
        // soft painterly edge light (irregular)
        float edgeD = max(abs(frel.x), abs(frel.y));
        float edge = smoothstep(0.85, borderErode, edgeD) * (0.7 + 0.3*ng);
        fc += edge * vec3(1.0, 0.85, 0.6) * 0.2;
        galleryCol = fc;
        hit = true;
      }
    }
    // also add painterly stone outside cells (background already stoneBg)
    col = mix(col, galleryCol, chGallery);
    col = mix(col, stoneBg, 0.10 * chGallery);
  }

  // ---- LIVING FIGURES with breathing procession, stillness, distant figure ----
  if(chLiving > 0.001 || stillT > 0.5){
    // breathing: scaleY +-0.3% about figure bottom + horizontal sway, cell-based phase
    float cellW = 0.08;
    float cellX = floor(cUv.x / cellW);
    float cellPhase = hash(vec2(cellX, 11.1)) * 6.28;
    float breathPeriod = 6.0 + hash(vec2(cellX, 22.2)) * 6.0;
    float breathCyc = uTime * (6.283 / breathPeriod) + cellPhase;
    float breathAmp = 0.003 * breathFade;
    float swayAmp = 0.0015 * breathFade * (1.0 + 0.5*vel);

    // distant figure attention: one small cell in upper part
    vec2 distantCell = vec2(floor(mix(0.25,0.75,fract(uEvt.w*9.13))/cellW), 0.0);
    float isDistant = step(abs(cellX - distantCell.x), 0.5);
    float distantBoost = distanceBreath * isDistant * 2.0;
    breathAmp *= 1.0 + distantBoost;
    swayAmp *= 1.0 + distantBoost;

    // figure emerge/dissolve local contrast & edge stabilisation
    float figPhase = clamp(uEvt.y, 0.0, 1.0);
    float figEnv = (figPhase > 0.0 && figPhase < 1.0) ? sin(PI*figPhase) : 0.0;
    vec2 figCenter = vec2(mix(0.3,0.7,fract(uEvt.w*3.71)), 0.68);
    float figRegion = smoothstep(0.10, 0.0, distance(cUv, figCenter)) * f1.g;

    // breathing displacement (about the figure bottom ~ cUv.y where robe starts)
    float figureBottomApprox = 0.85;
    float breathY = (cUv.y - figureBottomApprox) * breathAmp * 2.0;
    float sway = sin(breathCyc) * swayAmp;
    float rmask = f1.g;
    sampleUv.y += breathY * rmask;
    sampleUv.x += sway * rmask;

    // stillness: water continues through robes
    if(stillT > 10.0){
      vec2 rOff = vec2(0.0);
      float boost = smoothstep(10.0, 15.0, stillT);
      float wfStreak = (vnoise(vec2(sampleUv.x*80.0, sampleUv.y*20.0 - uTime*4.0))-0.5);
      rOff.y += wfStreak * 0.006 * rmask * boost;
      sampleUv += rOff;
    }

    vec4 s1b = sem1(clamp(coverUV(sampleUv),0.0,1.0));
    float rmask2 = s1b.g;
    // edge highlight disappears on stillness mostly
    float e = f2.b;
    vec3 colBase = (p < 0.86) ? col : sampleImg(sampleUv);
    col = mix(colBase, sampleImg(sampleUv), chLiving * (0.5 + 0.5*chLiving));
    col += e * rmask2 * vec3(1.0,0.95,0.8) * 0.18 * I * chLiving * breathFade;

    // figure emerge: contact shadow + local contrast
    if(figEnv > 0.001){
      col = mix(col, col * 1.15, figRegion * figEnv * 0.4);
      // edge stabilisation for emerging
      if(figPhase < 0.5){
        float edgeStab = figEnv * figRegion * f2.b;
        col = mix(col, col * 1.2 + vec3(0.05), edgeStab * 0.3);
      }
    }
  }

  // ---- FRACTURE (no hue shift) ----
  if(chFrac > 0.001){
    float cellSize = (uQuality >= 2.0) ? (1.0/70.0) : (1.0/55.0);
    vec2 cellId = floor(sUv / cellSize);
    vec2 cellLocal = fract(sUv / cellSize) - 0.5;
    float turbBase = 0.05 * chFrac * I;
    float turb = turbBase * (0.5 + vel*0.5);
    vec2 nv = vec2(
      fbm(cellId*0.05 + 1.0, 4) - 0.5,
      fbm(cellId*0.05 + 5.0, 4) - 0.5
    );
    vec2 hj = vec2(hash(cellId+3.1),hash(cellId+7.7))-0.5;
    nv = nv*1.6 + hj*0.5;
    vec2 scatter = nv * turb;
    vec2 pUv = clamp(coverUV(uPointer*0.5+0.5), 0.0, 1.0);
    float pd = distance(cellId*cellSize, pUv);
    float push = exp(-pd*8.0) * 0.06 * chFrac * I;
    vec2 away = normalize(cellId*cellSize - pUv + vec2(1e-4));
    scatter += away * push;
    float shrink = 0.5 - 0.12*chFrac*(0.4+hash(cellId+1.3));
    float gapMask = step(shrink, max(abs(cellLocal.x),abs(cellLocal.y)));
    vec2 scatteredUv = sUv + scatter;
    vec2 sCc = clamp(coverUV(scatteredUv),0.0,1.0);
    vec3 cellCol = texture(uImg, sCc).rgb;
    // painterly dark from painting, no flat
    vec2 stoneUv = clamp(coverUV(cellId*cellSize*0.7 + 0.15), 0.0, 1.0);
    vec3 darkBg = texture(uImg, stoneUv).rgb * 0.22;
    col = mix(cellCol*(0.85+0.3*hash(cellId)), darkBg, gapMask);
    // NO chromatic aberration (hue shift). Only brightness at edges.
    float ex = smoothstep(0.42, 0.5, abs(cellLocal.x));
    float ey = smoothstep(0.42, 0.5, abs(cellLocal.y));
    float edgeW = max(ex, ey);
    col *= 1.0 - edgeW * 0.1 * chFrac * I;
    sampleUv = scatteredUv;
    cUv = sCc;
    f1 = sem1(cUv);
    f2 = sem2(cUv);
    dDark = f1.a;
    dRock = f1.b;
    dSky = f2.g;
    dWater = f1.r;
  }

  // ---- RECONSTRUCTION ----
  if(chRecon > 0.001){
    vec2 rUv = sampleUv;
    float upFlow = fract(rUv.y*30.0 + uTime*(1.0-uFreeze)*1.5);
    float wf = f1.r;
    rUv.y += (upFlow-0.5)*0.006 * wf * I * chRecon;
    float drift = fbm(rUv*3.0 - vec2(uTime*0.03,0.0), 4)*0.02*I*dSky*chRecon;
    rUv.x += drift;
    vec2 rCc = clamp(coverUV(rUv),0.0,1.0);
    vec3 rCol = texture(uImg, rCc).rgb;
    col = mix(col, rCol, chRecon);
    vec2 portalC = uPortal;
    vec2 mirrorC = vec2(1.0 - portalC.x, portalC.y);
    float md = distance(rCc, mirrorC);
    vec4 mSem1 = sem1(rCc);
    float mRock = mSem1.b;
    if(md < 0.18 && mRock > 0.15){
      vec2 portalSample = vec2(mirrorC.x, mirrorC.y);
      vec3 pcol = texture(uImg, clamp(coverUV(portalSample),0.0,1.0)).rgb;
      float darkArch = 1.0 - smoothstep(0.0, 0.06, distance(rCc, mirrorC));
      float mixw = smoothstep(0.18,0.04,md) * darkArch * chRecon;
      col = mix(col, pcol * 0.35, mixw * 0.9);
    }
  }

  // ---- painterly micro particles ----
  {
    float energyField = field(sUv).b;
    float particleAmt = (0.25 + 0.6*vel + 0.3*energyField) * smoothstep(0.0, 0.3, uStarted);
    // restrict to water region
    float wmask = smoothstep(0.4, 0.75, bWater);
    // sparse: probability via cell hashing
    vec2 pCell = floor(sUv * vec2(160.0, 220.0));
    float ph = hash(pCell);
    if(ph < 0.06 * particleAmt * wmask){
      vec2 pLocal = fract(sUv * vec2(160.0, 220.0));
      // brush-stroke elongated shape
      vec2 strokeDir = normalize(vec2(0.3, 1.0) + vec2(sin(uTime*0.3 + ph*10.0), 0.0));
      float along = dot(pLocal - 0.5, strokeDir);
      float across = dot(pLocal - 0.5, vec2(-strokeDir.y, strokeDir.x));
      float strokeShape = smoothstep(0.25, 0.0, abs(across)) * smoothstep(0.4, 0.0, abs(along));
      // drift with time + energy
      vec2 drift = vec2(0.0, uTime * (0.5 + energyField*2.0) * 0.02);
      vec2 pUv = clamp(coverUV(sUv + drift), 0.0, 1.0);
      vec3 pcCol = texture(uImg, pUv).rgb;
      // bias toward white (waterfall foam)
      float whiteBias = smoothstep(0.6, 0.9, dot(pcCol, vec3(0.33)));
      pcCol = mix(pcCol, vec3(0.95,0.94,0.9), whiteBias*0.7);
      col = mix(col, pcCol, strokeShape * 0.35 * particleAmt);
    }
    // some stretched ribbons near high highlight
    if(ph > 0.06 && ph < 0.06 + 0.03 * particleAmt * wmask * smoothstep(0.6,0.85,bWater)){
      vec2 pLocal = fract(sUv * vec2(120.0, 60.0));
      float rib = smoothstep(0.1,0.0,abs(pLocal.y-0.5)) * smoothstep(0.3,0.0,abs(pLocal.x-0.5));
      vec3 ribCol = texture(uImg, clamp(coverUV(sUv + vec2(0.0, sin(uTime*0.5+ph*20.0)*0.01)),0.0,1.0)).rgb;
      col = mix(col, mix(ribCol, vec3(0.94), 0.5), rib * 0.25);
    }
  }

  // ---- global vignette ----
  float vig = 1.0 - smoothstep(0.7, 1.4, length(sUv - 0.5)*1.6);
  col *= mix(1.0, vig, 0.35 * I);

  // ---- warm grade ----
  col = mix(col, col * vec3(1.05,1.0,0.94), 0.12*I);

  // ---- grain ----
  float g = hash(sUv*vec2(1024.0,1024.0) + fract(uTime)) - 0.5;
  col += g * 0.03 * I;

  // ---- pulse ----
  col *= 1.0 + pulse * 0.02;

  col = max(col, vec3(0.0));
  fragColor = vec4(col, 1.0);
}
