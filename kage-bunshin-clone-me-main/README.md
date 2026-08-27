# 🌀 Kage Bunshin – Shadow Clone in the Browser
A real-time, gesture-controlled web experience inspired by the iconic *Naruto Shadow Clone Jutsu*.  
Using your webcam and hand signs, you can **create and erase clones dynamically** — all running directly in the browser.



## ✨ Features

- 🖐️ **Hand Gesture Recognition**
  - Detects custom gestures using a trained TensorFlow.js model
- 👥 **Shadow Clone Effect**
  - Spawns multiple clones with timed delays and positioning
- 💨 **Animated Smoke Effects**
  - Clone appearance enhanced with sprite-based smoke animation
- 🎯 **Confidence Indicator**
  - Real-time prediction confidence display
- 🔁 **Clone Reset Gesture**
  - Erase clones using a separate hand sign
- 🧠 **Custom Model Training Interface**
  - Record gestures, train model, and export it

---

## 🛠️ Tech Stack

- **TensorFlow.js** – Gesture classification model  
- **MediaPipe (Holistic + Selfie Segmentation)** – Hand tracking & segmentation  
- **HTML5 Canvas** – Rendering clones and effects  
- **Vanilla JavaScript** – Core logic  

---

## 📁 Project Structure
kage-bunshin-clone-me/
│
├── index.html # Main application
├── script.js # Clone logic + gesture detection
├── styles.css # UI styling
│
├── trainer.html # Gesture training interface
├── trainer.js # Model training logic
├── trainer.css # Trainer UI styling
│
├── assets/ # Images, smoke sprites, overlays
└── gesture-model.* # Trained model files



---

## 🚀 Getting Started

### 1. Clone the repository
```bash
git clone https://github.com/your-username/kage-bunshin-clone-me.git
cd kage-bunshin-clone-me

2. Run locally

Just open:
index.html
⚠️ Make sure you allow camera access in your browser.

🧠 Training Your Own Gestures
Open:
trainer.html

Steps:
1. Record samples for:
    Clone Sign
    Erase Sign
    Other gestures
2. Train the model
3. Export the model
4. Replace the model files in the main project


🎮 How It Works:
1. MediaPipe tracks your hand landmarks
2. Landmarks are normalized and passed into the model
3. Model predicts gesture class
4. If clone gesture detected → clones spawn
5. If erase gesture detected → clones reset


⚙️ Customization

You can tweak:
    Clone positions → customClones array in script.js
    Gesture sensitivity → threshold in predictGesture()
    Animation timing → smoke + delay configs


🙌 Inspiration:

Inspired by the legendary Shadow Clone Jutsu from Naruto — bringing a bit of anime magic into real-time web interaction.