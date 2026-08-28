/* ═══════════════════════════════════════
   SHADOW CLONE JUTSU — Engine Script
   Adapted from naruto-shadow-clone-jutsu
   ═══════════════════════════════════════ */

const video = document.getElementById("clone-video");
const canvas = document.getElementById("clone-canvas");
const ctx = canvas.getContext("2d");
const hudStatus = document.getElementById("hudStatus");
const confidenceVal = document.getElementById("confidenceVal");
const errorMsg = document.getElementById("errorMsg");

let clonesTriggered = false;
let cloneStartTime = null;
let mask = null;

// ── Assets base path — works on both root and subpath deployments ──
// Detect base path dynamically for GitHub Pages subpath support
const getAssetsBase = () => {
  const currentPath = window.location.pathname;
  // If we're in a subpath like /naruto-ultimate/, use that
  const parts = currentPath.split('/').filter(p => p);
  if (parts.length > 1) {
    // We're in a subdirectory, go up one level
    return '../naruto-shadow-clone-jutsu-main/naruto-shadow-clone-jutsu-main/assets/';
  }
  return 'naruto-shadow-clone-jutsu-main/naruto-shadow-clone-jutsu-main/assets/';
};
const ASSETS_BASE = getAssetsBase();

// ── Gesture Model (optional — may not exist) ──
let gestureModel = null;

async function loadGestureModel() {
  try {
    gestureModel = await tf.loadLayersModel("gesture-model.json");
    console.log("Gesture model loaded");
    hudStatus.textContent = "MODEL LOADED — READY";
  } catch (e) {
    console.warn("Gesture model not found — use manual activation:", e.message);
    hudStatus.textContent = "MANUAL MODE — PRESS BUTTON";
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

function predictGesture(right, left, threshold = 0.999) {
  if (!gestureModel || !right || !left) return false;

  const input = tf.tensor2d([
    [...normalizeHand(right), ...normalizeHand(left)],
  ]);
  const prob = gestureModel.predict(input).dataSync()[0];
  input.dispose();

  confidenceVal.textContent = (prob * 100).toFixed(1) + "%";
  return prob > threshold;
}

loadGestureModel();

// ── Manual Trigger ──
window.manualTriggerClones = function () {
  if (!clonesTriggered) {
    clonesTriggered = true;
    cloneStartTime = performance.now();
    hudStatus.textContent = "🔥 CLONES ACTIVATED!";
    hudStatus.style.color = "#00ff88";
    console.log("CLONE TRIGGERED (manual)");

    // Sound effect
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(300, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1200, audioCtx.currentTime + 0.15);
      osc.frequency.exponentialRampToValueAtTime(200, audioCtx.currentTime + 0.4);
      gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.5);
    } catch(e) {}
  }
};

window.resetClones = function () {
  clonesTriggered = false;
  cloneStartTime = null;
  customClones.forEach(cl => cl.smokeSpawned = false);
  hudStatus.textContent = "RESET — READY";
  hudStatus.style.color = "";
  confidenceVal.textContent = "0%";

  const img = document.getElementById("overlayImg");
  img.src = ASSETS_BASE + "state-1.png";
  img.dataset.state = "1";
};

// ── Mobile detection for performance optimization ──
const isMobileDevice = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.innerWidth < 768;

// ── Custom Clones Configuration — reduced count for mobile performance ──
const customClones = isMobileDevice ? [
  // Mobile: fewer clones for better performance
  { x: -80, y: 80, scale: 0.85,  delay: 1000, smokeSpawned: false },
  { x:  90, y: 80, scale: 0.8,   delay: 1200, smokeSpawned: false },
  { x: -140, y: 120, scale: 0.7, delay: 1500, smokeSpawned: false },
  { x:  140, y: 120, scale: 0.65, delay: 1700, smokeSpawned: false },
  { x: -200, y: 100, scale: 0.55, delay: 2000, smokeSpawned: false },
  { x:  200, y: 100, scale: 0.5, delay: 2200, smokeSpawned: false },
] : [
  // Desktop: full clone count
  { x: -100, y: 100, scale: 0.9,  delay: 1000, smokeSpawned: false },
  { x:  120, y: 100, scale: 0.85, delay: 1150, smokeSpawned: false },
  { x: -180, y: 140, scale: 0.8,  delay: 1300, smokeSpawned: false },
  { x: -140, y: 140, scale: 0.45, delay: 1320, smokeSpawned: false },
  { x:  180, y: 160, scale: 0.7,  delay: 1450, smokeSpawned: false },
  { x:  140, y: 160, scale: 0.4,  delay: 1470, smokeSpawned: false },
  { x: -250, y: 140, scale: 0.7,  delay: 1600, smokeSpawned: false },
  { x: -220, y: 140, scale: 0.35, delay: 1620, smokeSpawned: false },
  { x:  260, y: 160, scale: 0.65, delay: 1750, smokeSpawned: false },
  { x: -100, y: 150, scale: 0.6,  delay: 2500, smokeSpawned: false },
  { x:  100, y: 150, scale: 0.6,  delay: 2650, smokeSpawned: false },
  { x: -120, y:  70, scale: 0.55, delay: 2800, smokeSpawned: false },
  { x:  100, y:  70, scale: 0.5,  delay: 2950, smokeSpawned: false },
  { x: -200, y:  85, scale: 0.55, delay: 3100, smokeSpawned: false },
  { x:  230, y:  85, scale: 0.5,  delay: 3250, smokeSpawned: false },
  { x: -280, y: 100, scale: 0.4,  delay: 3400, smokeSpawned: false },
];

// ── Selfie Segmentation (Removed to improve performance) ──
// We now use Holistic's built-in segmentation.

// ── Holistic — optimized for mobile performance ──
const holistic = new Holistic({
  locateFile: (f) =>
    `https://cdn.jsdelivr.net/npm/@mediapipe/holistic/${f}`,
});
holistic.setOptions({
  modelComplexity: isMobileDevice ? 0 : 1,  // Lower complexity on mobile
  smoothLandmarks: true,
  enableSegmentation: !isMobileDevice,  // Disable segmentation on mobile for performance
  minDetectionConfidence: isMobileDevice ? 0.5 : 0.5,
  minTrackingConfidence: isMobileDevice ? 0.5 : 0.5,
});

// ── Camera Setup — optimized for mobile ──
const camera = new Camera(video, {
  width: isMobileDevice ? 480 : 640,
  height: isMobileDevice ? 360 : 480,
  onFrame: async () => {
    await holistic.send({ image: video });
  },
});

camera.start().then(() => {
  if (!clonesTriggered) {
    hudStatus.textContent = gestureModel ? "READY — FORM HAND SIGN" : "MANUAL MODE — PRESS BUTTON";
  }
  
  // Set canvas size to match video for proper rendering
  const updateCanvasSize = () => {
    const container = video.parentElement;
    const rect = container.getBoundingClientRect();
    canvas.width = isMobileDevice ? 480 : 640;
    canvas.height = isMobileDevice ? 360 : 480;
  };
  
  // Initialize canvas size
  updateCanvasSize();
  window.addEventListener('resize', updateCanvasSize);
  
}).catch(err => {
  errorMsg.style.display = 'block';
  errorMsg.textContent = "⚠️ Camera access denied or unavailable. Please allow camera access and reload.";
  hudStatus.textContent = "ERROR";
});

// ── Smoke Sprites — optimized for mobile ──
const SMOKE_FOLDERS = ["smoke_1", "smoke_2", "smoke_3"];
const SMOKE_FRAME_COUNT = isMobileDevice ? 3 : 5;  // Fewer frames on mobile
const SMOKE_DURATION = isMobileDevice ? 400 : 600;  // Shorter duration on mobile
const activeSmokes = [];

function spawnSmoke(x, y, scale) {
  // Reduce smoke scale on mobile
  scale *= isMobileDevice ? 0.9 : 1.2;
  const folder = SMOKE_FOLDERS[Math.floor(Math.random() * SMOKE_FOLDERS.length)];

  const frames = [];
  for (let i = 1; i <= SMOKE_FRAME_COUNT; i++) {
    const img = new Image();
    img.src = `${ASSETS_BASE}${folder}/${i}.png`;
    frames.push(img);
  }

  activeSmokes.push({ x, y, scale, start: performance.now(), frames });
}

function drawSmokes() {
  // Limit smoke rendering on mobile for performance
  if (isMobileDevice && activeSmokes.length > 10) return;
  
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
    if (!img.width || !img.height) continue;  // Skip if image not loaded
    
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.scale(s.scale, s.scale);
    ctx.drawImage(img, -img.width / 2, -img.height / 2);
    ctx.restore();
  }
}

// ── Holistic Results Loop ──
holistic.onResults((res) => {
  if (res.segmentationMask) {
    mask = res.segmentationMask;
  }
  if (!mask) return;

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Draw live webcam as background
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  const person = grabPerson();

  // Auto trigger via gesture model
  if (!clonesTriggered && gestureModel) {
    if (predictGesture(res.rightHandLandmarks, res.leftHandLandmarks)) {
      clonesTriggered = true;
      cloneStartTime = performance.now();
      hudStatus.textContent = "🔥 CLONES ACTIVATED!";
      hudStatus.style.color = "#00ff88";
      console.log("CLONE TRIGGERED (gesture)");
    }
  }

  // Spawn smoke for each clone
  if (clonesTriggered) {
    const now = performance.now();
    customClones.forEach((cl) => {
      if (!cl.smokeSpawned && now - cloneStartTime >= cl.delay) {
        cl.smokeSpawned = true;
        const centerX = cl.x + canvas.width / 2;
        const centerY = cl.y + canvas.height / 2 - 40;
        spawnSmoke(centerX - 15, centerY, cl.scale);
        spawnSmoke(centerX + 15, centerY, cl.scale);
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

// ── Draw Clones ──
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

// ── Grab Person (Segmented) ──
const offscreenCanvas = document.createElement("canvas");
const offscreenCtx = offscreenCanvas.getContext("2d");

function grabPerson() {
  if (offscreenCanvas.width !== canvas.width) {
    offscreenCanvas.width = canvas.width;
    offscreenCanvas.height = canvas.height;
  }
  
  offscreenCtx.clearRect(0, 0, canvas.width, canvas.height);
  offscreenCtx.drawImage(mask, 0, 0, canvas.width, canvas.height);
  offscreenCtx.globalCompositeOperation = "source-in";
  offscreenCtx.drawImage(video, 0, 0, canvas.width, canvas.height);
  offscreenCtx.globalCompositeOperation = "source-over";

  return offscreenCanvas;
}

// ── Finger Skeleton ──
const FINGER_INDICES = {
  thumb:  [0, 1, 2, 3, 4],
  index:  [0, 5, 6, 7, 8],
  middle: [0, 9, 10, 11, 12],
  ring:   [0, 13, 14, 15, 16],
  pinky:  [0, 17, 18, 19, 20],
};

function drawFingerSkeleton(lm) {
  ctx.strokeStyle = "#00e5ff";
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
      3, 0, Math.PI * 2
    );
    ctx.fillStyle = "#ff4444";
    ctx.fill();
  });
}

// ── Hand Image Toggle ──
function toggleImage() {
  const img = document.getElementById("overlayImg");
  const btn = document.getElementById("overlayBtnWrap");

  if (img.dataset.state === "2") return;

  img.src = ASSETS_BASE + "state-2.png";
  img.dataset.state = "2";

  btn.classList.add("pop");
  setTimeout(() => btn.classList.remove("pop"), 200);
}
