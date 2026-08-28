const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d", { willReadFrequently: true });

let clonesTriggered = false;
let cloneStartTime = null;
let mask = null;

// ── PHONE OPTIMIZATION: detect mobile ──
const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.innerWidth < 768 || (navigator.maxTouchPoints > 1 && window.innerWidth < 1024);
const isLowEnd = isMobile; // treat all mobiles as lowEnd for perf
console.log("Device:", isMobile ? "mobile" : "desktop", "userAgent", navigator.userAgent);

// Reusable offscreen canvas for person extraction (fixes GC churn = lag)
let personCanvas = document.createElement("canvas");
let personCtx = personCanvas.getContext("2d", { willReadFrequently: true });
let lastCanvasW = 0, lastCanvasH = 0;
let frameCounter = 0;

// ----------------------
// Trained gesture model
// ----------------------
let gestureModel = null;
const statusEl = document.getElementById("status");

async function loadGestureModel() {
  const modelUrl = new URL("gesture-model.json", window.location.href).href;
  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (statusEl) statusEl.textContent = `⏳ Loading gesture model... (attempt ${attempt}/${maxRetries})`;
      console.log("Loading model from:", modelUrl);
      gestureModel = await tf.loadLayersModel(modelUrl);
      console.log("Gesture model loaded successfully!");
      if (statusEl) {
        statusEl.textContent = "✅ Model ready — show your hands!";
        statusEl.classList.add("ready");
        setTimeout(() => { if(statusEl) statusEl.style.display = "none"; }, 3000);
      }
      try { playModelReadySound(); } catch(e){}
      return;
    } catch (e) {
      console.error(`Attempt ${attempt} failed:`, e);
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 2000));
      } else {
        if (statusEl) {
          statusEl.textContent = "❌ Model failed: " + e.message;
          statusEl.classList.add("error");
        }
      }
    }
  }
}

function normalizeHand(lm) {
  const w = lm[0];
  const mcp = lm[9];
  const scale = Math.sqrt((mcp.x - w.x) ** 2 + (mcp.y - w.y) ** 2 + (mcp.z - w.z) ** 2) || 1;
  const out = [];
  for (let i = 0; i < 21; i++) {
    out.push((lm[i].x - w.x) / scale);
    out.push((lm[i].y - w.y) / scale);
    out.push((lm[i].z - w.z) / scale);
  }
  return out;
}

// ----------------------
// Sound effects (Web Audio API + HTMLAudio) - APPLIED TO ALL EVENTS & CLONES
// ----------------------
let audioCtx = null;
let masterGain = null;
let isMuted = localStorage.getItem("kage_sound_muted") === "true";
let audioUnlocked = false;
let soundVariant = 0;

const cloneAudioCandidates = [
  "../kage_bunshin.mp3",
  "assets/kage_bunshin.mp3",
  "./kage_bunshin.mp3",
  "kage_bunshin.mp3",
  "../assets/kage_bunshin.mp3",
  "/kage_bunshin.mp3",
  "/naruto-ultimate/kage_bunshin.mp3"
];
const cloneAudio = new Audio();
cloneAudio.preload = "auto";
cloneAudio.volume = 0.85;
cloneAudio.crossOrigin = "anonymous";
let cloneAudioReady = false;
let cloneAudioTried = 0;
function tryNextCloneAudio(){
  if (cloneAudioTried >= cloneAudioCandidates.length) {
    console.warn("kage_bunshin.mp3 not found on any path — using Web Audio synthesis only");
    return;
  }
  const rel = cloneAudioCandidates[cloneAudioTried++];
  const url = new URL(rel, window.location.href).href;
  cloneAudio.src = url;
  console.log("Trying clone audio:", url);
}
cloneAudio.addEventListener("canplaythrough", () => { cloneAudioReady = true; console.log("✅ kage_bunshin.mp3 ready:", cloneAudio.src); });
cloneAudio.addEventListener("error", () => {
  console.warn("kage_bunshin.mp3 failed at", cloneAudio.src, "— trying next");
  if (cloneAudioTried < cloneAudioCandidates.length) tryNextCloneAudio();
  else console.warn("All clone audio paths failed — synth fallback only");
});
tryNextCloneAudio();

function getAudioCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = isMuted ? 0 : 0.7;
    masterGain.connect(audioCtx.destination);
  }
  return audioCtx;
}

async function ensureAudioResumed(){
  const ac = getAudioCtx();
  if (ac.state === "suspended") {
    try { await ac.resume(); } catch(e){}
  }
  return ac;
}

function unlockAudio() {
  if (audioUnlocked) return;
  const ac = getAudioCtx();
  ac.resume().catch(()=>{});
  try {
    const buf = ac.createBuffer(1, 1, 22050);
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.connect(masterGain || ac.destination);
    src.start(0);
  } catch(e){}
  audioUnlocked = true;
  console.log("🔊 Audio unlocked");
  try { cloneAudio.load(); const p = cloneAudio.play(); if(p && p.then) p.then(()=>{ cloneAudio.pause(); cloneAudio.currentTime=0; }).catch(()=>{}); } catch(e){}
  updateSoundUI();
}
["click","touchstart","keydown","pointerdown"].forEach(evt=>{
  document.addEventListener(evt, unlockAudio, { once:true, passive:true });
  document.addEventListener(evt, ()=>{ if(audioCtx && audioCtx.state==="suspended") ensureAudioResumed(); }, { passive:true });
});

function isSoundEnabled(){ return !isMuted; }

function toggleMute(){
  isMuted = !isMuted;
  localStorage.setItem("kage_sound_muted", isMuted);
  if (masterGain) masterGain.gain.value = isMuted ? 0 : 0.7;
  cloneAudio.muted = isMuted;
  if (audioCtx && audioCtx.state==="suspended" && !isMuted) audioCtx.resume();
  updateSoundUI();
  if (!isMuted) playUISound();
}
window.toggleMute = toggleMute;

function updateSoundUI(){
  const btn = document.getElementById("soundToggle");
  if (!btn) return;
  btn.textContent = isMuted ? "🔇 Sound OFF" : "🔊 Sound ON";
  btn.classList.toggle("muted", isMuted);
  btn.setAttribute("aria-pressed", String(!isMuted));
}

function playUISound(){
  try {
    const ac = getAudioCtx();
    if (isMuted) return;
    const o = ac.createOscillator(), g = ac.createGain();
    o.connect(g); g.connect(masterGain);
    o.type = "sine";
    o.frequency.setValueAtTime(600, ac.currentTime);
    o.frequency.exponentialRampToValueAtTime(900, ac.currentTime + 0.08);
    g.gain.setValueAtTime(0.12, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.12);
    o.start(); o.stop(ac.currentTime + 0.12);
  } catch(e){}
}

async function playCloneActivationSound() {
  if (isMuted) return;
  const ac = await ensureAudioResumed();
  if (!audioUnlocked) unlockAudio();
  let htmlPlayed = false;
  try {
    cloneAudio.currentTime = 0;
    cloneAudio.volume = 0.85;
    cloneAudio.muted = false;
    const p = cloneAudio.play();
    if (p && p.then) {
      await p.then(()=>{ htmlPlayed = true; }).catch((e)=>{
        console.warn("cloneAudio play blocked:", e && e.message);
        htmlPlayed = false;
      });
    } else {
      htmlPlayed = true;
    }
  } catch(e) {
    console.warn("cloneAudio play error", e);
    htmlPlayed = false;
  }
  if (!htmlPlayed) {
    synthCloneActivation();
  } else {
    setTimeout(()=> synthCloneActivation(true), 40);
  }
}

function synthCloneActivation(isLayer=false){
  try {
    const ac = getAudioCtx();
    if (isMuted) return;
    ensureAudioResumed();
    const now = ac.currentTime;
    const layerScale = isLayer ? 0.45 : 1.0;
    const o1 = ac.createOscillator(), g1 = ac.createGain();
    o1.connect(g1); g1.connect(masterGain);
    o1.type = "sine";
    o1.frequency.setValueAtTime(80, now);
    o1.frequency.exponentialRampToValueAtTime(300, now + 0.4);
    g1.gain.setValueAtTime(0.32 * layerScale, now);
    g1.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
    o1.start(now); o1.stop(now + 0.6);
    const o2 = ac.createOscillator(), g2 = ac.createGain();
    o2.connect(g2); g2.connect(masterGain);
    o2.type = "triangle";
    o2.frequency.setValueAtTime(220, now);
    o2.frequency.exponentialRampToValueAtTime(660, now + 0.35);
    g2.gain.setValueAtTime(0.12 * layerScale, now);
    g2.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    o2.start(now); o2.stop(now + 0.45);
    const bufLen = ac.sampleRate * 0.3;
    const buf = ac.createBuffer(1, bufLen, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) data[i] = (Math.random()*2-1)*0.15;
    const noise = ac.createBufferSource(); noise.buffer = buf;
    const ng = ac.createGain(); const bp = ac.createBiquadFilter();
    bp.type="bandpass"; bp.frequency.value=1200; bp.Q.value=0.7;
    noise.connect(bp); bp.connect(ng); ng.connect(masterGain);
    ng.gain.setValueAtTime(0.22 * layerScale, now);
    ng.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    noise.start(now); noise.stop(now + 0.3);
  } catch(e){ console.warn(e); }
}

function playSmokePoofSound() {
  try {
    const ac = getAudioCtx();
    if (isMuted) return;
    ensureAudioResumed();
    soundVariant++;
    const baseFreq = 700 + (soundVariant % 5)*90;
    const bufLen = ac.sampleRate * 0.16;
    const buf = ac.createBuffer(1, bufLen, ac.sampleRate);
    const data = buf.getChannelData(0);
    for(let i=0;i<bufLen;i++) data[i]=(Math.random()*2-1)*0.09;
    const noise = ac.createBufferSource(); noise.buffer = buf;
    const ng = ac.createGain(); const filter = ac.createBiquadFilter();
    filter.type="lowpass"; filter.frequency.value=baseFreq; filter.Q.value=0.8;
    const start = ac.currentTime + Math.random()*0.02;
    if (ac.createStereoPanner){
      const panner = ac.createStereoPanner();
      panner.pan.value = (Math.random()*0.8 - 0.4);
      noise.connect(filter); filter.connect(panner); panner.connect(ng); ng.connect(masterGain);
    } else {
      noise.connect(filter); filter.connect(ng); ng.connect(masterGain);
    }
    ng.gain.setValueAtTime(0.14, start);
    ng.gain.exponentialRampToValueAtTime(0.001, start+0.16);
    noise.start(start); noise.stop(start+0.16);
    const o=ac.createOscillator(), og=ac.createGain();
    o.connect(og); og.connect(masterGain);
    o.type="sine";
    o.frequency.setValueAtTime(180 + (soundVariant%4)*12, start);
    o.frequency.exponentialRampToValueAtTime(60, start+0.18);
    og.gain.setValueAtTime(0.06, start);
    og.gain.exponentialRampToValueAtTime(0.001, start+0.18);
    o.start(start); o.stop(start+0.18);
  } catch(e){}
}

function playEraseSound() {
  try {
    const ac = getAudioCtx();
    if (isMuted) return;
    ensureAudioResumed();
    const now = ac.currentTime;
    const o = ac.createOscillator(), g = ac.createGain();
    o.connect(g); g.connect(masterGain);
    o.type="sine";
    o.frequency.setValueAtTime(420, now);
    o.frequency.exponentialRampToValueAtTime(75, now+0.55);
    g.gain.setValueAtTime(0.22, now);
    g.gain.exponentialRampToValueAtTime(0.001, now+0.55);
    o.start(now); o.stop(now+0.55);
    const bufLen = ac.sampleRate * 0.25;
    const buf = ac.createBuffer(1, bufLen, ac.sampleRate);
    const data = buf.getChannelData(0);
    for(let i=0;i<bufLen;i++) data[i]=(Math.random()*2-1)*Math.pow(1 - i/bufLen, 1.5)*0.12;
    const noise=ac.createBufferSource(); noise.buffer=buf;
    const ng=ac.createGain(); const hp=ac.createBiquadFilter();
    hp.type="highpass"; hp.frequency.value=600;
    noise.connect(hp); hp.connect(ng); ng.connect(masterGain);
    ng.gain.setValueAtTime(0.18, now);
    ng.gain.exponentialRampToValueAtTime(0.001, now+0.25);
    noise.start(now); noise.stop(now+0.25);
    try{ if(!cloneAudio.paused) { cloneAudio.pause(); cloneAudio.currentTime=0; } }catch(e){}
  } catch(e){}
}

function playModelReadySound(){
  try{
    const ac=getAudioCtx();
    if(isMuted) return;
    ensureAudioResumed();
    [523.25,659.25,783.99].forEach((freq,i)=>{
      const o=ac.createOscillator(), g=ac.createGain();
      o.connect(g); g.connect(masterGain);
      o.type="sine"; o.frequency.value=freq;
      const t=ac.currentTime+i*0.11;
      g.gain.setValueAtTime(0,t);
      g.gain.linearRampToValueAtTime(0.14,t+0.02);
      g.gain.exponentialRampToValueAtTime(0.001,t+0.38);
      o.start(t); o.stop(t+0.38);
    });
  }catch(e){}
}

//erase clone - exposed for UI
function resetClones() {
  clonesTriggered = false;
  cloneStartTime = null;
  activeSmokes.length = 0;
  customClones.forEach(cl => { cl.smokeSpawned = false; });
  effectiveClones.forEach(cl => { cl.smokeSpawned = false; });
  const img = document.getElementById("overlayImg");
  if (img) {
    img.src = "assets/state-1.png";
    img.dataset.state = "1";
    const btn = img.closest(".video-overlay-btn");
    if (btn) btn.classList.remove("pop");
  }
  playEraseSound();
  console.log("CLONES ERASED");
}
window.resetClones = resetClones;

// Manual trigger for button
window.manualTriggerClones = function(){
  if(!clonesTriggered){
    clonesTriggered = true;
    cloneStartTime = performance.now();
    playCloneActivationSound();
    console.log("CLONE TRIGGERED (manual)");
    if(statusEl){ statusEl.textContent="🔥 CLONES ACTIVATED!"; statusEl.style.display=''; statusEl.classList.add("ready"); }
  }
};

function predictGesture(right, left, threshold = 0.6) {
  if (!gestureModel) return null;
  if (!right && !left) return null;
  // throttle: already handled outside via frameCounter check, but keep as fallback
  const rightFeatures = right ? normalizeHand(right) : new Array(63).fill(0);
  const leftFeatures = left ? normalizeHand(left) : new Array(63).fill(0);
  // Use tf.tidy to avoid leak and reduce GC
  let probs;
  let input;
  try{
    input = tf.tensor2d([[...rightFeatures, ...leftFeatures]]);
    probs = gestureModel.predict(input).dataSync();
  } finally {
    if(input) input.dispose();
  }
  const maxProb = Math.max(...probs);
  const classIndex = probs.indexOf(maxProb);
  const confidenceEl = document.querySelector(".confidence");
  if (confidenceEl) confidenceEl.textContent = (maxProb * 100).toFixed(1) + "%";
  if (maxProb < threshold) return null;
  // console.log("Predicted class:", classIndex, "Confidence:", maxProb);
  return { classIndex, confidence: maxProb };
}

loadGestureModel();

// ----------------------
// Custom clones - ADAPTED FOR PHONE
// ----------------------
// Full list (desktop) - 16 clones
const fullClones = [
  { x: -100, y: 100, scale: 0.9,  delay: 300, smokeSpawned: false },
  { x:  120, y: 100, scale: 0.85, delay: 450, smokeSpawned: false },
  { x: -180, y: 140, scale: 0.8,  delay: 600, smokeSpawned: false },
  { x: -140, y: 140, scale: 0.45, delay: 620, smokeSpawned: false },
  { x:  180, y: 160, scale: 0.7,  delay: 750, smokeSpawned: false },
  { x:  140, y: 160, scale: 0.4,  delay: 770, smokeSpawned: false },
  { x: -250, y: 140, scale: 0.7,  delay: 900, smokeSpawned: false },
  { x: -220, y: 140, scale: 0.35, delay: 920, smokeSpawned: false },
  { x:  260, y: 160, scale: 0.65, delay: 1050, smokeSpawned: false },
  { x: -100, y: 150, scale: 0.6,  delay: 1800, smokeSpawned: false },
  { x:  100, y: 150, scale: 0.6,  delay: 1950, smokeSpawned: false },
  { x: -120, y:  70, scale: 0.55, delay: 2100, smokeSpawned: false },
  { x:  100, y:  70, scale: 0.5,  delay: 2250, smokeSpawned: false },
  { x: -200, y:  85, scale: 0.55, delay: 2400, smokeSpawned: false },
  { x:  230, y:  85, scale: 0.5,  delay: 2550, smokeSpawned: false },
  { x: -280, y: 100, scale: 0.4,  delay: 2700, smokeSpawned: false },
];
// On mobile, keep only 8 most impactful clones to avoid OOM/lag
const mobileClones = fullClones.slice(0, 8);
const customClones = fullClones; // keep original for compat
const effectiveClones = isMobile ? mobileClones : fullClones;
if(isMobile) console.log("Mobile mode: using", effectiveClones.length, "clones instead of", fullClones.length);

// ----------------------
// Selfie Segmentation - lite on mobile
// ----------------------
const selfie = new SelfieSegmentation({
  locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${f}`,
});
selfie.setOptions({ modelSelection: isMobile ? 0 : 1 });
selfie.onResults((r) => (mask = r.segmentationMask));

// ----------------------
// Holistic - lite on mobile
// ----------------------
const holistic = new Holistic({
  locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/holistic/${f}`,
});
holistic.setOptions({
  modelComplexity: isMobile ? 0 : 1,
  smoothLandmarks: !isMobile,
  enableSegmentation: false,
  refineFaceLandmarks: false,
  minDetectionConfidence: isMobile ? 0.5 : 0.6,
  minTrackingConfidence: isMobile ? 0.5 : 0.6
});

// ----------------------
// Camera set up - lower res on phone
// ----------------------
const camera = new Camera(video, {
  width: isMobile ? 480 : 640,
  height: isMobile ? 360 : 480,
  onFrame: async () => {
    // throttle segmentation: run both but with sequential awaits
    // On mobile, run at ~15fps via frame skip happens in holistic loop; here we just send
    await selfie.send({ image: video });
    await holistic.send({ image: video });
  },
});
camera.start().then(()=>{ console.log("Camera started", isMobile?"mobile lite":"desktop"); }).catch(e=>{
  console.error("Camera failed", e);
  if(statusEl){ statusEl.textContent="❌ Camera blocked: "+e.message; statusEl.classList.add("error"); }
});

// ----------------------
// adding the smoke sprites
// ----------------------
const SMOKE_FOLDERS = ["smoke_1", "smoke_2", "smoke_3"];
const SMOKE_FRAME_COUNT = 5;
const SMOKE_DURATION = 600;
const activeSmokes = [];

const preloadedSmokes = {};
SMOKE_FOLDERS.forEach(folder => {
  preloadedSmokes[folder] = [];
  for (let i = 1; i <= SMOKE_FRAME_COUNT; i++) {
    const img = new Image();
    img.src = `assets/${folder}/${i}.png`;
    // reduce decode cost on mobile: set decoding async
    if('decoding' in img) img.decoding = 'async';
    preloadedSmokes[folder].push(img);
  }
});

function spawnSmoke(x, y, scale) {
  scale *= 1.2;
  const folder = SMOKE_FOLDERS[Math.floor(Math.random() * SMOKE_FOLDERS.length)];
  const frames = preloadedSmokes[folder];
  activeSmokes.push({ x, y, scale, start: performance.now(), frames });
}

function drawSmokes() {
  const now = performance.now();
  for (let i = activeSmokes.length - 1; i >= 0; i--) {
    const s = activeSmokes[i];
    const elapsed = now - s.start;
    const frameDuration = SMOKE_DURATION / SMOKE_FRAME_COUNT;
    const frameIndex = Math.floor(elapsed / frameDuration);
    if (frameIndex >= s.frames.length) {
      activeSmokes.splice(i, 1);
      continue;
    }
    const img = s.frames[frameIndex];
    // skip if not yet loaded (fixes "only cloud" when img.width==0)
    if(!img.complete || img.naturalWidth===0) continue;
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.scale(s.scale, s.scale);
    try{ ctx.drawImage(img, -img.width / 2, -img.height / 2); }catch(e){}
    ctx.restore();
  }
}

// ----------------------
// Results on loop - OPTIMIZED
// ----------------------
holistic.onResults((res) => {
  frameCounter++;
  // On mobile, throttle heavy drawing to every 2nd frame for holistic skeleton? But we need smooth; instead throttle TF predict below
  const vw = video.videoWidth, vh = video.videoHeight;
  if(!vw || !vh) return;

  // Only resize canvas when size changes (avoids flicker + layout thrash)
  if(canvas.width !== vw || canvas.height !== vh){
    canvas.width = vw;
    canvas.height = vh;
    personCanvas.width = vw;
    personCanvas.height = vh;
    lastCanvasW = vw; lastCanvasH = vh;
  } else {
    // clear instead of resize
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  if(!isMobile) ctx.clearRect(0,0,canvas.width,canvas.height); // ensure clear on desktop too (already via resize path?)

  // Draw live webcam as background (mirrored? video already mirrored via CSS? canvas draws unmirrored)
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  // If mask not ready, fallback to video copy (fixes "only cloud" - at least shows person)
  let person;
  if(mask){
    person = grabPerson();
  } else {
    // fallback: just video frame copy
    personCtx.clearRect(0,0,personCanvas.width, personCanvas.height);
    personCtx.drawImage(video, 0, 0, personCanvas.width, personCanvas.height);
    person = personCanvas;
  }

  // Trigger clones via trained model - throttle on mobile (every 3rd frame = ~10fps prediction)
  const shouldPredict = !isMobile || (frameCounter % 2 === 0);
  if (shouldPredict && gestureModel && (res.rightHandLandmarks || res.leftHandLandmarks)) {
    const result = predictGesture(res.rightHandLandmarks, res.leftHandLandmarks, isMobile?0.55:0.6);
    if (result) {
      if (!clonesTriggered && result.classIndex === 0) {
        clonesTriggered = true;
        cloneStartTime = performance.now();
        // reset smoke states for effective clones
        effectiveClones.forEach(c=> c.smokeSpawned=false);
        fullClones.forEach(c=> c.smokeSpawned=false);
        playCloneActivationSound();
        console.log("CLONE TRIGGERED", result.confidence);
        if(statusEl){ statusEl.textContent="🔥 CLONES ACTIVATED!"; statusEl.classList.add("ready"); statusEl.style.display=''; setTimeout(()=> statusEl.style.display='none', 2500); }
      }
      if (clonesTriggered && result.classIndex === 1) {
        resetClones();
        return;
      }
    }
  }

  // Spawn smoke independently for each clone (use effectiveClones for phone)
  if (clonesTriggered) {
    const now = performance.now();
    effectiveClones.forEach((cl) => {
      if (!cl.smokeSpawned && now - cloneStartTime >= cl.delay) {
        cl.smokeSpawned = true;
        const centerX = cl.x + canvas.width / 2;
        const centerY = cl.y + canvas.height / 2 - 40;
        spawnSmoke(centerX - 15, centerY, cl.scale);
        spawnSmoke(centerX + 15, centerY, cl.scale);
        playSmokePoofSound();
      }
    });
    toggleImage();
    drawClones(person);
    drawSmokes();
  } else {
    // draw person alone - use reusable canvas (avoid createElement churn)
    try{ ctx.drawImage(person, 0, 0); }catch(e){}
  }

  // Draw skeletons thinner on mobile for perf
  const lineW = isMobile ? 1.5 : 2;
  const dotR = isMobile ? 2 : 3;
  if (res.rightHandLandmarks) drawFingerSkeleton(res.rightHandLandmarks, lineW, dotR);
  if (res.leftHandLandmarks) drawFingerSkeleton(res.leftHandLandmarks, lineW, dotR);
});

// ----------------------
// draw clones function - uses effectiveClones
// ----------------------
function drawClones(person) {
  const now = performance.now();
  // Sort once outside loop? effective clones already sorted by delay asc, so draw far first
  const sorted = [...effectiveClones].sort((a, b) => b.delay - a.delay);
  sorted.forEach((cl) => {
    if (now - cloneStartTime >= cl.delay) {
      ctx.save();
      // optimized translate: avoid * (1-scale)/2 for every clone? keep for centering
      ctx.translate(cl.x + canvas.width * (1 - cl.scale) / 2, cl.y);
      ctx.scale(cl.scale, cl.scale);
      try{ ctx.drawImage(person, 0, 0); }catch(e){}
      ctx.restore();
    }
  });
  try{ ctx.drawImage(person, 0, 0); }catch(e){} // main person always on top
}

// ----------------------
// grab person helper - REUSE canvas (major mobile fix)
// ----------------------
function grabPerson() {
  // Reuse personCanvas instead of createElement each frame
  if(personCanvas.width !== canvas.width || personCanvas.height !== canvas.height){
    personCanvas.width = canvas.width;
    personCanvas.height = canvas.height;
  }
  personCtx.clearRect(0,0,personCanvas.width, personCanvas.height);
  // segmentation mask may be low-res; draw stretched
  try{
    personCtx.drawImage(mask, 0, 0, personCanvas.width, personCanvas.height);
    personCtx.globalCompositeOperation = "source-in";
    personCtx.drawImage(video, 0, 0, personCanvas.width, personCanvas.height);
    personCtx.globalCompositeOperation = "source-over";
  } catch(e){
    // fallback
    personCtx.globalCompositeOperation = "source-over";
    personCtx.drawImage(video, 0, 0, personCanvas.width, personCanvas.height);
  }
  return personCanvas;
}

// ----------------------
// finger skeleton
// ----------------------
const FINGER_INDICES = {
  thumb:  [0, 1, 2, 3, 4],
  index:  [0, 5, 6, 7, 8],
  middle: [0, 9, 10, 11, 12],
  ring:   [0, 13, 14, 15, 16],
  pinky:  [0, 17, 18, 19, 20],
};

function drawFingerSkeleton(lm, lw=2, r=3) {
  ctx.strokeStyle = "lime";
  ctx.lineWidth = lw;
  for (const indices of Object.values(FINGER_INDICES)) {
    ctx.beginPath();
    indices.forEach((i, idx) => {
      const x = lm[i].x * canvas.width;
      const y = lm[i].y * canvas.height;
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
  ctx.fillStyle = "red";
  lm.forEach((point) => {
    ctx.beginPath();
    ctx.arc(point.x * canvas.width, point.y * canvas.height, r, 0, Math.PI * 2);
    ctx.fill();
  });
}

// ----------------------
// Hand image toggle
// ----------------------
function toggleImage() {
  const img = document.getElementById("overlayImg");
  if(!img) return;
  const btn = img.closest(".video-overlay-btn");
  if (img.dataset.state === "2") return;
  img.src = "assets/state-2.png";
  img.dataset.state = "2";
  if(btn){ btn.classList.add("pop"); setTimeout(() => btn.classList.remove("pop"), 200); }
}

// ----------------------
// Reset everything on load + sound UI init + mobile hints
// ----------------------
window.onload = () => {
  clonesTriggered = false;
  cloneStartTime = null;
  try { getAudioCtx(); } catch(e){}
  updateSoundUI();
  const soundBtn = document.getElementById("soundToggle");
  if (soundBtn) soundBtn.addEventListener("click", toggleMute);
  const overlayBtn = document.querySelector(".video-overlay-btn");
  if (overlayBtn) overlayBtn.addEventListener("click", unlockAudio);
  // Mobile performance hint
  if(isMobile && statusEl){
    const hint = document.createElement('div');
    hint.style.cssText='position:fixed; bottom:10px; left:50%; transform:translateX(-50%); background:rgba(0,0,0,0.7); color:#00e5ff; padding:6px 12px; border-radius:50px; font-size:0.7rem; z-index:99;';
    hint.textContent='📱 Mobile lite mode: 8 clones for smooth FPS';
    document.body.appendChild(hint);
    setTimeout(()=> hint.remove(), 4000);
  }
};

