/* Naruto Hand Sign Detector â€” VGG16 + MediaPipe
   Mirrors demo.py pipeline: flip, RGB, MediaPipe, crop with leniency 100 + 20% padding, gray, 224, predict
   + Randomize challenge using real images from ./images/*.png
*/

// --- CONFIG ---
const LABELS = ['bird','boar','dog','dragon','hare','horse','monkey','ox','ram','rat','serpent','tiger'];
const JAPANESE = {
  bird: 'Tori', boar: 'I', dog: 'Inu', dragon: 'Tatsu',
  hare: 'U', horse: 'Uma', monkey: 'Saru', ox: 'Ushi',
  ram: 'Hitsuji', rat: 'Ne', serpent: 'Mi', tiger: 'Tora'
};
const JAPANESE_FULL = {
  bird: 'Tori (Rooster)', boar: 'I (Boar)', dog: 'Inu (Dog)', dragon: 'Tatsu (Dragon)',
  hare: 'U (Hare)', horse: 'Uma (Horse)', monkey: 'Saru (Monkey)', ox: 'Ushi (Ox)',
  ram: 'Hitsuji (Ram)', rat: 'Ne (Rat)', serpent: 'Mi (Serpent)', tiger: 'Tora (Tiger)'
};
const COLORS = {
  bird:'#FF6B6B', boar:'#4ECDC4', dog:'#45B7D1', dragon:'#96CEB4',
  hare:'#FFEAA7', horse:'#DDA0DD', monkey:'#98D8C8', ox:'#F7DC6F',
  ram:'#BB8FCE', rat:'#85C1E9', serpent:'#F8B500', tiger:'#FF6F61'
};
const EMOJI = {
  bird:'ðŸ¦', boar:'ðŸ—', dog:'ðŸ¶', dragon:'ðŸ‰', hare:'ðŸ°', horse:'ðŸ´',
  monkey:'ðŸ’', ox:'ðŸ‚', ram:'ðŸ', rat:'ðŸ€', serpent:'ðŸ', tiger:'ðŸ¯'
};
// Set to your converted model path, e.g. './tfjs_model/model.json' . Leave null for demo.
const MODEL_URL = null; // e.g. './tfjs_model/model.json'
const LENIENCY = 100; // pixels like demo.py (will be scaled relative to 640)
const INPUT_SIZE = 224;
const CONF_THRESHOLD = 50; // % like demo.py color switch

let model = null;
let isModelLoaded = false;
let hands = null;
let cameraHelper = null;
let isRunning = false;
let rafId = null;
let autoInterval = null;
let challengeTarget = null;
let score = 0, attempts = 0;
let lastPredictions = {};
let smoothed = {};
let lastHandTime = 0;
let fpsLast = performance.now(), fpsCount = 0;

// DOM
const video = document.getElementById('webcam');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const loading = document.getElementById('loading');
const loadingText = document.getElementById('loading-text');
const loadingSub = document.getElementById('loading-sub');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const fpsEl = document.getElementById('fps');
const modelChip = document.getElementById('model-chip');
const predList = document.getElementById('predictions-list');
const grid = document.getElementById('reference-grid');
const challengeImg = document.getElementById('challenge-img');
const challengeFallback = document.getElementById('challenge-fallback');
const challengeLabel = document.getElementById('challenge-label');
const challengeStatus = document.getElementById('challenge-status');
const scoreEl = document.getElementById('score');
const attemptsEl = document.getElementById('attempts');

function setStatus(text, active=false) {
  statusText.textContent = text;
  statusDot.classList.toggle('active', active);
}
function setLoading(text, sub) {
  if (text) loadingText.textContent = text;
  if (sub) loadingSub.textContent = sub;
}

// --- Reference grid using REAL images ---
function buildReferenceGrid() {
  grid.innerHTML = '';
  LABELS.forEach(label => {
    const item = document.createElement('div');
    item.className = 'ref-item';
    item.id = `ref-${label}`;
    item.title = `Challenge: ${label} (${JAPANESE[label]})`;

    const img = document.createElement('img');
    img.src = `assets/img/hand-signs/${label}.png`;
    img.alt = label;
    img.loading = 'lazy';
    img.onerror = () => {
      // fallback to canvas pattern if image missing
      img.style.display = 'none';
      const fb = document.createElement('div');
      fb.style.cssText = `position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:1.6rem;background:${COLORS[label]};color:#fff;font-weight:900;`;
      fb.textContent = EMOJI[label] || label[0].toUpperCase();
      item.appendChild(fb);
    };

    const labelDiv = document.createElement('div');
    labelDiv.className = 'ref-label';
    labelDiv.textContent = label;

    const pct = document.createElement('div');
    pct.className = 'ref-pct';
    pct.id = `pct-${label}`;
    pct.textContent = '0%';
    pct.style.display = 'none';

    item.appendChild(img);
    item.appendChild(labelDiv);
    item.appendChild(pct);
    item.addEventListener('click', () => setChallenge(label));
    grid.appendChild(item);
  });
}

function updateReferencePercents(confidences) {
  LABELS.forEach(label => {
    const el = document.getElementById(`pct-${label}`);
    const item = document.getElementById(`ref-${label}`);
    if (!el || !item) return;
    const v = confidences[label] || 0;
    if (v > 5) {
      el.style.display = 'block';
      el.textContent = v + '%';
      el.style.color = v > CONF_THRESHOLD ? '#00ff88' : '#fff';
      el.style.borderColor = v > CONF_THRESHOLD ? 'rgba(0,255,136,0.5)' : 'rgba(255,255,255,0.15)';
    } else {
      el.style.display = 'none';
    }
    item.classList.toggle('active', v > CONF_THRESHOLD);
    // is-target highlight handled by challenge
  });
  // highlight challenge target
  document.querySelectorAll('.ref-item').forEach(el => el.classList.remove('is-target'));
  if (challengeTarget) {
    const t = document.getElementById(`ref-${challengeTarget}`);
    if (t) t.classList.add('is-target');
  }
}

// --- Challenge / Randomize ---
function pickRandomLabel(exclude) {
  let pool = LABELS.filter(l => l !== exclude);
  return pool[Math.floor(Math.random() * pool.length)];
}
function setChallenge(label) {
  challengeTarget = label;
  const src = `assets/img/hand-signs/${label}.png`;
  challengeImg.style.display = '';
  challengeFallback.style.display = 'none';
  challengeImg.src = src;
  challengeImg.onerror = () => {
    challengeImg.style.display = 'none';
    challengeFallback.style.display = 'flex';
    challengeFallback.textContent = EMOJI[label] || 'âœ‹';
  };
  challengeLabel.innerHTML = `${label} <span class="jp">${JAPANESE[label]}</span>`;
  challengeLabel.style.color = COLORS[label];
  challengeStatus.className = 'challenge-status waiting';
  challengeStatus.textContent = `Show "${label}" (${JAPANESE_FULL[label]}) â€” get > ${CONF_THRESHOLD}% to score!`;
  // highlight
  document.querySelectorAll('.ref-item').forEach(el => el.classList.remove('is-target'));
  const t = document.getElementById(`ref-${label}`);
  if (t) t.classList.add('is-target');
  // gentle pulse
  const wrap = document.getElementById('challenge-wrap');
  wrap.animate([{transform:'scale(1)'},{transform:'scale(1.02)'},{transform:'scale(1)'}], {duration: 400, easing: 'ease-out'});
}
function randomizeChallenge() {
  const next = pickRandomLabel(challengeTarget);
  setChallenge(next);
  attempts++;
  attemptsEl.textContent = attempts;
}
function handleChallengeResult(confidences) {
  if (!challengeTarget) return;
  const pct = confidences[challengeTarget] || 0;
  if (pct > CONF_THRESHOLD) {
    // success
    const was = challengeStatus.textContent;
    if (!challengeStatus.classList.contains('match')) {
      challengeStatus.className = 'challenge-status match';
      challengeStatus.textContent = `âœ… Matched ${challengeTarget.toUpperCase()}! ${pct}% â€” nice chakra control!`;
      score++;
      scoreEl.textContent = score;
      // confetti-ish flash
      const card = document.getElementById('challenge-card');
      card.animate([{boxShadow:'0 0 0 rgba(0,255,136,0)'},{boxShadow:'0 0 30px rgba(0,255,136,0.5)'},{boxShadow:'0 0 0 rgba(0,255,136,0)'}], {duration: 700});
      // auto next after 1.6s if not in auto mode
      setTimeout(() => {
        if (challengeStatus.textContent === `âœ… Matched ${challengeTarget.toUpperCase()}! ${pct}% â€” nice chakra control!`) {
          // only if still same target and not quickly changed
          randomizeChallenge();
        }
      }, 1600);
    }
  } else {
    // if was matched before, revert to waiting after drop
    if (challengeStatus.classList.contains('match')) {
      // keep matched for a moment, will auto-advance
    } else {
      challengeStatus.className = 'challenge-status waiting';
      const top = Object.entries(confidences).sort((a,b)=>b[1]-a[1])[0];
      if (top && top[1] > 15) {
        challengeStatus.textContent = `Target: ${challengeTarget} (${pct}%) â€” current best: ${top[0]} ${top[1]}%`;
      } else {
        challengeStatus.textContent = `Show "${challengeTarget}" â€” get > ${CONF_THRESHOLD}% to score!`;
      }
    }
  }
}

// --- Model loading ---
async function tryLoadModel() {
  if (!MODEL_URL) {
    modelChip.textContent = 'ðŸ§  Model: Demo (heuristic)';
    modelChip.style.color = '#ffd07a';
    setLoading('Demo mode â€” no TFJS model', 'Heuristic finger-pose demo. Convert VGG model for real accuracy. See footer.');
    return;
  }
  try {
    setLoading('Loading VGG16 TFJS model...', MODEL_URL);
    model = await tf.loadLayersModel(MODEL_URL);
    isModelLoaded = true;
    modelChip.textContent = 'ðŸ§  Model: VGG16 loaded';
    modelChip.style.color = '#00ff88';
    // warmup
    const dummy = tf.zeros([1, INPUT_SIZE, INPUT_SIZE, 3]);
    model.predict(dummy).dispose();
    dummy.dispose();
    setLoading('Model ready!', '');
  } catch (e) {
    console.warn('Model load failed, falling back to demo', e);
    modelChip.textContent = 'ðŸ§  Model: Demo (load failed)';
    setLoading('Model load failed â€” demo mode', String(e).slice(0, 120));
  }
}

// --- Grayscale + heuristic helpers ---
function heuristicPredictFromLandmarks(landmarks) {
  // Very lightweight heuristic to make demo feel interactive (not pure random)
  // Use MediaPipe landmarks: 0 wrist, 1-4 thumb, 5-8 index, 9-12 middle, 13-16 ring, 17-20 pinky
  // Compute finger up/down + thumb distance etc., then map to 12 classes via pseudo-probabilities.
  try {
    const tips = [4,8,12,16,20], pips = [3,6,10,14,18];
    let ups = 0;
    let fingerStates = [];
    for (let i=0; i<5; i++) {
      const tip = landmarks[tips[i]], pip = landmarks[pips[i]];
      // thumb: compare x (mirrored but consistent)
      let isUp;
      if (i===0) isUp = Math.abs(tip.x - landmarks[2].x) > 0.04;
      else isUp = tip.y < pip.y - 0.02;
      fingerStates.push(isUp ? 1 : 0);
      ups += isUp ? 1 : 0;
    }
    // distances between fingertips as extra signal
    const dist = (a,b)=> Math.hypot(a.x-b.x, a.y-b.y);
    const spread = dist(landmarks[8], landmarks[12]) + dist(landmarks[12], landmarks[16]) + dist(landmarks[16], landmarks[20]);
    const pinch = dist(landmarks[4], landmarks[8]);

    // Base random
    let base = {};
    let total = 0;
    LABELS.forEach(l => { base[l] = Math.random()*0.35 + 0.1; total += base[l]; });

    // Apply finger-state biases (tunable for fun)
    const bias = (label, amount) => { base[label] += amount; };
    // Seed biases loosely inspired by Naruto signs (not anatomically accurate, just for game feel)
    if (fingerStates[1] && fingerStates[2] && !fingerStates[3] && !fingerStates[4]) bias('tiger', 0.9);
    if (!fingerStates[1] && !fingerStates[2] && fingerStates[3] && fingerStates[4]) bias('boar', 0.8);
    if (fingerStates[1] && !fingerStates[2] && !fingerStates[3] && fingerStates[4]) bias('dog', 0.7);
    if (ups >= 4) bias('ram', 0.75);
    if (ups <= 1) bias('serpent', 0.85);
    if (pinch < 0.05) bias('bird', 0.8);
    if (spread > 0.25) bias('dragon', 0.6);
    if (fingerStates[1] && fingerStates[2] && fingerStates[3] && !fingerStates[4]) bias('hare', 0.65);
    if (!fingerStates[1] && fingerStates[2] && fingerStates[3] && fingerStates[4]) bias('horse', 0.6);
    if (fingerStates[1] && fingerStates[2] && fingerStates[3] && fingerStates[4]) bias('monkey', 0.5);
    if (fingerStates[0] && !fingerStates[1] && !fingerStates[2]) bias('ox', 0.6);
    if (fingerStates[2] && fingerStates[3]) bias('rat', 0.5);

    // Normalize to probs 0..100
    total = Object.values(base).reduce((a,b)=>a+b,0);
    let probs = {};
    LABELS.forEach(l => probs[l] = base[l]/total);
    // Smooth with previous to avoid jitter
    LABELS.forEach(l => {
      const prev = smoothed[l] || probs[l];
      smoothed[l] = prev * 0.7 + probs[l] * 0.3;
    });
    // Renorm smoothed
    let sTotal = Object.values(smoothed).reduce((a,b)=>a+b,0);
    LABELS.forEach(l => smoothed[l] = smoothed[l]/sTotal);
    return smoothed;
  } catch (e) {
    // fallback random
    let r = {}; LABELS.forEach(l=> r[l]=Math.random()); let t=Object.values(r).reduce((a,b)=>a+b,0); LABELS.forEach(l=> r[l]/=t); return r;
  }
}

async function predictFromCanvas(cropCanvas, landmarks) {
  // If real model, run TFJS
  if (isModelLoaded && model) {
    try {
      const tensor = tf.tidy(() => {
        let t = tf.browser.fromPixels(cropCanvas).toFloat().div(255);
        // demo.py did BGRâ†’Grayâ†’BGR but we did canvas gray already; keep as is.
        // Ensure 3 channels; tf.browser.fromPixels gives 3 for our canvas.
        t = tf.image.resizeBilinear(t, [INPUT_SIZE, INPUT_SIZE]);
        return t.expandDims(0);
      });
      const pred = model.predict(tensor);
      const data = await pred.data();
      tensor.dispose();
      if (pred.dispose) pred.dispose();
      let out = {};
      LABELS.forEach((l,i)=> out[l] = data[i]);
      // smooth
      LABELS.forEach(l => {
        const prev = smoothed[l] || out[l];
        smoothed[l] = prev * 0.65 + out[l] * 0.35;
      });
      let total = Object.values(smoothed).reduce((a,b)=>a+b,0);
      LABELS.forEach(l => smoothed[l] = smoothed[l]/total);
      return smoothed;
    } catch (e) {
      console.error('TF predict failed', e);
    }
  }
  // demo heuristic
  return heuristicPredictFromLandmarks(landmarks[0]);
}

// --- Rendering predictions ---
function renderPredictions(confidences) {
  const entries = Object.entries(confidences)
    .map(([k,v]) => [k, Math.round(v*100)])
    .sort((a,b)=> b[1]-a[1])
    .slice(0, 6);

  if (!entries.length || entries[0][1] === 0) {
    predList.innerHTML = `<div class="empty-pred">No hand detected â€” show your hand to the camera</div>`;
    updateReferencePercents({});
    return;
  }

  predList.innerHTML = '';
  entries.forEach(([label, pct]) => {
    const item = document.createElement('div');
    item.className = 'prediction-item';
    if (pct > CONF_THRESHOLD) item.classList.add('high');
    if (challengeTarget && label === challengeTarget && pct > CONF_THRESHOLD) item.classList.add('is-target');

    const left = document.createElement('div');
    left.className = 'pred-left';
    left.innerHTML = `<div class="pred-name" style="color:${COLORS[label]}">${EMOJI[label]} ${label} <span class="pred-jp">${JAPANESE[label]}</span></div>`;

    const bar = document.createElement('div');
    bar.className = 'pred-bar';
    const fill = document.createElement('div');
    fill.className = 'pred-fill';
    fill.style.width = pct + '%';
    fill.style.background = pct > CONF_THRESHOLD ? (challengeTarget===label ? '#00ff88' : '#ff6a00') : COLORS[label];
    bar.appendChild(fill);

    const pctEl = document.createElement('div');
    pctEl.className = 'pred-pct';
    pctEl.textContent = pct + '%';
    pctEl.style.color = pct > CONF_THRESHOLD ? (challengeTarget===label ? '#00ff88' : '#ff6a00') : 'rgba(255,255,255,0.85)';

    item.appendChild(left);
    item.appendChild(bar);
    item.appendChild(pctEl);
    predList.appendChild(item);
  });

  const asPct = {};
  Object.entries(confidences).forEach(([k,v])=> asPct[k]=Math.round(v*100));
  updateReferencePercents(asPct);
  handleChallengeResult(asPct);
}

// --- MediaPipe ---
async function initHands() {
  setLoading('Loading MediaPipe Hands...', 'Downloading wasm (~2 MB) via CDN');
  hands = new Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
  });
  hands.setOptions({
    maxNumHands: 1,
    modelComplexity: 1,
    minDetectionConfidence: 0.7,
    minTrackingConfidence: 0.5
  });
  hands.onResults(onResults);
  await tryLoadModel();
  setLoading('Ready â€” click Start Camera', 'Camera requires HTTPS or localhost. Allow permission when prompted.');
  setStatus('Ready â€” click Start Camera', false);
  loading.classList.add('hidden');
  setTimeout(()=> loading.style.display='none', 500);
}

async function onResults(results) {
  fpsCount++;
  const now = performance.now();
  if (now - fpsLast > 1000) {
    fpsEl.textContent = Math.round(fpsCount * 1000 / (now - fpsLast)) + ' fps';
    fpsCount = 0; fpsLast = now;
  }

  // Resize canvas to match video
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  ctx.clearRect(0,0,canvas.width, canvas.height);
  ctx.save();
  // Because video is mirrored via CSS, we draw mirrored landmarks manually by flipping.
  // But MediaPipe already returns non-mirrored coords relative to input image.
  // We'll mirror the drawing to match display.
  ctx.scale(-1, 1);
  ctx.translate(-canvas.width, 0);

  if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
    setStatus('Hand detected â€” analyzing...', true);

    // Draw landmarks
    results.multiHandLandmarks.forEach(landmarks => {
      drawConnectors(ctx, landmarks, HAND_CONNECTIONS, {color: '#00FF88', lineWidth: 2});
      drawLandmarks(ctx, landmarks, {color: '#FF3B30', lineWidth: 1, radius: 3});
    });

    // Compute bounding box + leniency like demo.py
    const landmarks = results.multiHandLandmarks[0];
    let xs = [], ys = [];
    landmarks.forEach(lm => {
      xs.push(lm.x * canvas.width);
      ys.push(lm.y * canvas.height);
    });
    // Leniency in pixels relative to canvas width (demo used 100 on ~640px feed)
    const scale = canvas.width / 640;
    const leniency = LENIENCY * scale;
    const padding = 0.20; // extra 20% like JS version
    let minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    let w = maxX - minX, h = maxY - minY;
    // apply padding
    minX = Math.max(0, minX - w*padding - leniency);
    minY = Math.max(0, minY - h*padding - leniency);
    maxX = Math.min(canvas.width,  maxX + w*padding + leniency);
    maxY = Math.min(canvas.height, maxY + h*padding + leniency);

    // Draw rectangle (mirrored coords)
    ctx.strokeStyle = '#FF6A00';
    ctx.lineWidth = 2;
    ctx.strokeRect(minX, minY, maxX-minX, maxY-minY);

    ctx.restore();

    // Crop from video (need to handle mirroring: video element is mirrored CSS, but capture is non-mirrored)
    // Easiest: draw video non-mirrored to cropCanvas, then flip via scale.
    const cropW = Math.max(1, maxX - minX);
    const cropH = Math.max(1, maxY - minY);
    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = cropW;
    cropCanvas.height = cropH;
    const cropCtx = cropCanvas.getContext('2d');
    // video is mirrored display, but underlying pixels are non-mirrored; we want consistent with landmarks.
    // Landmarks are from non-mirrored image, so crop directly.
    cropCtx.drawImage(video, minX, minY, cropW, cropH, 0, 0, cropW, cropH);

    // Convert to grayscale and resize to 224 like demo.py
    // demo.py: cropped = cvt BGR2GRAY then back to BGR. We replicate via luminance.
    const grayCanvas = document.createElement('canvas');
    grayCanvas.width = INPUT_SIZE;
    grayCanvas.height = INPUT_SIZE;
    const gctx = grayCanvas.getContext('2d');
    gctx.drawImage(cropCanvas, 0, 0, INPUT_SIZE, INPUT_SIZE);
    const imgData = gctx.getImageData(0,0,INPUT_SIZE,INPUT_SIZE);
    const d = imgData.data;
    for (let i=0; i<d.length; i+=4) {
      const lum = 0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2];
      d[i]=d[i+1]=d[i+2]=lum;
    }
    gctx.putImageData(imgData, 0, 0);

    const confs = await predictFromCanvas(grayCanvas, results.multiHandLandmarks);
    renderPredictions(confs);
    lastHandTime = now;
  } else {
    ctx.restore();
    setStatus('No hand detected â€” show your hand!', false);
    // fade out predictions slowly
    if (now - lastHandTime > 600) {
      renderPredictions({});
    }
  }
}

// --- Camera ---
async function startCamera() {
  try {
    setStatus('Requesting camera...', false);
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' }, audio: false });
    video.srcObject = stream;
    await video.play();
    // Mobile: ensure dimensions
    await new Promise(res => {
      if (video.videoWidth) res();
      else video.onloadedmetadata = res;
    });
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    if (typeof Camera !== 'undefined' && Camera) {
      cameraHelper = new Camera(video, {
        onFrame: async () => {
          if (hands) await hands.send({image: video});
        },
        width: 640, height: 480
      });
      cameraHelper.start();
    } else {
      // manual loop
      const loop = async () => {
        if (!isRunning) return;
        await hands.send({image: video});
        rafId = requestAnimationFrame(loop);
      };
      isRunning = true;
      loop();
    }

    setStatus('Camera running â€” show a hand sign!', true);
    document.getElementById('start-btn').textContent = 'âœ… Camera On';
    document.getElementById('start-btn').disabled = true;
    // init predictions smoothing
    LABELS.forEach(l=> smoothed[l]=1/LABELS.length);
    if (!challengeTarget) setChallenge(pickRandomLabel());
  } catch (err) {
    console.error(err);
    setStatus('Camera blocked â€” allow permission + use HTTPS', false);
    alert('Camera access denied. Please allow camera and use HTTPS/localhost.\n\nError: ' + err.message);
  }
}

function takeScreenshot() {
  const c = document.createElement('canvas');
  c.width = video.videoWidth || 640;
  c.height = video.videoHeight || 480;
  const cctx = c.getContext('2d');
  // draw video + overlay
  cctx.scale(-1,1); cctx.translate(-c.width,0);
  cctx.drawImage(video, 0,0, c.width,c.height);
  cctx.setTransform(1,0,0,1,0,0);
  cctx.drawImage(canvas, 0,0);
  const a = document.createElement('a');
  a.download = `handsign-${Date.now()}.png`;
  a.href = c.toDataURL('image/png');
  a.click();
}

// --- Init ---
// --- Voice Control: ONLY Rasengan & Sharingan jutsu activate (exclusive) ---
let voiceRec=null, isVoiceOn=false;
const _RASENGAN = { name:'Rasengan', color:'#00bfff', emoji:'ðŸŒ€', page:'jutsus/rasengan.html', signs:['Ushi','Tora','U','Inu','I'] };
const _SHARINGAN = { name:'Sharingan', color:'#ff1a1a', emoji:'ðŸ‘ï¸', page:'jutsus/sharingan.html', signs:['Mi','Tori','Ushi','Uma','I'] };
const VOICE_JUTSUS = {
  'rasengan': _RASENGAN, 'rasegan': _RASENGAN, 'rasegna': _RASENGAN, 'rasen': _RASENGAN,
  'sharingan': _SHARINGAN, 'sharigan': _SHARINGAN, 'sharingam': _SHARINGAN,
};
const VOICE_HANDSIGNS_EX = {
  'bird': 'bird', 'tori': 'bird',
  'boar': 'boar',
  'dog': 'dog', 'inu': 'dog',
  'dragon': 'dragon', 'tatsu': 'dragon',
  'hare': 'hare',
  'horse': 'horse', 'uma': 'horse',
  'monkey': 'monkey', 'saru': 'monkey',
  'ox': 'ox', 'ushi': 'ox',
  'ram': 'ram',
  'rat': 'rat',
  'serpent': 'serpent', 'snake': 'serpent',
  'tiger': 'tiger', 'tora': 'tiger',
};
function hasWord(text, word){
  word=word.trim().toLowerCase();
  if(word.length<=2){
    try{ return new RegExp('\b' + word + '\b','i').test(text); }catch(e){ return (' '+text+' ').includes(' '+word+' '); }
  }
  return text.includes(word);
}
function initVoice(){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!SR){ const el=document.getElementById('voice-text'); if(el) el.textContent='Voice not supported (use Chrome/Edge)'; return; }
  voiceRec = new SR(); voiceRec.continuous=true; voiceRec.interimResults=false; voiceRec.lang='en-US';
  voiceRec.onstart=()=>{ document.getElementById('voice-status').classList.add('active'); const b=document.getElementById('voice-btn'); b.classList.add('voice-active'); b.textContent='ðŸŽ¤ Voice On'; setStatus('Voice listening â€” say "Rasengan" or "Sharingan"', true); };
  voiceRec.onend=()=>{ if(isVoiceOn){ try{ voiceRec.start(); }catch(e){} } else { document.getElementById('voice-status').classList.remove('active'); const b=document.getElementById('voice-btn'); b.classList.remove('voice-active'); b.textContent='ðŸŽ¤ Voice Off'; } };
  voiceRec.onerror=(e)=>{ const t=document.getElementById('voice-text'); if(e.error==='not-allowed') t.textContent='Mic blocked â€” allow + use HTTPS'; else if(e.error==='no-speech') t.textContent='No speech â€” say "Rasengan" loudly'; else t.textContent='Voice error: '+e.error; };
  voiceRec.onresult=(e)=>{ const last=e.results[e.results.length-1]; const transcript=last[0].transcript.toLowerCase().trim(); const heard=document.getElementById('voice-heard'); if(heard) heard.textContent='"'+transcript+'"'; handleVoiceTranscript(transcript); };
}
function toggleVoice(){
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR){ alert('Voice not supported â€” use Chrome/Edge on HTTPS/localhost'); return; }
  if(isVoiceOn){ isVoiceOn=false; try{ voiceRec.stop(); }catch(e){} document.getElementById('voice-status').classList.remove('active'); const b=document.getElementById('voice-btn'); b.classList.remove('voice-active'); b.textContent='ðŸŽ¤ Voice Off'; setStatus('Voice off', false); }
  else{ isVoiceOn=true; try{ voiceRec.start(); }catch(e){ document.getElementById('voice-status').classList.add('active'); const b=document.getElementById('voice-btn'); b.classList.add('voice-active'); b.textContent='ðŸŽ¤ Voice On'; } }
}
function handleVoiceTranscript(raw){
  const t=raw.toLowerCase().trim();
  for(const [key,info] of Object.entries(VOICE_JUTSUS)){
    const k=key.trim().toLowerCase();
    if(hasWord(t,k)){
      triggerJutsuVoice(info, raw);
      document.querySelectorAll('.arena-card').forEach(c=>c.classList.remove('active'));
      const arenaId = info.name==='Rasengan' ? 'arena-rasengan' : 'arena-sharingan';
      const el=document.getElementById(arenaId); if(el){ el.classList.add('active'); setTimeout(()=>el.classList.remove('active'), 2200); el.animate([{transform:'scale(1)'},{transform:'scale(1.06)'},{transform:'scale(1)'}],{duration:500}); }
      return;
    }
  }
  if(hasWord(t,'randomize')||hasWord(t,'next')||hasWord(t,'shuffle')||hasWord(t,'another')){ randomizeChallenge(); speakBack('Randomized'); return; }
  if(t.includes('screenshot')||t.includes('capture')||t.includes('photo')){ takeScreenshot(); speakBack('Screenshot saved'); return; }
  if(t.includes('start camera')||hasWord(t,'start')){ startCamera(); speakBack('Camera starting'); return; }
  for(const [key,label] of Object.entries(VOICE_HANDSIGNS_EX)){
    const k=key.trim().toLowerCase();
    if(k.length<=2){ if(hasWord(t,k)){ setChallenge(label); const cs=document.getElementById('voice-text'); if(cs) cs.textContent=`ðŸŽ¤ "${raw}" â†’ ${label.toUpperCase()}`; speakBack(label); return; } }
    else { if(t.includes(k)){ setChallenge(label); const cs=document.getElementById('voice-text'); if(cs) cs.textContent=`ðŸŽ¤ "${raw}" â†’ ${label.toUpperCase()}`; speakBack(label); return; } }
  }
  const vt=document.getElementById('voice-text'); if(vt) vt.textContent=`Heard: "${raw}" â€” say "Rasengan" or "Sharingan" (or Tiger, Randomize)`;
}
function speakBack(text){ try{ const u=new SpeechSynthesisUtterance(text); u.lang='en-US'; u.rate=1; u.volume=0.9; speechSynthesis.speak(u);}catch(e){} }
function triggerJutsuVoice(info, raw){
  const vt=document.getElementById('voice-text'); if(vt) vt.textContent=`🎤 "${raw}" → ${info.emoji} ${info.name}`;
  // Exclusive: button click then only jutsu from website/jutsus
  const key = info.name.toLowerCase();
  activateJutsu(key);
}
function activateJutsu(name){
  const keyRaw = String(name).toLowerCase().trim();
  let jutsu='rasengan';
  if(keyRaw.includes('sharigan')||keyRaw.includes('sharingan')||keyRaw.includes('sharingam')) jutsu='sharingan';
  else if(keyRaw.includes('rasen')||keyRaw.includes('rasegna')||keyRaw.includes('rasegan')) jutsu='rasengan';
  else if(keyRaw==='rasengan'||keyRaw==='sharingan') jutsu=keyRaw;
  else jutsu=keyRaw;
  const info = VOICE_JUTSUS[jutsu] || VOICE_JUTSUS['rasengan'];
  if(!info) return;
  // Arena highlight
  document.querySelectorAll('.arena-card').forEach(c=>c.classList.remove('active'));
  const arenaId = jutsu==='rasengan' ? 'arena-rasengan' : (jutsu==='sharingan' ? 'arena-sharingan' : null);
  const el = arenaId ? document.getElementById(arenaId) : null;
  if(el){ el.classList.add('active'); setTimeout(()=>el.classList.remove('active'), 2200); el.animate([{transform:'scale(1)'},{transform:'scale(1.06)'},{transform:'scale(1)'}],{duration:500}); }
  // Stage from website/jutsus
  const stage=document.getElementById('jutsu-stage');
  const iframe=document.getElementById('jutsu-iframe');
  const titleEl=document.getElementById('jutsu-stage-title');
  const iconEl=document.getElementById('jutsu-stage-icon');
  const pathEl=document.getElementById('jutsu-stage-path');
  if(!stage||!iframe){
    // fallback simple overlay if stage missing
    const overlay=document.createElement('div');
    overlay.style.cssText='position:fixed;inset:0;z-index:9998;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.72);backdrop-filter:blur(8px);';
    overlay.innerHTML=`<div style="background:rgba(20,20,30,0.96);border:1px solid ${info.color};border-radius:20px;padding:24px;max-width:440px;width:90%;text-align:center;box-shadow:0 20px 60px ${info.color}55;animation:pop 0.4s both;"><div style="font-size:2.4rem;">${info.emoji}</div><div style="font-size:1.6rem;font-weight:900;color:${info.color};margin-top:6px;">${info.name.toUpperCase()}</div><div style="color:#fff;font-size:0.82rem;margin-top:6px;letter-spacing:1px;">${info.signs.join(' → ')}</div><div style="display:flex;gap:8px;justify-content:center;margin-top:14px;"><button onclick="this.closest('div').parentElement.parentElement.remove()" style="padding:8px 14px;border-radius:50px;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.15);color:#fff;cursor:pointer;">✕ Close</button></div></div>`;
    document.body.appendChild(overlay); overlay.onclick=(e)=>{ if(e.target===overlay) overlay.remove(); }; setTimeout(()=>{ if(overlay.parentElement) overlay.remove(); },3500);
    speakBack(info.name); return;
  }
  let src='';
  if(window.location.pathname.includes('Naruto_Handsign_Classification')){
    src='../website/jutsus/'+jutsu+'.html';
  } else {
    src='jutsus/'+jutsu+'.html';
  }
  if(titleEl) titleEl.textContent=info.name.toUpperCase();
  if(iconEl) iconEl.textContent=info.emoji;
  if(pathEl) pathEl.textContent=src + ' (from website/jutsus)';
  iframe.src=src;
  stage.style.display='flex';
  speakBack(info.name + ' activated');
  try{ const ac=new (window.AudioContext||window.webkitAudioContext)(); const o=ac.createOscillator(),g=ac.createGain(); o.connect(g); g.connect(ac.destination); o.frequency.setValueAtTime(440,ac.currentTime); o.frequency.exponentialRampToValueAtTime(880,ac.currentTime+0.3); g.gain.setValueAtTime(0.15,ac.currentTime); g.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+0.4); o.start(); o.stop(ac.currentTime+0.4);}catch(e){}
  try{ score+=2; document.getElementById('score').textContent=score; }catch(e){}
}
function closeJutsuStage(){
  const stage=document.getElementById('jutsu-stage');
  const iframe=document.getElementById('jutsu-iframe');
  if(stage) stage.style.display='none';
  if(iframe) iframe.src='about:blank';
}
window.activateJutsu=activateJutsu;
window.closeJutsuStage=closeJutsuStage;
window.triggerJutsuVoice=triggerJutsuVoice;

async function init() {
  buildReferenceGrid();
  setChallenge('tiger');
  await initHands();

  document.getElementById('start-btn').addEventListener('click', startCamera);
  document.getElementById('randomize-btn').addEventListener('click', randomizeChallenge);
  document.getElementById('new-challenge-btn').addEventListener('click', randomizeChallenge);
  document.getElementById('reveal-btn').addEventListener('click', () => {
    if (!challengeTarget) return;
    challengeStatus.className = 'challenge-status waiting';
    challengeStatus.textContent = `Target: ${challengeTarget} (${JAPANESE_FULL[challengeTarget]}) â€” ${COLORS[challengeTarget]}`;
  });
  document.getElementById('screenshot-btn').addEventListener('click', takeScreenshot);
  const vb=document.getElementById('voice-btn'); if(vb) vb.addEventListener('click', toggleVoice);
  document.getElementById('auto-btn').addEventListener('click', (e) => {
    const btn = e.currentTarget;
    if (autoInterval) {
      clearInterval(autoInterval); autoInterval=null;
      btn.textContent='â± Auto';
      btn.style.background='';
    } else {
      autoInterval = setInterval(randomizeChallenge, 5000);
      btn.textContent='â¸ Stop Auto';
      btn.style.background='rgba(255,106,0,0.2)';
    }
  });
  document.getElementById('shuffle-hint').addEventListener('click', () => {
    // shuffle grid visually
    const items = Array.from(grid.children);
    for (let i=items.length-1; i>0; i--) {
      const j = Math.floor(Math.random()*(i+1));
      grid.appendChild(items[j]);
    }
  });

  // keyboard: space = randomize, s = screenshot
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') { e.preventDefault(); randomizeChallenge(); }
    if (e.key.toLowerCase() === 's') takeScreenshot();
  });
}

init();

