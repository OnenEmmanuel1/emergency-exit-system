'use strict';
const express           = require('express');
const { requireAuth }   = require('../middleware/auth');
const { query }         = require('../db/db');
const { getCurrentDensities } = require('../services/densityEngine');
const router            = express.Router();

// GET /dashboard
router.get('/', requireAuth, async (req, res) => {
  try {
    const [zones]     = await query('SELECT * FROM zones ORDER BY isExit, name');
    const [hazards]   = await query(
      `SELECT h.*, z.name AS zoneName
       FROM hazard_events h JOIN zones z ON h.zoneId = z.zoneId
       WHERE h.status = 'Active'
       ORDER BY h.declaredAt DESC`
    );
    const [signage]   = await query(
      `SELECT ss.*, z.name AS zoneName, d.name AS directionName
       FROM signage_states ss
       JOIN zones z ON ss.zoneId = z.zoneId
       LEFT JOIN zones d ON ss.recommendedDirectionZoneId = d.zoneId
       ORDER BY ss.urgency DESC, z.name`
    );
    const densities   = await getCurrentDensities();
    const [recentAlerts] = await query(
      `SELECT a.*, u.fullName AS userName
       FROM alerts a JOIN users u ON a.userId = u.userId
       ORDER BY a.sentAt DESC LIMIT 10`
    );

    const user = {
      userId:   req.session.userId,
      fullName: req.session.fullName,
      role:     req.session.role,
    };

    res.render('dashboard/index', {
      title:        'Dashboard — SEEX',
      user,
      zones,
      hazards,
      signage,
      densities:    Object.fromEntries(densities),
      recentAlerts,
    });
  } catch (err) {
    console.error('[Dashboard]', err);
    res.status(500).render('error', {
      title:   'Error',
      message: err.message,
      user:    { userId: req.session.userId, fullName: req.session.fullName },
    });
  }
});

module.exports = router;
