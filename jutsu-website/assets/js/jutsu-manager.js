let predictions = [];
export let threshold = 5;
let predictionCounter = 0;
let previousPrediction;
let jutsus = {};
let redirectPending = false;

const JUTSUS_JSON_PATH = 'assets/jutsus.json';
const JUTSU_AUDIO_PATH = 'assets/audio/jutsu.mp3';

export async function loadJutsus() {
  try {
    const response = await fetch(JUTSUS_JSON_PATH);
    const data = await response.json();
    jutsus = data;
    return jutsus;
  } catch (error) {
    console.error('Error fetching jutsus:', error);
    return jutsus;
  }
}

export function getSequence(jutsuName) {
  const entry = jutsus[jutsuName];
  if (!entry) return [];
  return Array.isArray(entry) ? entry : entry.sequence;
}

export function getPage(jutsuName) {
  const entry = jutsus[jutsuName];
  if (!entry || Array.isArray(entry)) return null;
  return entry.page || null;
}

export function manageJutsuPrediction(finalPrediction, labelContainer, loadingCircle, pastLabels, jutsusContainer) {
  if (redirectPending) return;
  if (finalPrediction === previousPrediction) {
    predictionCounter++;
    if (predictionCounter >= threshold && predictions[predictions.length - 1] !== finalPrediction) {
      predictions.push(finalPrediction);
      labelContainer.innerHTML = finalPrediction;
      checkJutsuMatch(jutsusContainer, labelContainer, loadingCircle, pastLabels);
    }
  } else {
    predictionCounter = 0;
    previousPrediction = finalPrediction;
  }
}

export function resetPredictions(labelContainer, loadingCircle, pastLabels) {
  if (redirectPending) return;
  predictions = [];
  predictionCounter = 0;
  previousPrediction = undefined;

  labelContainer.innerHTML = '';
  loadingCircle.style.backgroundImage = 'none';
  pastLabels.innerHTML = '';
}

export function updateLoadingCircle(loadingCircle) {
  const progress = (predictionCounter / threshold) * 360;

  const emptyColor = '#fffdf1';
  loadingCircle.style.backgroundImage = `conic-gradient(${emptyColor} ${progress}deg, transparent ${progress}deg)`;
  loadingCircle.style.width = loadingCircle.offsetHeight + 'px';
}

export function updatePastLabels(pastLabels) {
  pastLabels.innerHTML = '';
  predictions.forEach(prediction => {
    if (prediction !== 'Nothing') {
      const label = document.createElement('div');
      label.innerHTML = prediction;
      pastLabels.appendChild(label);
    }
  });
}

export function writeJutsusIntoModal(jutsus, modalBody) {
  Object.keys(jutsus).forEach(jutsu => {
    const jutsuElement = document.createElement('p');
    jutsuElement.innerHTML = `<strong>${jutsu}:</strong> <em>${getSequence(jutsu).join(' &rarr; ')}</em>`;
    modalBody.appendChild(jutsuElement);
  });
}

export function buildJutsuCards(jutsus, container) {
  container.innerHTML = '';
  Object.keys(jutsus).forEach(jutsu => {
    const card = document.createElement('div');
    card.className = 'jutsu-card';
    const page = getPage(jutsu);
    if (page) card.classList.add('special');

    const name = document.createElement('div');
    name.className = 'jutsu-card-name';
    name.innerHTML = jutsu + (page ? ' <span class="special-badge">&#9733;</span>' : '');
    card.appendChild(name);

    const chips = document.createElement('div');
    chips.className = 'jutsu-card-seals';
    getSequence(jutsu).forEach((seal, i) => {
      if (i > 0) {
        const arrow = document.createElement('span');
        arrow.className = 'seal-arrow';
        arrow.innerHTML = '&#8594;';
        chips.appendChild(arrow);
      }
      const chip = document.createElement('span');
      chip.className = 'seal-chip';
      chip.innerHTML = seal;
      chips.appendChild(chip);
    });
    card.appendChild(chips);
    container.appendChild(card);
  });
}

export function setThreshold(value) {
  threshold = value;
}

function checkJutsuMatch(jutsusContainer, labelContainer, loadingCircle, pastLabels) {
  const jutsuKeys = Object.keys(jutsus);

  const matchedJutsu = jutsuKeys.find(jutsu => {
    const sequence = getSequence(jutsu);
    if (predictions.length === sequence.length) {
      return sequence.every((value, index) => value === predictions[index]);
    }
    return false;
  });

  if (matchedJutsu) {
    playJutsuSound();
    const page = getPage(matchedJutsu);
    if (page) {
      redirectToJutsuPage(matchedJutsu, page, jutsusContainer, labelContainer, loadingCircle, pastLabels);
    } else {
      showJutsuName(matchedJutsu, jutsusContainer, labelContainer, loadingCircle, pastLabels);
    }
  }
}

function playJutsuSound() {
  const audio = new Audio(JUTSU_AUDIO_PATH);
  audio.play();
}

function redirectToJutsuPage(jutsuName, page, jutsusContainer, labelContainer, loadingCircle, pastLabels) {
  redirectPending = true;
  jutsusContainer.innerHTML = jutsuName;
  jutsusContainer.style.visibility = 'visible';
  jutsusContainer.classList.add('redirect-flash');
  labelContainer.style.visibility = 'hidden';
  loadingCircle.style.visibility = 'hidden';
  pastLabels.style.visibility = 'hidden';

  const flash = document.createElement('div');
  flash.className = 'jutsu-flash';
  document.body.appendChild(flash);

  setTimeout(() => {
    window.location.href = page;
  }, 1400);
}

function showJutsuName(jutsuName, jutsusContainer, labelContainer, loadingCircle, pastLabels) {
  const effectDuration = 3000;

  jutsusContainer.innerHTML = jutsuName;
  jutsusContainer.style.visibility = 'visible';

  labelContainer.style.visibility = 'hidden';
  loadingCircle.style.visibility = 'hidden';
  pastLabels.style.visibility = 'hidden';

  setTimeout(() => {
    jutsusContainer.innerHTML = '';
    jutsusContainer.style.visibility = 'hidden';
    predictions = [];
    predictionCounter = 0;
    labelContainer.style.visibility = 'visible';
    loadingCircle.style.visibility = 'visible';
    pastLabels.style.visibility = 'visible';
  }, effectDuration);
}
