'use strict';
const express         = require('express');
const { requireAuth } = require('../middleware/auth');
const { query }       = require('../db/db');
const { observeDensity } = require('../services/densityEngine');
const router          = express.Router();

const user = (req) => ({ userId: req.session.userId, fullName: req.session.fullName, role: req.session.role });

// ── GET /density ───────────────────────────────────────────────
// Admin density management: manual input + webcam launcher
router.get('/', requireAuth, async (req, res) => {
  const [zones] = await query(
    "SELECT z.*, COALESCE(dr.personCount,0) AS currentCount FROM zones z LEFT JOIN density_readings dr ON dr.readingId=(SELECT readingId FROM density_readings WHERE zoneId=z.zoneId ORDER BY recordedAt DESC LIMIT 1) WHERE z.isExit=FALSE ORDER BY z.name"
  );
  const [recent] = await query(
    `SELECT dr.*, z.name AS zoneName
     FROM density_readings dr JOIN zones z ON dr.zoneId = z.zoneId
     ORDER BY dr.recordedAt DESC LIMIT 30`
  );
  res.render('density/index', {
    title: 'Density Input — SEEX',
    user: user(req), zones, recentReadings: recent,
    error: req.query.error || null,
    success: req.query.success || null,
  });
});

// ── POST /density/manual ───────────────────────────────────────
// Manual density override by admin
router.post('/manual', requireAuth, async (req, res) => {
  const { zoneId, personCount } = req.body;
  const zid   = Number(zoneId);
  const count = Number(personCount);

  if (!Number.isInteger(zid) || zid <= 0) return res.redirect('/density?error=Invalid+zone');
  if (!Number.isInteger(count) || count < 0) return res.redirect('/density?error=Person+count+must+be+0+or+more');

  // Validate against zone capacity (sanity bound: 3× threshold)
  const [zones] = await query('SELECT name, capacityThreshold FROM zones WHERE zoneId=?', [zid]);
  if (!zones.length) return res.redirect('/density?error=Zone+not+found');
  if (count > zones[0].capacityThreshold * 3) {
    return res.redirect('/density?error=Person+count+exceeds+sanity+bound+(3%C3%97+threshold)');
  }

  await query(
    "INSERT INTO density_readings (zoneId, personCount, source, recordedAt) VALUES (?,?,'Manual',NOW())",
    [zid, count]
  );
  await observeDensity({ ...zones[0], zoneId: zid, name: zones[0].name }, count, 'Manual');

  // Recompute + broadcast
  try {
    await req.app.locals.broadcastRouteUpdate();
  } catch (e) {
    console.error('[Density] Recompute error:', e.message);
  }

  res.redirect('/density?success=Reading+recorded');
});

// ── GET /density/camera ────────────────────────────────────────
// TensorFlow.js webcam page (unauthenticated OK — runs client-side)
router.get('/camera', requireAuth, async (req, res) => {
  const [zones] = await query('SELECT zoneId, name FROM zones WHERE isExit=FALSE ORDER BY name');
  res.render('density/camera', {
    title: 'Webcam People Counter — SEEX',
    user: user(req), zones,
  });
});

module.exports = router;
