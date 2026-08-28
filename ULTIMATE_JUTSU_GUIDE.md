# 🌀 Naruto Ultimate Jutsu Hub — CUSTOM Handsigns Guide

## What was built for you

Your request:
- **Every single jutsu has a CUSTOM handsign** ✅
- **Rasengan & Chidori both DIFFERENT** ✅ (not same palm-open, fully distinct sequences & VFX)
- **Python code → HTML website** ✅ (`rasengan.py` ModernGL → `rasengan-chidori.html` + `index.html` Hub)
- **Shadow Clone → redirected into clone dimension** ✅
- **Sharingan → image appears + say number of eyes + you get the eyes** ✅

---

## 🎯 14 CUSTOM Jutsu Sequences (ALL UNIQUE)

| Jutsu | Hand Signs (perform in ORDER) | Type |
|-------|------------------------------|------|
| **Thunderstorm Jutsu** | Uma → Tora → Mi | Lightning |
| **Tidal Wave Jutsu** | Uma → Mi → Inu → Tatsu → Release | Water |
| **Magma Eruption** | Tora → Tatsu → Ne → Tora | Fire |
| **Sandstorm Jutsu** | Uma → U → Inu → Saru → Tori | Wind |
| **Ice Shard Jutsu** | Tori → Saru → Mi → Tori → Release | Ice |
| **Tornado Jutsu** | Ushi → U → Inu → Tatsu → Tori | Wind |
| **Earth Wall Jutsu** | Saru → Ne → Tatsu → Ushi → Tora | Earth |
| **Fog Concealment** | Tori → Tatsu → Mi → Ne → Uma | Mist |
| **Water Strike** | Tora → U → Ne → Tori → Saru | Water |
| **Fire Ball Jutsu** | Ne → Tora → Tatsu → Mi → Tori → Tora | Fire |
| **🌀 Rasengan** | **Ushi → Tora → U → Inu → I** | **CUSTOM BLUE** |
| **⚡ Chidori** | **Tori → U → Tatsu → Inu → Tora** | **CUSTOM PURPLE (1000 birds)** |
| **👥 Shadow Clone** | **Tora → Saru → Uma → I → Release** | **REDIRECT** |
| **👁️ Sharingan** | **Mi → Tori → Ushi → Uma → I** | **VOICE EYES** |

> **Rasengan ≠ Chidori** — Rasengan is blue spiral orb (spinning chakra rings), Chidori is purple lightning with chirping birds + screen shake. Totally distinct code paths in `assets/js/jutsu-effects.js:showRasengan()` vs `showChidori()`.

Hand signs legend: `I=Boar, Inu=Dog, Mi=Snake, Ne=Rat, Saru=Monkey, Tatsu=Dragon, Tora=Tiger, Tori=Rooster, U=Hare, Uma=Horse, Ushi=Ox, Release=open palm`

---

## 🌐 Website Structure

```
C:/Users/Samrat/Desktop/rasengen/
├── index.html  ← **ULTIMATE HUB** (NEW: camera widget + hand-sign auto-redirect)
├── rasengan-chidori.html  ← Python ModernGL → HTML5 (WebGL/Canvas + MediaPipe Hands)
├── shadow-clone.html  ← Clone dimension (selfie segmentation)
├── sharingan.html  ← Eye gallery + VOICE (now also listens for "three"/"seven")
├── assets/
│   ├── jutsus.json  ← 14 CUSTOM sequences
│   ├── models/teachable-machine/  ← 12 classes: I,Inu,Mi,Ne,Release,Saru,Tatsu,Tora,Tori,U,Uma,Ushi
│   └── jeet_left_aura.mp4 / jeet_right_aura.mp4  ← chakra VFX
└── naruto-handsign-recognition-main/naruto-handsign-recognition-main/
    ├── index.html  ← **LIVE DOJO** (full-screen camera jutsu mode, enhanced)
    ├── assets/js/jutsu-effects.js  ← NEW: per-jutsu VFX engine
    ├── assets/js/jutsu-manager.js  ← UPDATED: dispatches to effects + redirect
    ├── assets/css/style.css & modal.css  ← UPDATED: premium UI
    └── assets/jutsus.json  ← 14 CUSTOM
```

---

## 🔄 Python → HTML Conversion

**`rasengan.py`** (39622 bytes, ModernGL + GLFW + MediaPipe):
- Shaders: `cube.vert / cube.geom / cube.frag` → spiral chakra strips (geometry shader expands points into ribbons)
- `createBillboardImage` → additive glow billboards
- HDR bloom post-processing
- Webcam mode: orb follows your open palm via MediaPipe

**Converted to `rasengan-chidori.html` + Hub effects:**
- ModernGL → WebGL/Canvas 2D + CSS 3D transforms + MP4 aura videos (`jeet_left_aura.mp4` for Rasengan blue, `jeet_right_aura.mp4` for Chidori purple)
- GLFW window → HTML5 `<canvas>` + `<video>` with `object-fit:cover; mix-blend-mode:screen`
- `HandTracker.process()` → `Hands` from MediaPipe (`https://cdn.jsdelivr.net/npm/@mediapipe/hands`) + `drawConnectors/drawLandmarks`
- Bloom → CSS `box-shadow: 0 0 40px #00bfff` + canvas particle glow
- Palm anchor logic kept: `checkOpen()` counts finger tips vs PIPs, right hand = Rasengan blue, left hand = Chidori purple

---

## 🎮 How to Use

### 1) Open Hub
```bash
py -m http.server 8000
# open http://localhost:8000/index.html  (Ultimate Hub)
# or open file directly: C:/Users/Samrat/Desktop/rasengen/index.html
```
Allow camera.

### 2) Perform hand signs via CAMERA WIDGET (bottom-right)
- Widget shows live camera (circular), current prediction, sequence history (past labels), loading circle.
- Each correct sign holds ~0.7s (threshold) to register.
- Sequence builds at bottom (e.g., Tora → Saru ... ).
- Remove hands to reset.

### 3) Trigger special jutsus
- **Rasengan** `Ushi → Tora → U → Inu → I` → blue spiral appears, card glows blue, confirm dialog → go to Rasengan AR dimension (`rasengan-chidori.html`)
- **Chidori** `Tori → U → Tatsu → Inu → Tora` → purple lightning + chirping + shake, card glows purple → go to Chidori dimension (`rasengan-chidori.html?jutsu=chidori`)
- **Shadow Clone** `Tora → Saru → Uma → I → Release` → white smoke + 3 clones overlay on hub → **auto-redirect after 2.2s to `shadow-clone.html`** (your request: "redirected into the shadow clone")
- **Sharingan** `Mi → Tori → Ushi → Uma → I` → red flash + voice panel appears **on hub**: says "Say number of eyes..." → **say "two" / "5" / "seven"** (or type 1-10) → eyes spawn instantly, each eye spins and plays audio, plus small eye overlay on your camera feed. Also offers button to go to full `sharingan.html` dimension where voice also works.

### 4) Full Dojo Mode
Click **🎯 Full Dojo** in widget or go to `naruto-handsign-recognition-main/naruto-handsign-recognition-main/index.html`
- Full-screen camera with bigger loading circle.
- Same 14 CUSTOM sequences.
- Per-jutsu VFX full-screen via `jutsu-effects.js`:
  - Rasengan: 200px blue orb + spinning rings + particle canvas (90 particles)
  - Chidori: 180px purple orb + flicker + 120 lightning particles + screen shake
  - Shadow Clone: clones your canvas 3x + smoke + flash cyan + auto-redirect to `../../shadow-clone.html`
  - Sharingan: red flash + modal with voice input (SpeechRecognition) + type fallback + eye grid + click eye to play sound + overlay eyes on webcam container corners

---

## 🎤 Sharingan Voice Details

1. Do `Sharingan Jutsu` hand signs: **Mi → Tori → Ushi → Uma → I**
2. Red flash + panel: “Say the number of eyes you want... Try: ‘one’ / ‘two’ / ‘three’ ... up to ‘ten’”
3. **Speak**: Chrome will ask mic permission (needs HTTPS or localhost).
   - Say **“three”**, **“five”**, **“seven eyes”**, or **“2”**
   - Code uses `webkitSpeechRecognition` continuous, word map `{one:1, two:2, ... ten:10}`
   - Also parses digits via regex `/(\d+)/`
4. Eyes appear: up to 10, each 88px circle, spinning (`spin-slow 3s linear infinite`), border red, shadow red. Click any eye to play its unique audio (`Sharingan_Eyes_CV-main/audio/1.mp3` ... `10.mp3`).
5. On hub, small eye overlays also appear on your webcam feed corners for 5.5s.
6. Fallback: type number 1-10 and press AWAKEN.

Files:
- `Sharingan_Eyes_CV-main/Sharingan_Eyes_CV-main/assets/` = 10 eye PNGs
- `Sharingan_Eyes_CV-main/Sharingan_Eyes_CV-main/audio/` = 10 mp3s
- Voice handled in `assets/js/jutsu-effects.js:showSharingan()` (Dojo) and inline in `index.html:hubSharinganVoiceEffect()` (Hub) + `sharingan.html:initVoice()` (Sharingan page)

---

## 👥 Shadow Clone Redirect Details

- Sequence **Tora → Saru → Uma → I → Release** (ends with Release = open palm, like hand seals)
- Triggers `showShadowClone()`:
  - Captures `webcam.canvas` (TeachableMachine webcam)
  - Creates 3 clone divs with copied canvas image + “CLONE 1/2/3” badge
  - White smoke radial gradient + flash cyan `flashOverlay` (or full-screen cyan flash)
  - Container `clone-overlay` fixed inset 0 with flex gap
  - After 2.2s, auto `window.location.href = "shadow-clone.html"` (or `../../shadow-clone.html` from Dojo)
  - Hub also shows confirm + button “ENTER CLONE DIMENSION”

---

## 🎨 Rasengan vs Chidori Distinctness

| Feature | Rasengan | Chidori |
|---------|----------|---------|
| **Handsign** | Ushi→Tora→U→Inu→I (includes **I/Boar**) | Tori→U→Tatsu→Inu→Tora (starts **Tori**, ends **Tora**) |
| **Color** | Blue `#00bfff` | Purple `#b824ff` |
| **Core** | White→sky blue→deep blue radial | White→light purple→deep purple radial |
| **Rings** | 240px cyan border + 280px dashed outer | 260px purple solid + 300px thin outer |
| **Particles** | 90 blue, slow drift | 120 purple, lightning arcs |
| **Sound** | Sawtooth 180→60Hz low rumble | Square + 6 chirping 1200→ bird sounds |
| **Animation** | Smooth spin 1.2s | Fast flicker 0.15s + shake |
| **Video** | `jeet_left_aura.mp4` (blue) | `jeet_right_aura.mp4` (purple) |

Implemented in `jutsu-effects.js` lines: `showRasengan():58` vs `showChidori():122`.

---

## 🚀 Quick Start Commands

```bash
# from C:/Users/Samrat/Desktop/rasengen
py -m http.server 8000
# open:
# http://localhost:8000/index.html  → Hub with camera widget
# http://localhost:8000/naruto-handsign-recognition-main/naruto-handsign-recognition-main/index.html → Full Dojo
# http://localhost:8000/sharingan.html  → Sharingan voice (after hub)
# http://localhost:8000/shadow-clone.html → Clone dimension
# http://localhost:8000/rasengan-chidori.html → Rasengan/Chidori AR (open palm)
```

> **Tip:** For voice (Sharingan), use Chrome + localhost/HTTPS. Microphone permission required. If blocked, just type number.

---

## ✅ Checklist

- [x] Every jutsu has CUSTOM unique handsign (14/14)
- [x] Rasengan & Chidori distinct (different sequences, different VFX, different sounds)
- [x] Python rasengan.py → HTML (rasengan-chidori.html + hub)
- [x] Shadow Clone → smoke + 3 clones + **redirect**
- [x] Sharingan → image grid + **say number via voice → eyes appear**
- [x] Lives at `index.html` (hub) + `naruto-handsign.../index.html` (dojo) — both work via file:// or http server

Enjoy, shinobi! 🌀⚡👁️👥
