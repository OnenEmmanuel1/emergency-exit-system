'use strict';
const express         = require('express');
const { requireAuth } = require('../middleware/auth');
const { query }       = require('../db/db');
const router          = express.Router();

const user = (req) => ({ userId: req.session.userId, fullName: req.session.fullName, role: req.session.role });
async function refreshRoutes(req) {
  try { await req.app.locals.broadcastRouteUpdate(); }
  catch (err) { console.error('[Zones] Route recompute failed:', err.message); }
}

// ── GET /zones ─────────────────────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  const [zones] = await query('SELECT * FROM zones ORDER BY isExit, name');
  const [edges] = await query(
    `SELECT e.*, a.name AS fromName, b.name AS toName
     FROM edges e
     JOIN zones a ON e.fromZoneId = a.zoneId
     JOIN zones b ON e.toZoneId   = b.zoneId
     ORDER BY a.name, b.name`
  );
  res.render('zones/index', {
    title: 'Building Graph — SEEX',
    user: user(req), zones, edges, error: null, success: null,
  });
});

// ── POST /zones (create zone) ─────────────────────────────────
router.post('/', requireAuth, async (req, res) => {
  const { name, isExit, capacityThreshold, areaM2 } = req.body;
  const errors = [];
  if (!name || !name.trim()) errors.push('Zone name is required.');
  const cap  = Number(capacityThreshold);
  const area = Number(areaM2);
  if (!Number.isInteger(cap) || cap <= 0) errors.push('Capacity threshold must be a positive integer.');
  if (!Number.isFinite(area) || area <= 0) errors.push('Area (m²) must be a positive number.');

  if (errors.length) {
    const [zones] = await query('SELECT * FROM zones ORDER BY isExit, name');
    const [edgs]  = await query(`SELECT e.*, a.name AS fromName, b.name AS toName FROM edges e JOIN zones a ON e.fromZoneId=a.zoneId JOIN zones b ON e.toZoneId=b.zoneId`);
    return res.status(400).render('zones/index', {
      title: 'Building Graph — SEEX', user: user(req), zones, edges: edgs,
      error: errors.join(' '), success: null,
    });
  }

  await query(
    'INSERT INTO zones (name, isExit, capacityThreshold, areaM2) VALUES (?, ?, ?, ?)',
    [name.trim(), isExit === '1' ? 1 : 0, cap, area]
  );
  await refreshRoutes(req);
  res.redirect('/zones?success=Zone+created');
});

// ── POST /zones/:id/delete ─────────────────────────────────────
router.post('/:id/delete', requireAuth, async (req, res) => {
  await query('DELETE FROM zones WHERE zoneId = ?', [req.params.id]);
  await refreshRoutes(req);
  res.redirect('/zones?success=Zone+deleted');
});

// ── POST /zones/:id/edit ───────────────────────────────────────
router.post('/:id/edit', requireAuth, async (req, res) => {
  const { name, isExit, capacityThreshold, areaM2 } = req.body;
  const cap  = Number(capacityThreshold);
  const area = Number(areaM2);
  if (!name || !name.trim() || !Number.isInteger(cap) || cap <= 0 || !Number.isFinite(area) || area <= 0) {
    return res.redirect('/zones?error=Invalid+zone+data');
  }
  await query(
    'UPDATE zones SET name=?, isExit=?, capacityThreshold=?, areaM2=? WHERE zoneId=?',
    [name.trim(), isExit === '1' ? 1 : 0, cap, area, req.params.id]
  );
  await refreshRoutes(req);
  res.redirect('/zones?success=Zone+updated');
});

// ── POST /zones/edges (create edge) ───────────────────────────
router.post('/edges', requireAuth, async (req, res) => {
  const { fromZoneId, toZoneId, distanceMeters } = req.body;
  const dist  = Number(distanceMeters);
  const fromId = Number(fromZoneId);
  const toId   = Number(toZoneId);

  if (fromId === toId)         return res.redirect('/zones?error=Self-referencing+edge+not+allowed');
  if (!Number.isFinite(dist) || dist <= 0) return res.redirect('/zones?error=Distance+must+be+positive');
  if (!Number.isInteger(fromId) || !Number.isInteger(toId)) return res.redirect('/zones?error=Select+valid+zones');
  const [existingZones] = await query('SELECT zoneId FROM zones WHERE zoneId IN (?, ?)', [fromId, toId]);
  if (existingZones.length !== 2) return res.redirect('/zones?error=Select+valid+zones');

  // Bidirectional
  await query('INSERT INTO edges (fromZoneId, toZoneId, distanceMeters) VALUES (?,?,?)', [fromId, toId, dist]);
  await query('INSERT INTO edges (fromZoneId, toZoneId, distanceMeters) VALUES (?,?,?)', [toId, fromId, dist]);
  await refreshRoutes(req);

  res.redirect('/zones?success=Edge+added');
});

// Update both directed rows that represent one bidirectional pathway.
router.post('/edges/:id/edit', requireAuth, async (req, res) => {
  const [rows] = await query('SELECT edgeId, fromZoneId, toZoneId FROM edges WHERE edgeId=?', [req.params.id]);
  if (!rows.length) return res.redirect('/zones?error=Pathway+not+found');
  const fromId = Number(req.body.fromZoneId);
  const toId = Number(req.body.toZoneId);
  const distance = Number(req.body.distanceMeters);
  if (!Number.isInteger(fromId) || !Number.isInteger(toId) || fromId <= 0 || toId <= 0 || fromId === toId || !Number.isFinite(distance) || distance <= 0) {
    return res.redirect('/zones?error=Invalid+pathway+data');
  }
  const [existingZones] = await query('SELECT zoneId FROM zones WHERE zoneId IN (?, ?)', [fromId, toId]);
  if (existingZones.length !== 2) return res.redirect('/zones?error=Select+valid+zones');
  const { fromZoneId, toZoneId } = rows[0];
  const [reverseRows] = await query('SELECT edgeId FROM edges WHERE fromZoneId=? AND toZoneId=? LIMIT 1', [toZoneId, fromZoneId]);
  await query('UPDATE edges SET fromZoneId=?, toZoneId=?, distanceMeters=? WHERE edgeId=?', [fromId, toId, distance, rows[0].edgeId]);
  if (reverseRows.length) {
    await query('UPDATE edges SET fromZoneId=?, toZoneId=?, distanceMeters=? WHERE edgeId=?', [toId, fromId, distance, reverseRows[0].edgeId]);
  }
  await refreshRoutes(req);
  res.redirect('/zones?success=Pathway+updated');
});

// ── POST /zones/edges/:id/delete ──────────────────────────────
router.post('/edges/:id/delete', requireAuth, async (req, res) => {
  // Delete the pair (both directions)
  const [edgeRows] = await query('SELECT fromZoneId, toZoneId FROM edges WHERE edgeId=?', [req.params.id]);
  if (edgeRows.length) {
    const { fromZoneId, toZoneId } = edgeRows[0];
    await query('DELETE FROM edges WHERE (fromZoneId=? AND toZoneId=?) OR (fromZoneId=? AND toZoneId=?)',
      [fromZoneId, toZoneId, toZoneId, fromZoneId]);
  }
  await refreshRoutes(req);
  res.redirect('/zones?success=Edge+deleted');
});

module.exports = router;
