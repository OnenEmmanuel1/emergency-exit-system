'use strict';
const express          = require('express');
const { requireAuth }  = require('../middleware/auth');
const { query }        = require('../db/db');
const { alertAllAdmins } = require('../services/alertService');
const router           = express.Router();

const VALID_TYPES = ['Fire', 'Smoke', 'StructuralDamage', 'Security'];
const user = (req) => ({ userId: req.session.userId, fullName: req.session.fullName, role: req.session.role });

// ── GET /hazards ───────────────────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  const [hazards] = await query(
    `SELECT h.*, z.name AS zoneName, u.fullName AS declaredByName
     FROM hazard_events h
     JOIN zones z ON h.zoneId = z.zoneId
     LEFT JOIN users u ON h.declaredBy = u.userId
     ORDER BY h.status ASC, h.declaredAt DESC`
  );
  const [zones] = await query('SELECT zoneId, name FROM zones WHERE isExit = FALSE ORDER BY name');
  res.render('hazards/index', {
    title: 'Hazard Management — SEEX',
    user: user(req), hazards, zones,
    error: req.query.error || null,
    success: req.query.success || null,
  });
});

// ── POST /hazards (declare hazard) ────────────────────────────
router.post('/', requireAuth, async (req, res) => {
  const { zoneId, type } = req.body;
  const zid = parseInt(zoneId);

  if (isNaN(zid)) return res.redirect('/hazards?error=Invalid+zone');
  if (!VALID_TYPES.includes(type)) return res.redirect('/hazards?error=Invalid+hazard+type');

  // Validate zone exists
  const [zones] = await query('SELECT zoneId, name FROM zones WHERE zoneId = ?', [zid]);
  if (!zones.length) return res.redirect('/hazards?error=Zone+not+found');

  // Insert hazard
  const [result] = await query(
    `INSERT INTO hazard_events (zoneId, type, status, declaredBy, declaredAt)
     VALUES (?, ?, 'Active', ?, NOW())`,
    [zid, type, req.session.userId]
  );
  const hazardId = result.insertId;

  // Recompute and publish immediately so displays change before email delivery.
  try { await req.app.locals.broadcastRouteUpdate(); }
  catch (err) { console.error('[Hazards] Recompute error:', err.message); }

  // Alert delivery is independent of the signage update.
  const msg = `HAZARD DECLARED: ${type} at zone "${zones[0].name}". Take immediate action.`;
  alertAllAdmins({ hazardId, message: msg, subject: `${type} — ${zones[0].name}` })
    .catch(err => console.error('[Hazards] Alert dispatch failed:', err.message));

  res.redirect('/hazards?success=Hazard+declared');
});

// ── POST /hazards/:id/clear ────────────────────────────────────
router.post('/:id/clear', requireAuth, async (req, res) => {
  const [rows] = await query('SELECT * FROM hazard_events WHERE hazardId=?', [req.params.id]);
  if (!rows.length || rows[0].status !== 'Active') {
    return res.redirect('/hazards?error=Hazard+not+found+or+already+cleared');
  }
  await query(
    "UPDATE hazard_events SET status='Cleared', clearedAt=NOW() WHERE hazardId=?",
    [req.params.id]
  );

  // Recompute routes + broadcast
  try {
    await req.app.locals.broadcastRouteUpdate();
  } catch (err) {
    console.error('[Hazards] Recompute error:', err.message);
  }

  res.redirect('/hazards?success=Hazard+cleared');
});

module.exports = router;
