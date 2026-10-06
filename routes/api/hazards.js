'use strict';

/**
 * POST /api/hazards/report
 * ─────────────────────────────────────────────────────────────
 * Webhook endpoint for physical IoT sensor controllers.
 * Requires X-API-Key header matching WEBHOOK_API_KEY env var.
 *
 * Future hardware deployment:
 *   A physical smoke/temperature sensor controller POSTs here
 *   when it detects a hazard condition.  The software side is
 *   a complete, real integration point — the webhook receives
 *   and processes the event exactly as an admin declaration does.
 *
 * Request body (JSON):
 *   { "zoneId": 3, "type": "Smoke" }
 *
 * Response: 201 with created hazard ID, or 4xx on validation error.
 */

const express            = require('express');
const { requireApiKey, requireApiAuth }  = require('../../middleware/auth');
const { query }          = require('../../db/db');
const { alertAllAdmins } = require('../../services/alertService');
const router             = express.Router();

const VALID_TYPES = ['Fire', 'Smoke', 'StructuralDamage', 'Security'];

router.post('/report', requireApiKey, async (req, res) => {
  const { zoneId, type } = req.body;
  const zid = Number(zoneId);

  if (!Number.isInteger(zid) || zid <= 0) return res.status(400).json({ error: 'zoneId must be a positive integer.' });
  if (!VALID_TYPES.includes(type))   return res.status(400).json({ error: `type must be one of: ${VALID_TYPES.join(', ')}` });

  const [zones] = await query('SELECT zoneId, name FROM zones WHERE zoneId=?', [zid]);
  if (!zones.length) return res.status(404).json({ error: 'Zone not found.' });

  const [result] = await query(
    "INSERT INTO hazard_events (zoneId, type, status, declaredBy, declaredAt) VALUES (?,?,'Active',NULL,NOW())",
    [zid, type]
  );
  const hazardId = result.insertId;

  // Publish the new routing state before any potentially slow notification I/O.
  if (req.app.locals.broadcastRouteUpdate) {
    try { await req.app.locals.broadcastRouteUpdate(); }
    catch (err) { console.error('[API Hazard] Recompute:', err.message); }
  }

  const msg = `[Webhook] HAZARD REPORTED: ${type} at zone "${zones[0].name}" (via sensor controller).`;
  console.warn(msg);
  alertAllAdmins({ hazardId, message: msg, subject: `Sensor Report: ${type} — ${zones[0].name}` })
    .catch(err => console.error('[API Hazard] Alert dispatch failed:', err.message));

  res.status(201).json({ hazardId, zoneId: zid, type, status: 'Active', message: 'Hazard recorded; administrator alert delivery started.' });
});

// GET /api/hazards/active — convenience endpoint
router.get('/active', requireApiAuth, async (_req, res) => {
  const [rows] = await query(
    `SELECT h.*, z.name AS zoneName FROM hazard_events h JOIN zones z ON h.zoneId=z.zoneId WHERE h.status='Active'`
  );
  res.json(rows);
});

module.exports = router;
