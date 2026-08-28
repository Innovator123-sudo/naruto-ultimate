# Naruto Shadow Clone

A browser-based app that uses your webcam, hand tracking, and a custom-trained gesture model to trigger Naruto shadow clone effect in real time.

> **⚠️ Important:**
> 
> - The trained hand sign dataset and model files are **not included** in this repository. I encourage you to use `trainer.html` to train the model yourself! See instructions below or in this video: 
> - **Browser:** Chrome recommended (may glitch on Safari).
> - **Webcam**: A webcam is required

## Note:

- Yes, it’s an ML project in JS and not Python :P hehe
- I am not a MLE or Data Scientist. My goal was to make it exist, not to make it optimal (this can be done by you!)
- I used a simple neural network in my version (see `trainer.js`). For those who wish to get better performance, I encourage you to mess around with the topology of the model or even try new models entirely

## Files Included

| File | Description |
| --- | --- |
| `index.html` | Main app: webcam feed with clone jutsu |
| `script.js` | Clone rendering, gesture detection, smoke effects |
| `styles.css` | Styling for the main page |
| `trainer.html` | UI for recording hand sign samples and training the model |
| `trainer.js` | Training logic and model definition: captures hand landmarks and exports the model |
| `trainer.css` | Styling for the trainer page |
| `assets/` | Smoke sprites and overlay button images |

## How It Works

1. **MediaPipe Holistic** tracks your hand landmarks through the webcam
2. **MediaPipe Selfie Segmentation** isolates your body from the background
3. A neural network **TensorFlow.js model** (trained by you) recognizes a specific two-hand gesture.
4. When the gesture is detected with high confidence, shadow clones spawn with smoke effects

## Getting Started

### 1. Start up your local server

1. Ensure you have [Node.js](https://nodejs.org/en) installed as we will being `npx` to serve the project locally (required as using our webcam). 
2. From the root of the repo, run `npx serve -p <CHOOSE A PORT>` to start a local server (e.g., `npx serve -p 3000` will serve the project at `http://localhost:3000/` if port 3000 is available). The following steps will assume port 3000 is used.
3. To navigate to each HTML file/page, add it after the link 
    1. trainer.html —> `http://localhost:3000/trainer`
    2. index.html —> `http://localhost:3000/index` (or just `http://localhost:3000` )

### 2. Train Your Gesture Model

1. In Chrome, navigate to the trainer page (ex. `http://localhost:3000/trainer`) 
2. Record samples of your chosen hand sign (both hands visible)
3. Record negative samples (random hand positions, edge cases)
4. Click train → this generates `gesture-model.json` and `gesture-model.weights.bin`
5. Place the exported files in the project root (same folder as the main app)

### 3. Run the App

1. In Chrome, navigate to the home/index page (ex. `http://localhost:3000/`) 
2. Allow camera access
3. Perform your trained hand sign and your clones will appear!

## Customization

In `script.js` you can tweak:

- **Clone positions, sizes, and delay times** in the `customClones` array
- **Confidence threshold** in the `predictGesture` function (default: `0.999`)

In `trainer.js` you can tweak the model topology and training process. The current implementation was sufficient for my purposes but the model can definitely be optimized. 

## Additional Dependencies

All loaded via the [jsdelivr CDN](https://www.jsdelivr.com/), no installation required:

- TensorFlow.js
- MediaPipe Holistic
- MediaPipe Selfie Segmentation