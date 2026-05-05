/**
 * app.js — Epzin UI controller
 * Wires the DOM to EpzinEngine + IccProfiles.
 * All processing is synchronous on the main thread (no workers needed for this scale).
 */

'use strict';

/* ──────────────────────────────────────────
   STATE
────────────────────────────────────────── */
const state = {
  sourceImage: null,       // HTMLImageElement
  sourceFile:  null,       // File
  resultBlob:  null,       // Blob (last output)
  processing:  false,
};

/* ──────────────────────────────────────────
   DOM REFS
────────────────────────────────────────── */
const $ = id => document.getElementById(id);
const dropZone     = $('drop-zone');
const fileInput    = $('file-input');
const previewCanvas = $('preview-canvas');
const previewCtx   = previewCanvas.getContext('2d');
const imageInfo    = $('image-info');
const processBtn   = $('process-btn');
const progressWrap = $('progress-wrap');
const progressBar  = $('progress-bar');
const progressLbl  = $('progress-label');
const resultPanel  = $('result-panel');
const resultImg    = $('result-img');
const resultDim    = $('result-dim');
const resultSize   = $('result-size');
const downloadBtn  = $('download-btn');
const toastEl      = $('toast');

/* ──────────────────────────────────────────
   TABS
────────────────────────────────────────── */
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    $('tab-' + btn.dataset.tab).classList.add('active');
  });
});

/* ──────────────────────────────────────────
   UPLOAD / DROP
────────────────────────────────────────── */
dropZone.addEventListener('click', e => {
  if (!dropZone.classList.contains('has-image')) fileInput.click();
});
$('btn-upload').addEventListener('click', () => fileInput.click());
$('btn-clear').addEventListener('click', clearImage);

dropZone.addEventListener('dragover', e => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) loadFile(file);
});

fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) loadFile(fileInput.files[0]);
  fileInput.value = '';
});

// Paste support
document.addEventListener('paste', e => {
  const item = [...e.clipboardData.items].find(i => i.type.startsWith('image/'));
  if (item) loadFile(item.getAsFile());
});

function loadFile(file) {
  state.sourceFile = file;
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    state.sourceImage = img;
    drawPreview(img);
    showImageInfo(img, file);
    URL.revokeObjectURL(url);
    hideResult();
  };
  img.src = url;
}

function drawPreview(img) {
  const maxW = dropZone.clientWidth  || 600;
  const maxH = 260;
  const scale = Math.min(maxW / img.width, maxH / img.height, 1);
  previewCanvas.width  = img.width  * scale;
  previewCanvas.height = img.height * scale;
  previewCtx.drawImage(img, 0, 0, previewCanvas.width, previewCanvas.height);
  dropZone.classList.add('has-image');
  // Centre canvas within drop zone
  previewCanvas.style.objectFit = 'contain';
}

function showImageInfo(img, file) {
  $('info-name').textContent  = file.name;
  $('info-dim').textContent   = `${img.width} × ${img.height}`;
  $('info-size').textContent  = formatBytes(file.size);
  imageInfo.classList.add('visible');
}

function clearImage() {
  state.sourceImage = null;
  state.sourceFile  = null;
  previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
  dropZone.classList.remove('has-image');
  imageInfo.classList.remove('visible');
  hideResult();
}

/* ──────────────────────────────────────────
   RESIZE MODE TOGGLE
────────────────────────────────────────── */
document.querySelectorAll('input[name="resize-mode"]').forEach(r => {
  r.addEventListener('change', () => {
    const isScale = r.value === 'scale';
    $('scale-row').style.display    = isScale ? '' : 'none';
    $('custom-dims').style.display  = isScale ? 'none' : '';
    if (!isScale) updateCustomDims();
  });
});

// Live scale slider
const scaleSlider = $('scale-slider');
const scaleVal    = $('scale-val');
scaleSlider.addEventListener('input', () => {
  scaleVal.textContent = parseFloat(scaleSlider.value).toFixed(1) + '×';
  updateCustomDims();
});

function updateCustomDims() {
  if (!state.sourceImage) return;
  const mode = document.querySelector('input[name="resize-mode"]:checked').value;
  if (mode === 'scale') {
    const s = parseFloat(scaleSlider.value);
    $('w-input').value = Math.round(state.sourceImage.width  * s);
    $('h-input').value = Math.round(state.sourceImage.height * s);
  }
}

// Aspect-lock custom dims
let aspectLock = true;
$('w-input').addEventListener('input', () => {
  if (!aspectLock || !state.sourceImage) return;
  const ratio = state.sourceImage.height / state.sourceImage.width;
  $('h-input').value = Math.round($('w-input').value * ratio);
});
$('h-input').addEventListener('input', () => {
  if (!aspectLock || !state.sourceImage) return;
  const ratio = state.sourceImage.width / state.sourceImage.height;
  $('w-input').value = Math.round($('h-input').value * ratio);
});

/* ──────────────────────────────────────────
   HARDWARE CHIPS (radio selection)
────────────────────────────────────────── */
document.querySelectorAll('.hw-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    const radio = chip.querySelector('input[type="radio"]');
    radio.checked = true;
    document.querySelectorAll('.hw-chip').forEach(c => c.classList.remove('selected'));
    chip.classList.add('selected');
  });
});

/* ──────────────────────────────────────────
   GRAIN SLIDER
────────────────────────────────────────── */
const grainSlider = $('grain-slider');
const grainVal    = $('grain-val');
grainSlider.addEventListener('input', () => {
  grainVal.textContent = grainSlider.value;
});

/* ──────────────────────────────────────────
   NOISE SLIDER (for R-ESRGAN style)
────────────────────────────────────────── */
const noiseSlider = $('noise-slider');
const noiseVal    = $('noise-val');
noiseSlider.addEventListener('input', () => {
  noiseVal.textContent = noiseSlider.value;
});

/* ──────────────────────────────────────────
   PROCESS
────────────────────────────────────────── */
processBtn.addEventListener('click', async () => {
  if (!state.sourceImage) { toast('Please upload an image first', 'error'); return; }
  if (state.processing)   return;
  runPipeline();
});

async function runPipeline() {
  state.processing = true;
  processBtn.classList.add('loading');
  processBtn.disabled = true;
  showProgress(0, 'Reading image…');
  hideResult();

  // Small delay so UI can repaint
  await tick();

  try {
    const img = state.sourceImage;

    // ── 1. Read source pixels ──
    const srcCanvas = document.createElement('canvas');
    srcCanvas.width  = img.width;
    srcCanvas.height = img.height;
    const srcCtx = srcCanvas.getContext('2d');
    srcCtx.drawImage(img, 0, 0);
    let imgData = srcCtx.getImageData(0, 0, img.width, img.height);
    showProgress(10, 'Source loaded…');
    await tick();

    // ── 2. Upscale ──
    const mode   = document.querySelector('input[name="resize-mode"]:checked').value;
    const algoSel = $('algo-select').value;
    let dstW, dstH;

    if (mode === 'scale') {
      const s = parseFloat(scaleSlider.value);
      dstW = Math.round(img.width  * s);
      dstH = Math.round(img.height * s);
    } else {
      dstW = parseInt($('w-input').value) || img.width;
      dstH = parseInt($('h-input').value) || img.height;
    }

    const algoMap = {
      'lanczos':  'lanczos',
      'bicubic':  'bicubic',
      'nearest':  'nearest',
      'resrgan':  'lanczos',  // base resize then sharpen pass
    };

    showProgress(20, 'Upscaling…');
    await tick();
    imgData = EpzinEngine.resizeImageData(imgData, dstW, dstH, algoMap[algoSel]);
    showProgress(45, 'Upscale complete…');
    await tick();

    // ── 3. R-ESRGAN-style sharpening (if selected) ──
    if (algoSel === 'resrgan') {
      showProgress(50, 'Applying sharpening pass…');
      await tick();
      const noiseLevel = parseInt(noiseSlider.value);
      imgData = EpzinEngine.applyRealESRGANStyle(imgData, noiseLevel);
      showProgress(60, 'Sharpening done…');
      await tick();
    }

    // ── 4. ColorFix ──
    const tab2Active = (() => {
      // Check if any colorfix options are on
      return $('toggle-clahe').checked || $('toggle-grain').checked;
    })();

    if ($('toggle-clahe').checked) {
      showProgress(65, 'Applying CLAHE…');
      await tick();
      imgData = EpzinEngine.applyCLAHE(imgData, 1.5, 8);
    }

    if ($('toggle-grain').checked) {
      showProgress(72, 'Adding film grain…');
      await tick();
      const grainAmt = parseInt(grainSlider.value);
      imgData = EpzinEngine.applyFilmGrain(imgData, grainAmt);
    }

    // ── 5. Hardware filter ──
    const hwFilter = document.querySelector('input[name="hw-filter"]:checked').value;
    if (hwFilter === 'iphone6') {
      showProgress(78, 'iPhone 6 filter…');
      await tick();
      imgData = EpzinEngine.applyIPhone6Filter(imgData);
    } else if (hwFilter === 'iphone6s') {
      showProgress(78, 'iPhone 6s filter…');
      await tick();
      imgData = EpzinEngine.applyIPhone6sFilter(imgData);
    }

    // ── 6. Bake to canvas ──
    showProgress(84, 'Compositing…');
    await tick();
    const outCanvas = document.createElement('canvas');
    outCanvas.width  = dstW;
    outCanvas.height = dstH;
    const outCtx = outCanvas.getContext('2d');
    outCtx.putImageData(imgData, 0, 0);

    // ── 7. Export with ICC ──
    showProgress(90, 'Embedding ICC profile…');
    await tick();
    const fmt     = $('fmt-select').value;   // 'png' | 'jpeg'
    const iccName = document.querySelector('input[name="icc-profile"]:checked').value;
    const quality = fmt === 'jpeg' ? 0.95 : undefined;

    const blob = await EpzinEngine.exportWithICC(outCanvas, fmt, iccName, quality);
    state.resultBlob = blob;

    showProgress(100, 'Done!');
    await tick();

    // ── 8. Show result ──
    const resultUrl = URL.createObjectURL(blob);
    resultImg.src = resultUrl;
    resultDim.textContent  = `${dstW} × ${dstH}`;
    resultSize.textContent = formatBytes(blob.size);

    // Wire download button
    downloadBtn.href     = resultUrl;
    downloadBtn.download = buildFilename(state.sourceFile?.name, fmt, iccName);

    resultPanel.classList.add('visible');
    resultPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    toast('Image processed!', 'success');

  } catch (err) {
    console.error(err);
    toast('Processing error: ' + err.message, 'error');
  } finally {
    progressWrap.classList.remove('visible');
    processBtn.classList.remove('loading');
    processBtn.disabled = false;
    state.processing = false;
  }
}

/* ──────────────────────────────────────────
   HELPERS
────────────────────────────────────────── */
function tick() {
  return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
}

function showProgress(pct, label) {
  progressWrap.classList.add('visible');
  progressBar.style.width = pct + '%';
  progressLbl.textContent = label;
}

function hideResult() {
  resultPanel.classList.remove('visible');
}

function buildFilename(original, fmt, icc) {
  const base = (original || 'epzin').replace(/\.[^.]+$/, '');
  return `${base}_epzin_${icc}.${fmt}`;
}

function formatBytes(bytes) {
  if (bytes < 1024)         return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

let toastTimer;
function toast(msg, type = '') {
  toastEl.textContent = msg;
  toastEl.className   = 'show ' + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.className = '', 2800);
}

/* ──────────────────────────────────────────
   COPY IMAGE INFO
────────────────────────────────────────── */
$('copy-info-btn').addEventListener('click', () => {
  if (!state.sourceImage) return;
  const icc = document.querySelector('input[name="icc-profile"]:checked').value;
  const hw  = document.querySelector('input[name="hw-filter"]:checked').value;
  const txt = [
    `File: ${state.sourceFile?.name}`,
    `Source: ${state.sourceImage.width}×${state.sourceImage.height}`,
    `Output: ${$('result-dim').textContent}`,
    `Algorithm: ${$('algo-select').value}`,
    `ICC: ${icc}`,
    `CLAHE: ${$('toggle-clahe').checked}`,
    `Grain: ${$('toggle-grain').checked} (${$('grain-slider').value})`,
    `HW Filter: ${hw}`,
    `Format: ${$('fmt-select').value}`,
  ].join('\n');
  navigator.clipboard.writeText(txt).then(() => toast('Info copied!', 'success'));
});

/* ──────────────────────────────────────────
   INIT
────────────────────────────────────────── */
// Trigger resize mode to set initial state
document.querySelector('input[name="resize-mode"]:checked').dispatchEvent(new Event('change'));
console.log('%cEpzin loaded — privacy-first, 100% in-browser', 'color:#e8632a;font-weight:bold');
