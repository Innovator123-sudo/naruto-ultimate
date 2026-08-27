const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

let clonesTriggered = false;
let cloneStartTime = null;
let mask = null;

// ----------------------
// Trained gesture model
// ----------------------
let gestureModel = null;
const statusEl = document.getElementById("status");

async function loadGestureModel() {
  // Robust relative URL - works on GitHub Pages (sub-path) and Vercel (root)
  // Using URL constructor handles /kage-bunshin-clone-me/ vs / correctly
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
        setTimeout(() => { statusEl.style.display = "none"; }, 3000);
      }
      // Sound for model ready (applies to all loads)
      try { playModelReadySound(); } catch(e){}
      return; // success
    } catch (e) {
      console.error(`Attempt ${attempt} failed:`, e);
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 2000)); // wait 2s before retry
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
  const scale =
    Math.sqrt(
      (mcp.x - w.x) ** 2 + (mcp.y - w.y) ** 2 + (mcp.z - w.z) ** 2
    ) || 1;

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

// HTMLAudio fallback — works if you add assets/kage_bunshin.mp3 (optional)
// Path is relative to index.html so it works on GitHub Pages (/repo/) and Vercel (/)
const cloneAudio = new Audio("../kage_bunshin.mp3");
cloneAudio.preload = "auto";
cloneAudio.volume = 0.8;
// If file missing, preload will 404 but Web Audio fallback still works
cloneAudio.addEventListener("error", () => console.warn("kage_bunshin.mp3 not found — using Web Audio synthesis"));

function getAudioCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = isMuted ? 0 : 0.7;
    masterGain.connect(audioCtx.destination);
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume().catch(()=>{});
  }
  return audioCtx;
}

function unlockAudio() {
  if (audioUnlocked) return;
  const ac = getAudioCtx();
  if (ac.state === "suspended") ac.resume();
  // silent buffer unlocks iOS
  try {
    const buf = ac.createBuffer(1, 1, 22050);
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.connect(masterGain || ac.destination);
    src.start(0);
  } catch(e){}
  audioUnlocked = true;
  console.log("🔊 Audio unlocked");
  updateSoundUI();
}
["click","touchstart","keydown","pointerdown"].forEach(evt=>{
  document.addEventListener(evt, unlockAudio, { once:true, passive:true });
  document.addEventListener(evt, ()=>{ if(audioCtx && audioCtx.state==="suspended") audioCtx.resume(); }, { passive:true });
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

// Primary activation sound — works for ALL clones (global summon)
function playCloneActivationSound() {
  // Try HTMLAudio first (authentic Naruto SFX if file exists)
  let htmlPlayed = false;
  if (!isMuted) {
    try {
      cloneAudio.currentTime = 0;
      const p = cloneAudio.play();
      if (p && p.then) {
        p.then(()=>{ htmlPlayed = true; }).catch(()=>{ synthCloneActivation(); });
        // fallback synth in parallel if audio file is empty/short
        setTimeout(()=>{ if(!htmlPlayed) synthCloneActivation(); }, 150);
      } else {
        htmlPlayed = true;
      }
    } catch(e) { synthCloneActivation(); }
  }
  // Always also play synth layer lightly for extra punch (unless muted)
  if (!htmlPlayed) synthCloneActivation();
}

function synthCloneActivation(){
  try {
    const ac = getAudioCtx();
    if (isMuted) return;
    if (ac.state === "suspended") ac.resume();
    const now = ac.currentTime;
    // Layer 1: deep impact + rise
    const o1 = ac.createOscillator(), g1 = ac.createGain();
    o1.connect(g1); g1.connect(masterGain);
    o1.type = "sine";
    o1.frequency.setValueAtTime(80, now);
    o1.frequency.exponentialRampToValueAtTime(300, now + 0.4);
    g1.gain.setValueAtTime(0.32, now);
    g1.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
    o1.start(now); o1.stop(now + 0.6);
    // Layer 2: harmonic energy
    const o2 = ac.createOscillator(), g2 = ac.createGain();
    o2.connect(g2); g2.connect(masterGain);
    o2.type = "triangle";
    o2.frequency.setValueAtTime(220, now);
    o2.frequency.exponentialRampToValueAtTime(660, now + 0.35);
    g2.gain.setValueAtTime(0.12, now);
    g2.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    o2.start(now); o2.stop(now + 0.45);
    // Layer 3: noise burst poof
    const bufLen = ac.sampleRate * 0.3;
    const buf = ac.createBuffer(1, bufLen, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) data[i] = (Math.random()*2-1)*0.15;
    const noise = ac.createBufferSource(); noise.buffer = buf;
    const ng = ac.createGain(); const bp = ac.createBiquadFilter();
    bp.type="bandpass"; bp.frequency.value=1200; bp.Q.value=0.7;
    noise.connect(bp); bp.connect(ng); ng.connect(masterGain);
    ng.gain.setValueAtTime(0.22, now);
    ng.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    noise.start(now); noise.stop(now + 0.3);
  } catch(e){ console.warn(e); }
}

function playSmokePoofSound() {
  // Called FOR EACH CLONE individually — gives "sound for all" effect
  try {
    const ac = getAudioCtx();
    if (isMuted) return;
    if (ac.state === "suspended") ac.resume();
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
    // subtle tonal puff per clone
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
  // Applied when ALL clones are erased together
  // Also cloneAudio fallback with reverse feel
  try {
    const ac = getAudioCtx();
    if (isMuted) return;
    if (ac.state === "suspended") ac.resume();
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
    // also quick cloneAudio reverse cue if file exists (optional)
    try{ if(!cloneAudio.paused) { cloneAudio.pause(); cloneAudio.currentTime=0; } }catch(e){}
  } catch(e){}
}

function playModelReadySound(){
  try{
    const ac=getAudioCtx();
    if(isMuted) return;
    if(ac.state==="suspended") ac.resume();
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


//erase clone
function resetClones() {
  clonesTriggered = false;
  cloneStartTime = null;

  activeSmokes.length = 0;

  customClones.forEach(cl => {
    cl.smokeSpawned = false;
  });

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


//change the threshold number to your preferance! 
function predictGesture(right, left, threshold = 0.6) {
  if (!gestureModel) return null;
  if (!right && !left) return null;

  const rightFeatures = right ? normalizeHand(right) : new Array(63).fill(0);
  const leftFeatures = left ? normalizeHand(left) : new Array(63).fill(0);

  const input = tf.tensor2d([
    [...rightFeatures, ...leftFeatures],
  ]);

  const probs = gestureModel.predict(input).dataSync();
  input.dispose();

  const maxProb = Math.max(...probs);
  const classIndex = probs.indexOf(maxProb);

  const confidenceEl = document.querySelector(".confidence");
  if (confidenceEl) confidenceEl.textContent = (maxProb * 100).toFixed(1) + "%";

  if (maxProb < threshold) return null;

  console.log("Predicted class:", classIndex, "Confidence:", maxProb);
  return { classIndex, confidence: maxProb };
}

loadGestureModel();

// ----------------------
// Custom clones
// ----------------------
//feel free to play around with the clone positions, sizes, and delay time
const customClones = [
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

// ----------------------
// Selfie Segmentation
// ----------------------
const selfie = new SelfieSegmentation({
  locateFile: (f) =>
    `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${f}`,
});
selfie.setOptions({ modelSelection: 1 });
selfie.onResults((r) => (mask = r.segmentationMask));

// ----------------------
// Holistic
// ----------------------
const holistic = new Holistic({
  locateFile: (f) =>
    `https://cdn.jsdelivr.net/npm/@mediapipe/holistic/${f}`,
});
holistic.setOptions({
  modelComplexity: 1,
  smoothLandmarks: true,
});

// ----------------------
// Camera set up
// ----------------------
const camera = new Camera(video, {
  width: 640,
  height: 480,
  onFrame: async () => {
    await selfie.send({ image: video });
    await holistic.send({ image: video });
  },
});
camera.start();

// ----------------------
// adding the smoke sprites
// ----------------------
const SMOKE_FOLDERS = ["smoke_1", "smoke_2", "smoke_3"];
const SMOKE_FRAME_COUNT = 5;
const SMOKE_DURATION = 600;
const activeSmokes = [];

// Preload smoke frames to avoid drawImage errors
const preloadedSmokes = {};
SMOKE_FOLDERS.forEach(folder => {
  preloadedSmokes[folder] = [];
  for (let i = 1; i <= SMOKE_FRAME_COUNT; i++) {
    const img = new Image();
    img.src = `assets/${folder}/${i}.png`;
    preloadedSmokes[folder].push(img);
  }
});

function spawnSmoke(x, y, scale) {
  scale *= 1.2;
  const folder =
    SMOKE_FOLDERS[Math.floor(Math.random() * SMOKE_FOLDERS.length)];

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
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.scale(s.scale, s.scale);
    ctx.drawImage(img, -img.width / 2, -img.height / 2);
    ctx.restore();
  }
}

// ----------------------
// Results on loop
// ----------------------
holistic.onResults((res) => {
  if (!mask) return;

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Draw live webcam as background
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  const person = grabPerson();

  // Trigger clones once via trained model
  if (gestureModel && (res.rightHandLandmarks || res.leftHandLandmarks)) {
    const result = predictGesture(res.rightHandLandmarks, res.leftHandLandmarks);

    if (result) {
      // class 0 = clone sign
      if (!clonesTriggered && result.classIndex === 0) {
        clonesTriggered = true;
        cloneStartTime = performance.now();
        playCloneActivationSound();
        console.log("CLONE TRIGGERED");
      }

      // class 1 = erase sign
      if (clonesTriggered && result.classIndex === 1) {
        resetClones();
        return;
      }
    }
  }

  // Spawn smoke independently for each clone
  if (clonesTriggered) {
    const now = performance.now();
    customClones.forEach((cl) => {
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
    ctx.drawImage(person, 0, 0);
  }

  if (res.rightHandLandmarks) drawFingerSkeleton(res.rightHandLandmarks);
  if (res.leftHandLandmarks) drawFingerSkeleton(res.leftHandLandmarks);
});

// ----------------------
// draw clones function
// ----------------------
function drawClones(person) {
  const now = performance.now();
  const sorted = [...customClones].sort((a, b) => b.delay - a.delay);

  sorted.forEach((cl) => {
    if (now - cloneStartTime >= cl.delay) {
      ctx.save();
      ctx.translate(cl.x + canvas.width * (1 - cl.scale) / 2, cl.y);
      ctx.scale(cl.scale, cl.scale);
      ctx.drawImage(person, 0, 0);
      ctx.restore();
    }
  });

  ctx.drawImage(person, 0, 0); // main person always on top
}

// ----------------------
// grab person helper function
// ----------------------
function grabPerson() {
  const offscreen = document.createElement("canvas");
  offscreen.width = canvas.width;
  offscreen.height = canvas.height;
  const tempCtx = offscreen.getContext("2d");

  tempCtx.drawImage(mask, 0, 0, canvas.width, canvas.height);
  tempCtx.globalCompositeOperation = "source-in";
  tempCtx.drawImage(video, 0, 0, canvas.width, canvas.height);
  tempCtx.globalCompositeOperation = "source-over";

  return offscreen;
}

// ----------------------
// finger skeelton
// ----------------------
const FINGER_INDICES = {
  thumb:  [0, 1, 2, 3, 4],
  index:  [0, 5, 6, 7, 8],
  middle: [0, 9, 10, 11, 12],
  ring:   [0, 13, 14, 15, 16],
  pinky:  [0, 17, 18, 19, 20],
};

function drawFingerSkeleton(lm) {
  ctx.strokeStyle = "lime";
  ctx.lineWidth = 2;

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

  lm.forEach((point) => {
    ctx.beginPath();
    ctx.arc(
      point.x * canvas.width,
      point.y * canvas.height,
      3,
      0,
      Math.PI * 2
    );
    ctx.fillStyle = "red";
    ctx.fill();
  });
}

// ----------------------
// Hand image toggle
// ----------------------
function toggleImage() {
  const img = document.getElementById("overlayImg");
  const btn = img.closest(".video-overlay-btn");

  if (img.dataset.state === "2") return;

  img.src = "assets/state-2.png";
  img.dataset.state = "2";

  btn.classList.add("pop");
  setTimeout(() => btn.classList.remove("pop"), 200);
}

// ----------------------
// Reset everything on load + sound UI init
// ----------------------
window.onload = () => {
  clonesTriggered = false;
  cloneStartTime = null;
  // ensure AudioContext is prepared (but not auto-play until gesture)
  try { getAudioCtx(); } catch(e){}
  updateSoundUI();
  // wire sound toggle if present (added in index.html)
  const soundBtn = document.getElementById("soundToggle");
  if (soundBtn) soundBtn.addEventListener("click", toggleMute);
  // Also unlock on overlay button click
  const overlayBtn = document.querySelector(".video-overlay-btn");
  if (overlayBtn) overlayBtn.addEventListener("click", unlockAudio);
};
