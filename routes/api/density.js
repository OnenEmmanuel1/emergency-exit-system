'use strict';

/**
 * POST /api/density/webcam
 * ─────────────────────────────────────────────────────────────
 * Receives person-count readings from the client-side
 * TensorFlow.js / COCO-SSD webcam detection page.
 * Each detection tick on the browser posts here.
 *
 * Requires the logged-in Administrator session used to load
 * /density/camera; expired sessions receive a JSON 401 response.
 *
 * Request body (JSON):
 *   { "zoneId": 2, "personCount": 4 }
 */

const express  = require('express');
const { requireApiAuth } = require('../../middleware/auth');
const { query } = require('../../db/db');
const { observeDensity, getCurrentDensities } = require('../../services/densityEngine');
const router   = express.Router();

router.post('/webcam', requireApiAuth, async (req, res) => {
  const { zoneId, personCount } = req.body;
  const zid   = Number(zoneId);
  const count = Number(personCount);

  if (!Number.isInteger(zid) || zid <= 0) return res.status(400).json({ error: 'zoneId must be a positive integer.' });
  if (!Number.isInteger(count) || count < 0) return res.status(400).json({ error: 'personCount must be a non-negative integer.' });

  // Sanity bound vs threshold
  const [zones] = await query('SELECT name, capacityThreshold FROM zones WHERE zoneId=?', [zid]);
  if (!zones.length) return res.status(404).json({ error: 'Zone not found.' });
  if (count > zones[0].capacityThreshold * 3) {
    return res.status(400).json({ error: 'personCount exceeds sanity bound (3× threshold).' });
  }

  await query(
    "INSERT INTO density_readings (zoneId, personCount, source, recordedAt) VALUES (?,?,'Webcam',NOW())",
    [zid, count]
  );
  await observeDensity({ ...zones[0], zoneId: zid }, count, 'Webcam');

  // Trigger route recomputation
  if (req.app.locals.broadcastRouteUpdate) {
    await req.app.locals.broadcastRouteUpdate();
  }

  res.status(201).json({ ok: true, zoneId: zid, personCount: count, source: 'Webcam' });
});

// GET /api/density/current — current density per zone
router.get('/current', requireApiAuth, async (_req, res) => {
  const densities = await getCurrentDensities();
  res.json([...densities.values()]);
});

module.exports = router;
