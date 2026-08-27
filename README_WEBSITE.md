# Ultimate Jutsu Hub — Website (Self-Contained)

This folder `website/` is a **complete, self-contained copy** of `C:\Users\Samrat\Desktop\rasengen\index.html` with all required assets to run standalone (no external local dependencies).

## Contents copied from `rasengen/`

```
website/
├── index.html                         # ← Main hub (fixed, uses cv2, no Page Unresponsive)
├── sharingan.html                     # ← CV2 real-time iris-aligned Sharingan (HoughCircles + clip)
├── rasengan-chidori.html              # ← Hand AR rasengan/chidori
├── shadow-clone.html + shadow-clone.js
├── styles.css
├── hand_landmarker.task               # root fallback
├── assets/
│   ├── jutsus.json
│   ├── rasengan_orb.jpg / shadow_clone_sign.jpg / sharingan_eye.jpg
│   ├── jeet_left_aura.mp4 / jeet_right_aura.mp4
│   ├── audio/jutsu.mp3
│   ├── img/handsigns.png
│   └── models/
│       ├── mediapipe/hand_landmarker.task
│       └── teachable-machine/model.json + metadata.json + weights.bin
├── Sharingan_Eyes_CV-main/Sharingan_Eyes_CV-main/
│   ├── assets/*.png (10 sharingans) + audio/*.mp3 (12) + best.pt + sharingan.py
│   └── (YOLO best.pt → web uses Haar via OpenCV.js)
├── naruto-shadow-clone-jutsu-main/    # smoke sprites
├── js/ (empty, reserved)
└── ULTIMATE_JUTSU_GUIDE.md
```

> `naruto-handsign-recognition-main` was not present in source at copy time — `Live Dojo` link in hub will 404 but core widget (MediaPipe + TM) works. If you have that folder, copy it into `website/` as well.

Verified: `python -m http.server 8123 --directory website` → `http://127.0.0.1:8123/index.html` → 200, `assets/jutsus.json` 200, `Sharingan assets` 200.

## How to Run (must be HTTP, not file://)

**Why not double-click?** `fetch('./assets/jutsus.json')` and `fetch('./assets/models/...')` are blocked on `file://` (CORS). Use a local server:

### Option A — VS Code Live Server (recommended)
1. Open `website/` in VS Code → Right-click `index.html` → `Open with Live Server` (port 5500)
2. Open `http://127.0.0.1:5500/index.html`

### Option B — Python (one-liner)
```powershell
# PowerShell
python -m http.server 8000 --directory "C:\Users\Samrat\Desktop\rasengen\website"
# then open http://127.0.0.1:8000/index.html
```
Or double-click `START_WEBSITE.bat` (created below).

### Option C — Node
```powershell
npx serve website
```

## Features included
- Hand-sign widget (MediaPipe Hands + TeachableMachine) → custom 14 jutsus, Rasengan≠Chidori
- Sharingan CV2 lazy-loaded (fixes Page Unresponsive) → iris-precise via `HoughCircles` + contour fallback + temporal smoothing + circular clip, blink `3 frames / 0.5s cooldown / 720°@2.4s`, `0.92` alpha
- Sharingan gallery voice (`SpeechRecognition`)
- Rasengan/Chidori AR + Shadow Clone (MediaPipe)

## Deploy
Zip `website/` and deploy to any static host (Netlify, Vercel, GitHub Pages). CDN deps (`tfjs`, `teachablemachine`, `mediapipe`, `opencv.js` ~8 MB) load from internet; no install needed.

