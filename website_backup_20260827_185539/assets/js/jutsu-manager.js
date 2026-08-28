// VARIABLE DECLARATIONS
// ----------------------------------------
let predictions = [];
export let threshold = 5;
let predictionCounter = 0;
let previousPrediction;
let jutsus;

// Media paths
const JUTSUS_JSON_PATH = 'assets/jutsus.json';
const JUTSU_AUDIO_PATH = 'assets/audio/jutsu.mp3';

// Persisted last gesture and saved slots
const LAST_JUTSU_KEY = 'rasengen.lastJutsu';
const JUTSU_PREVIEW_IMG = 'assets/img/jutsu-preview.png';
const SAVED_SLOTS_KEY = 'rasengen.savedSlots';
const MAX_SLOTS = 5;

// EXPORTS
// ----------------------------------------
/**
 * Function to load the hand combinations from the jutsus.json file
 */
export async function loadJutsus() {
  try {
    const response = await fetch(JUTSUS_JSON_PATH);
    const data = await response.json();
    jutsus = data;
    return jutsus;
  } catch (error) {
    console.warn('Fetch jutsus.json failed, using embedded jutsus (file:// mode):', error);
    if (window.EMBEDDED_JUTSUS) {
      jutsus = window.EMBEDDED_JUTSUS;
      return jutsus;
    }
  }
};

/**
 * Function to manage the predictions from the Teachable Machine model
 * Checks if the prediction is the same as the previous one to make sure it's not a duplicate
 * Adds a threshold to slow down the predictions, to wait for hand movement to be completed 
 */
export function manageJutsuPrediction(finalPrediction, labelContainer, loadingCircle, pastLabels, jutsusContainer) {
  // Ignore background / unknown classes so they don't pollute the sign sequence
  if (!finalPrediction || finalPrediction === 'Nothing') {
    return;
  }

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
};

/**
 * Function to reset the predictions and UI components when no hands are detected
 * — now SAVES the previous handsign sequence before clearing
 */
export function resetPredictions(labelContainer, loadingCircle, pastLabels) {
  // Save previous sequence if it had something
  if (predictions.length > 0) {
    saveCurrentSequence(false); // silent save, no toast
  }
  predictions = [];
  predictionCounter = 0;
  previousPrediction = undefined;

  // UI components
  labelContainer.innerHTML = '';
  loadingCircle.style.backgroundImage = 'none';
  pastLabels.innerHTML = '';
};

/**
 * Manually reset with toast (for Reset button)
 */
export function manualReset(labelContainer, loadingCircle, pastLabels) {
  if (predictions.length > 0) {
    saveCurrentSequence(false);
  }
  predictions = [];
  predictionCounter = 0;
  previousPrediction = undefined;
  if (labelContainer) labelContainer.innerHTML = '';
  if (loadingCircle) loadingCircle.style.backgroundImage = 'none';
  if (pastLabels) pastLabels.innerHTML = '';
  // brief feedback
  showToast('Sequence reset — previous saved ✔');
};

/**
 * Function to update the loading circle UI component, which shows the progress of the prediction
 */
export function updateLoadingCircle(loadingCircle) {
  const progress = (predictionCounter / threshold) * 360;

  const emptyColor = '#fffdf1';
  loadingCircle.style.backgroundImage = `conic-gradient(${emptyColor} ${progress}deg, transparent ${progress}deg)`;
  loadingCircle.style.width = loadingCircle.offsetHeight + 'px';
};

/**
 * Function to update the past labels UI component, which shows the previous predictions
 */
export function updatePastLabels(pastLabels) {
  pastLabels.innerHTML = '';
  predictions.forEach(prediction => {
    if (prediction !== 'Nothing') {
      const label = document.createElement('div');
      label.innerHTML = prediction;
      pastLabels.appendChild(label);
    }
  });
};

/**
 * Function to write every jutsu and its custom handsign combination into the modal
 */
export function writeJutsusIntoModal(jutsus, modalBody) {
  modalBody.innerHTML = '';
  const jutsuKeys = Object.keys(jutsus);
  jutsuKeys.forEach(jutsu => {
    const signs = jutsus[jutsu].signs.join(' → ');
    const jutsuElement = document.createElement('p');
    jutsuElement.style.margin = '6px 0';
    jutsuElement.style.lineHeight = '1.5';
    const isSpecial = jutsu === 'Rasengan Jutsu' || jutsu === 'Chidori Jutsu' || jutsu === 'Shadow Clone Jutsu' || jutsu === 'Sharingan Jutsu';
    jutsuElement.style.background = isSpecial ? 'rgba(255,106,0,0.07)' : 'transparent';
    jutsuElement.style.padding = isSpecial ? '6px 10px' : '2px 0';
    jutsuElement.style.borderRadius = isSpecial ? '8px' : '0';
    jutsuElement.style.borderLeft = isSpecial ? '3px solid #ff6a00' : 'none';
    jutsuElement.innerHTML = `<strong>${jutsu}:</strong> <em style="color:${isSpecial?'#d35400':'#555'}">${signs}</em> ${isSpecial?'<span style="font-size:0.65em;background:#ff6a00;color:#fff;padding:2px 6px;border-radius:10px;margin-left:6px;">CUSTOM</span>':''}`;
    modalBody.appendChild(jutsuElement);
  });
};

/**
 * Function to set the threshold value of the predictions
 */
export function setThreshold(value) {
  threshold = Number(value) || 1;
};

/**
 * Persist the last performed jutsu to localStorage
 */
export function saveLastGesture(jutsuName) {
  try {
    const signs = (jutsus && jutsus[jutsuName] && jutsus[jutsuName].signs) || [];
    localStorage.setItem(LAST_JUTSU_KEY, JSON.stringify({ name: jutsuName, signs }));
  } catch (e) { /* storage may be unavailable */ }
};

/**
 * Read the last performed jutsu from localStorage
 */
export function loadLastGesture() {
  try {
    const raw = localStorage.getItem(LAST_JUTSU_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
};

/**
 * Clear the last performed jutsu and reset the current prediction state
 */
export function clearLastGesture(labelContainer, loadingCircle, pastLabels) {
  try {
    localStorage.removeItem(LAST_JUTSU_KEY);
  } catch (e) { /* ignore */ }

  // Reset live prediction state
  predictions = [];
  predictionCounter = 0;
  previousPrediction = undefined;

  if (labelContainer) labelContainer.innerHTML = '';
  if (loadingCircle) {
    loadingCircle.style.backgroundImage = 'none';
    loadingCircle.style.width = loadingCircle.offsetHeight + 'px';
  }
  if (pastLabels) pastLabels.innerHTML = '';

  renderLastGesture();
};

/**
 * Save current handsign sequence to history (localStorage)
 * @param {boolean} showToast - whether to show feedback
 */
export function saveCurrentSequence(showToast = true) {
  if (predictions.length === 0) {
    if (showToast) showToastMsg('Nothing to save — do some handsigns first!', true);
    return false;
  }
  try {
    const slots = JSON.parse(localStorage.getItem(SAVED_SLOTS_KEY) || '[]');
    
    // Find first empty slot or use slot 1 if all full (overwrite)
    let slotIndex = slots.findIndex(slot => !slot);
    if (slotIndex === -1) slotIndex = 0; // overwrite first slot if all full
    
    slots[slotIndex] = {
      id: Date.now(),
      sequence: [...predictions],
      time: new Date().toLocaleString(),
      iso: new Date().toISOString()
    };
    
    // Keep only MAX_SLOTS (5)
    const trimmed = slots.slice(0, MAX_SLOTS);
    localStorage.setItem(SAVED_SLOTS_KEY, JSON.stringify(trimmed));
    renderSavedSlots();
    if (showToast) showToastMsg(`Saved to slot ${slotIndex + 1}: ${predictions.join(' → ')} ✔`);
    return true;
  } catch (e) {
    console.warn('saveCurrentSequence failed', e);
    return false;
  }
};

export function getSavedSlots() {
  try {
    return JSON.parse(localStorage.getItem(SAVED_SLOTS_KEY) || '[]');
  } catch { return []; }
}

export function resetSlot(slotNumber) {
  if (slotNumber < 1 || slotNumber > MAX_SLOTS) return;
  
  try {
    const slots = getSavedSlots();
    const index = slotNumber - 1;
    
    if (slots[index]) {
      slots[index] = null; // clear this slot
      localStorage.setItem(SAVED_SLOTS_KEY, JSON.stringify(slots));
      renderSavedSlots();
      showToastMsg(`Slot ${slotNumber} cleared`);
    }
  } catch (e) { console.warn(e); }
}

export function clearAllSlots() {
  try { localStorage.removeItem(SAVED_SLOTS_KEY); } catch {}
  renderSavedSlots();
  showToastMsg('All slots cleared');
}

export function restoreSavedAt(index, labelContainer, pastLabels) {
  try {
    const slots = getSavedSlots();
    const item = slots[index];
    if (!item) return;
    predictions = [...item.sequence];
    predictionCounter = 0;
    previousPrediction = predictions[predictions.length - 1];
    if (pastLabels) {
      pastLabels.innerHTML = '';
      predictions.forEach(p => {
        if (p !== 'Nothing') {
          const d = document.createElement('div');
          d.textContent = p;
          pastLabels.appendChild(d);
        }
      });
    }
    if (labelContainer) labelContainer.textContent = predictions[predictions.length - 1] || '';
    showToastMsg(`Restored slot ${index + 1}: ${item.sequence.join(' → ')}`);
  } catch (e) { console.warn(e); }
}

function showToastMsg(msg, isError = false) {
  showToast(msg, isError);
}

function showToast(msg, isError = false) {
  let toast = document.getElementById('jutsu-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'jutsu-toast';
    toast.style.cssText = 'position:fixed; bottom:24px; left:50%; transform:translateX(-50%); background:rgba(20,20,30,0.92); color:#fff; padding:12px 20px; border-radius:50px; font-size:0.9rem; font-weight:600; z-index:9999; backdrop-filter:blur(10px); border:1px solid rgba(255,255,255,0.15); box-shadow:0 8px 32px rgba(0,0,0,0.3); opacity:0; transition:all 0.3s ease; pointer-events:none; text-align:center; max-width:90vw;';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.background = isError ? 'rgba(120,20,20,0.92)' : 'rgba(20,20,30,0.92)';
  toast.style.opacity = '1';
  toast.style.transform = 'translateX(-50%) translateY(0)';
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(10px)';
  }, 2200);
}

export function renderSavedSlots() {
  const container = document.getElementById('saved-slots-list');
  const countEl = document.getElementById('saved-count');
  const emptyEl = document.getElementById('saved-slots-empty');
  if (!container) return;
  const slots = getSavedSlots();
  const filledSlots = slots.filter(s => s !== null && s !== undefined);
  
  if (countEl) countEl.textContent = filledSlots.length;
  
  container.innerHTML = '';
  if (filledSlots.length === 0) {
    if (emptyEl) emptyEl.style.display = 'block';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';
  
  // Render all 5 slots (filled or empty)
  slots.forEach((item, idx) => {
    const row = document.createElement('div');
    const slotNum = idx + 1;
    
    if (item) {
      const seq = item.sequence.join(' → ');
      row.style.cssText = 'display:flex; align-items:center; gap:8px; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.08); padding:10px 12px; border-radius:12px; margin-bottom:8px;';
      row.innerHTML = `
        <div style="flex:1; min-width:0;">
          <div style="font-size:0.7rem; color:#888; margin-bottom:2px;">Slot ${slotNum}</div>
          <div style="font-weight:700; font-size:0.9rem; color:#ff6a00; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${seq}</div>
        </div>
        <button data-restore="${idx}" style="background:#ff6a00; color:#fff; border:none; padding:6px 12px; border-radius:20px; font-size:0.75rem; font-weight:700; cursor:pointer; flex-shrink:0;">↩ Restore</button>
        <button data-reset="${idx}" style="background:rgba(200,30,30,0.9); color:#fff; border:none; padding:6px 10px; border-radius:20px; font-size:0.75rem; cursor:pointer; flex-shrink:0;">Reset</button>
      `;
    } else {
      row.style.cssText = 'display:flex; align-items:center; gap:8px; background:rgba(255,255,255,0.02); border:1px dashed rgba(255,255,255,0.1); padding:10px 12px; border-radius:12px; margin-bottom:8px;';
      row.innerHTML = `
        <div style="flex:1; min-width:0;">
          <div style="font-size:0.7rem; color:#666; margin-bottom:2px;">Slot ${slotNum}</div>
          <div style="font-size:0.8rem; color:#555;">Empty</div>
        </div>
        <button data-reset="${idx}" style="background:rgba(200,30,30,0.9); color:#fff; border:none; padding:6px 10px; border-radius:20px; font-size:0.75rem; cursor:pointer; flex-shrink:0;">Reset</button>
      `;
    }
    
    container.appendChild(row);
  });
  
  // wire restore buttons
  container.querySelectorAll('[data-restore]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.getAttribute('data-restore'), 10);
      const lc = document.getElementById('label-container');
      const pl = document.getElementById('past-labels');
      restoreSavedAt(idx, lc, pl);
    });
  });
  
  // wire reset buttons
  container.querySelectorAll('[data-reset]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.getAttribute('data-reset'), 10);
      resetSlot(idx + 1); // convert to 1-based slot number
    });
  });
}

/**
 * Render the persisted last-gesture panel + preview image (no-op if elements absent)
 */
export function renderLastGesture() {
  const nameEl = document.getElementById('last-jutsu-name');
  const signsEl = document.getElementById('last-jutsu-signs');
  const previewEl = document.getElementById('jutsu-preview');

  const last = loadLastGesture();

  if (nameEl) nameEl.textContent = last ? last.name : 'None';
  if (signsEl) signsEl.textContent = last ? (last.signs || []).join(' → ') : '';

  if (previewEl) {
    if (last) {
      previewEl.onerror = () => { previewEl.style.display = 'none'; };
      previewEl.src = JUTSU_PREVIEW_IMG;
      previewEl.style.display = 'block';
    } else {
      previewEl.onerror = null;
      previewEl.removeAttribute('src');
      previewEl.style.display = 'none';
    }
  }
};

// HELPER FUNCTIONS
// ----------------------------------------
/**
 * Function to check if the current predictions match any of the jutsu combinations in the jutsus.json file
 */
function checkJutsuMatch(jutsusContainer, labelContainer, loadingCircle, pastLabels) {
  const jutsuKeys = Object.keys(jutsus);

  const matchedJutsu = jutsuKeys.find(jutsu => {
    const signs = jutsus[jutsu].signs;
    if (predictions.length === signs.length) {
      return signs.every((value, index) => value === predictions[index]);
    }
    return false;
  });

  if (matchedJutsu) {
    playJutsuSound();
    showJutsuName(matchedJutsu, jutsusContainer, labelContainer, loadingCircle, pastLabels);
  }
};


/**
 * Function to play the jutsu sound when a jutsu is matched
 */
function playJutsuSound() {
  try {
    const audio = new Audio(JUTSU_AUDIO_PATH);
    audio.volume = 0.55;
    audio.play().catch(()=>{});
  } catch(e){}
};

/**
 * Function to show the jutsu name when a jutsu is matched,
 * apply effect to UI components and redirect to the jutsu page
 */
function showJutsuName(jutsuName, jutsusContainer, labelContainer, loadingCircle, pastLabels) {

  const effectDuration = 2000;
  const redirectDelay = 2500;

  jutsusContainer.innerHTML = jutsuName;
  jutsusContainer.style.visibility = 'visible';

  labelContainer.style.visibility = 'hidden';
  loadingCircle.style.visibility = 'hidden';
  pastLabels.style.visibility = 'hidden';

  // Persist + show the performed jutsu (survives reload / redirect)
  saveLastGesture(jutsuName);
  renderLastGesture();

  // Redirect to the page of the performed jutsu
  setTimeout(() => {
    window.location.href = jutsus[jutsuName].page;
  }, redirectDelay);

  // Flash effect before redirecting
  setTimeout(() => {
    jutsusContainer.classList.add('jutsu-flash');
  }, effectDuration - 500);
};
