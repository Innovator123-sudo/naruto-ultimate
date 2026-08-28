import {
  createHandLandmarker,
  detectHandsForVideo,
  calculateHandBoundingBox,
  drawHandBoundingBox,
  doRectanglesOverlap,
} from './mediapipe-hand-detection.js';

import { loadTeachableMachineModel, predictTeachableMachineModel } from './teachable-machine.js';

import { processCanvas } from './image-processing.js';

import {
  loadJutsus,
  manageJutsuPrediction,
  updateLoadingCircle,
  updatePastLabels,
  resetPredictions,
  writeJutsusIntoModal,
  buildJutsuCards,
} from './jutsu-manager.js';

import { jutsuCombinationsSpan } from './modal.js';

let webcam;
let totalModelClasses;

const boxDrawingCanvas = document.getElementById('image-canvas');
const boxDrawingCanvasCtx = boxDrawingCanvas.getContext('2d');

const processedCanvas = document.getElementById('processed-canvas');
const processedCanvasCtx = processedCanvas.getContext('2d', { willReadFrequently: true });

const labelContainer = document.getElementById('label-container');
const loadingCircle = document.getElementById('loading-circle');
const pastLabels = document.getElementById('past-labels');
const finishedJutsuContainer = document.getElementById('finished-jutsu-container');
const jutsuListContainer = document.getElementById('jutsu-list');

const webcamContainer = document.getElementById('webcam-container');

const CAMERA_WIDTH = 400;
const CAMERA_HEIGHT = 400;
const DRAW_BOUNDING_BOX = false;

async function init() {
  try {
    await createHandLandmarker();
    totalModelClasses = await loadTeachableMachineModel();
  } catch (error) {
    console.error('Error initializing:', error);
    return;
  }

  await startWebcam();

  window.requestAnimationFrame(loop);

  const jutsus = await loadJutsus();

  initializeUI();

  writeJutsusIntoModal(jutsus, jutsuCombinationsSpan);
  buildJutsuCards(jutsus, jutsuListContainer);
}

async function loop() {
  webcam.update();
  await predict();
  window.requestAnimationFrame(loop);
}

async function predict() {
  const startTimeMs = performance.now();
  const results = detectHandsForVideo(webcam.canvas, startTimeMs);

  const rectangles = results.landmarks.map((landmarks) => {
    const [minX, maxX, minY, maxY] = calculateHandBoundingBox(landmarks, results);
    return { minX, maxX, minY, maxY };
  });

  if (DRAW_BOUNDING_BOX) {
    boxDrawingCanvasCtx.clearRect(0, 0, boxDrawingCanvas.width, boxDrawingCanvas.height);
  }

  processedCanvasCtx.clearRect(0, 0, processedCanvas.width, processedCanvas.height);

  if (results.landmarks.length === 0) {
    resetPredictions(labelContainer, loadingCircle, pastLabels);
  } else {
    let targetRectangle;

    if (results.landmarks.length === 1) {
      targetRectangle = rectangles[0];
    } else if (results.landmarks.length === 2 && doRectanglesOverlap(rectangles[0], rectangles[1])) {
      targetRectangle = {
        minX: Math.min(rectangles[0].minX, rectangles[1].minX),
        maxX: Math.max(rectangles[0].maxX, rectangles[1].maxX),
        minY: Math.min(rectangles[0].minY, rectangles[1].minY),
        maxY: Math.max(rectangles[0].maxY, rectangles[1].maxY),
      };
    }

    if (targetRectangle) {
      await handlePrediction(targetRectangle, results.landmarks);
    }
  }
}

async function handlePrediction(rectangle, landmarks) {
  if (DRAW_BOUNDING_BOX) {
    drawHandBoundingBox(
      boxDrawingCanvas,
      boxDrawingCanvasCtx,
      rectangle
    );
  }

  processCanvas(rectangle, CAMERA_HEIGHT, CAMERA_WIDTH, processedCanvas, processedCanvasCtx, webcam, landmarks);

  const prediction = await predictTeachableMachineModel(processedCanvas);

  manageJutsuPrediction(prediction, labelContainer, loadingCircle, pastLabels, finishedJutsuContainer);

  updateLoadingCircle(loadingCircle);

  updatePastLabels(pastLabels, prediction, totalModelClasses);

  labelContainer.innerHTML = prediction;
}

async function startWebcam() {
  const flip = true;
  webcam = new tmImage.Webcam(CAMERA_WIDTH, CAMERA_HEIGHT, flip);
  await webcam.setup();
  await webcam.play();
}

function initializeUI() {
  webcamContainer.appendChild(webcam.canvas);
  webcamContainer.style.opacity = 1;

  loadingCircle.style.height = CAMERA_HEIGHT * 1.05 + 'px';
  boxDrawingCanvas.style.height = CAMERA_HEIGHT + 'px';
  boxDrawingCanvas.style.width = CAMERA_WIDTH + 'px';
}

init();
