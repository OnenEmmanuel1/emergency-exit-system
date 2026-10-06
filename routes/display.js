'use strict';
const express = require('express');
const { query } = require('../db/db');
const router  = express.Router();

/**
 * GET /display
 * Lists all zones so a wall-display operator can pick a zone.
 * Unauthenticated — intended for wall-mounted screens.
 */
router.get('/', async (_req, res) => {
  const [zones] = await query('SELECT zoneId, name, isExit FROM zones ORDER BY isExit, name');
  res.render('display/index', { title: 'Exit Status — SEEX', zones, user: null });
});

/**
 * GET /display/:zoneId
 * Full-screen exit-status display for a specific zone.
 * Shows: zone name, recommended next direction, urgency colour, path to exit.
 * Updates in real-time via Socket.IO — no page refresh needed.
 */
router.get('/:zoneId', async (req, res) => {
  const zid = parseInt(req.params.zoneId);
  if (isNaN(zid)) return res.redirect('/display');

  const [zones] = await query('SELECT * FROM zones WHERE zoneId = ?', [zid]);
  if (!zones.length) return res.redirect('/display');

  const [signage] = await query(
    `SELECT ss.*, z.name AS zoneName, d.name AS directionName
     FROM signage_states ss
     JOIN zones z ON ss.zoneId = z.zoneId
     LEFT JOIN zones d ON ss.recommendedDirectionZoneId = d.zoneId
     WHERE ss.zoneId = ?`,
    [zid]
  );

  const [hazards] = await query(
    "SELECT type FROM hazard_events WHERE zoneId=? AND status='Active' LIMIT 1",
    [zid]
  );

  res.render('display/zone', {
    title:    `${zones[0].name} — Exit Status`,
    zone:     zones[0],
    signage:  signage[0] || null,
    hazard:   hazards[0] || null,
    user:     null,
  });
});

module.exports = router;
