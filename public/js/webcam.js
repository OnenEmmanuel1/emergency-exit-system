/**
 * webcam.js — Client-side TensorFlow.js / COCO-SSD people counter
 * ─────────────────────────────────────────────────────────────────
 * Loaded ONLY on the /density/camera page.
 *
 * What this does (genuinely):
 *  1. Loads the pretrained COCO-SSD object detection model from
 *     the TensorFlow.js CDN — this is a real neural network, not a
 *     simulation.
 *  2. Streams the device's webcam feed into a <video> element.
 *  3. Every 2 seconds, runs a detection pass over the current frame.
 *  4. Counts detections with class "person" above a confidence
 *     threshold (0.5 by default).
 *  5. POSTs the count to POST /api/density/webcam, which writes a
 *     real density_readings row with source='Webcam'.
 *
 * Limitations (documented honestly):
 *  - Requires a real webcam. Without a camera, no detection occurs.
 *  - Accuracy depends on lighting, angle, and occlusion. In poor
 *    conditions the model may miss people or generate false positives.
 *  - COCO-SSD is a general-purpose detector — not a dedicated
 *    people-counter. It works for this prototype but a dedicated
 *    model (e.g. MobileNet-SSD fine-tuned on crowd images) would
 *    perform better in a production scenario.
 *  - Running inference on every frame at full resolution can be CPU-
 *    intensive. The 2-second interval mitigates this.
 *
 * This is NOT a simulation — the detections come from the neural
 * network processing real camera pixels.
 */

/* global cocoSsd, tf */

(function () {
  'use strict';

  // ── DOM refs ────────────────────────────────────────────────
  const video       = document.getElementById('seex-webcam-video');
  const canvas      = document.getElementById('seex-webcam-canvas');
  const startBtn    = document.getElementById('seex-start-btn');
  const stopBtn     = document.getElementById('seex-stop-btn');
  const zoneSelect  = document.getElementById('seex-zone-select');
  const statusEl    = document.getElementById('seex-cam-status');
  const countEl     = document.getElementById('seex-person-count');
  const logEl       = document.getElementById('seex-detect-log');
  const confidenceInput = document.getElementById('seex-confidence');

  const ctx = canvas.getContext('2d');

  let model       = null;
  let stream      = null;
  let intervalId  = null;
  let running     = false;
  let totalPosted = 0;

  function setStatus(msg, type = 'info') {
    statusEl.textContent = msg;
    statusEl.className   = `seex-alert seex-alert--${type}`;
  }

  function appendLog(msg) {
    const ts   = new Date().toLocaleTimeString();
    const line = document.createElement('div');
    line.textContent = `[${ts}] ${msg}`;
    logEl.prepend(line);
    // Keep log to 50 entries
    while (logEl.children.length > 50) logEl.removeChild(logEl.lastChild);
  }

  // ── Load model ──────────────────────────────────────────────
  async function loadModel() {
    setStatus('Loading COCO-SSD model…', 'info');
    try {
      model = await cocoSsd.load();
      setStatus('Model loaded. Select a zone and click Start.', 'success');
      appendLog('COCO-SSD model loaded.');
      startBtn.disabled = false;
    } catch (err) {
      setStatus(`Failed to load model: ${err.message}`, 'error');
      appendLog(`ERROR loading model: ${err.message}`);
    }
  }

  // ── Start detection ─────────────────────────────────────────
  async function startDetection() {
    const zoneId = zoneSelect.value;
    if (!zoneId) { setStatus('Please select a zone first.', 'warning'); return; }
    if (!model)  { setStatus('Model not loaded yet.', 'warning'); return; }

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      video.srcObject = stream;
      await video.play();

      canvas.width  = video.videoWidth  || 640;
      canvas.height = video.videoHeight || 480;

      running = true;
      startBtn.disabled = true;
      stopBtn.disabled  = false;
      setStatus('Detection running — posting readings every 2 seconds.', 'success');
      appendLog(`Started on zone ${zoneSelect.options[zoneSelect.selectedIndex].text}`);

      // Detection loop every 2 seconds
      intervalId = setInterval(detectAndPost, 2000);
    } catch (err) {
      setStatus(`Camera error: ${err.message}. Check browser permissions.`, 'error');
      appendLog(`Camera error: ${err.message}`);
    }
  }

  // ── Stop detection ──────────────────────────────────────────
  function stopDetection() {
    running = false;
    clearInterval(intervalId);
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
    video.srcObject = null;
    startBtn.disabled = false;
    stopBtn.disabled  = true;
    setStatus('Detection stopped.', 'info');
    appendLog(`Stopped. Total readings posted: ${totalPosted}`);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  // ── One detection tick ──────────────────────────────────────
  async function detectAndPost() {
    if (!running || !model) return;
    const threshold = parseFloat(confidenceInput.value) || 0.5;

    try {
      // Draw current frame on canvas
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // Run COCO-SSD on the canvas element
      const predictions = await model.detect(canvas);

      // Count 'person' detections above threshold
      const people = predictions.filter(
        p => p.class === 'person' && p.score >= threshold
      );

      const personCount = people.length;
      countEl.textContent = personCount;

      // Draw bounding boxes
      ctx.strokeStyle = '#1a56db';
      ctx.lineWidth   = 2;
      ctx.font        = '14px Inter, sans-serif';
      ctx.fillStyle   = '#1a56db';
      for (const p of people) {
        const [x, y, w, h] = p.bbox;
        ctx.strokeRect(x, y, w, h);
        ctx.fillText(`${(p.score * 100).toFixed(0)}%`, x + 4, y + 16);
      }

      // POST to API
      const zoneId = zoneSelect.value;
      const resp = await fetch('/api/density/webcam', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zoneId: parseInt(zoneId), personCount }),
      });

      if (resp.ok) {
        totalPosted++;
        appendLog(`Detected ${personCount} person(s) → posted to zone ${zoneSelect.options[zoneSelect.selectedIndex].text}`);
      } else {
        const err = await resp.json();
        appendLog(`API error: ${err.error}`);
      }
    } catch (err) {
      appendLog(`Detection error: ${err.message}`);
    }
  }

  // ── Event listeners ─────────────────────────────────────────
  startBtn.addEventListener('click', startDetection);
  stopBtn.addEventListener('click', stopDetection);

  // ── Bootstrap ───────────────────────────────────────────────
  // TF.js and COCO-SSD are loaded via CDN in the EJS template
  // before this script runs, so they are available globally.
  document.addEventListener('DOMContentLoaded', () => {
    loadModel();
    startBtn.disabled = true;
    stopBtn.disabled  = true;
  });
})();
