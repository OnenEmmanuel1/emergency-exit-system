'use strict';

/**
 * GET /api/signage/:zoneId/state
 * ─────────────────────────────────────────────────────────────
 * Polling endpoint for physical LED sign controllers.
 *
 * Future hardware deployment:
 *   A physical programmable exit sign controller polls this
 *   endpoint periodically to learn what direction and urgency
 *   colour to display.  No auth required — the sign is a
 *   read-only consumer of computed state.
 *
 * Response body (JSON):
 *   {
 *     zoneId: 2,
 *     zoneName: "Corridor A",
 *     recommendedDirectionZoneId: 5,
 *     recommendedDirectionName: "Exit North",
 *     urgency: "Normal",          // Normal | Elevated | Critical
 *     updatedAt: "2024-01-01T..."
 *   }
 */

const express  = require('express');
const { query } = require('../../db/db');
const router   = express.Router();

router.get('/:zoneId/state', async (req, res) => {
  const zid = parseInt(req.params.zoneId);
  if (isNaN(zid)) return res.status(400).json({ error: 'zoneId must be an integer.' });

  const [rows] = await query(
    `SELECT ss.*, z.name AS zoneName, d.name AS directionName
     FROM signage_states ss
     JOIN zones z ON ss.zoneId = z.zoneId
     LEFT JOIN zones d ON ss.recommendedDirectionZoneId = d.zoneId
     WHERE ss.zoneId = ?`,
    [zid]
  );

  if (!rows.length) return res.status(404).json({ error: 'No signage state for this zone.' });

  const s = rows[0];
  res.json({
    zoneId:                     s.zoneId,
    zoneName:                   s.zoneName,
    recommendedDirectionZoneId: s.recommendedDirectionZoneId,
    recommendedDirectionName:   s.directionName,
    urgency:                    s.urgency,
    updatedAt:                  s.updatedAt,
  });
});

// GET /api/signage/all — all zones' current signage state
router.get('/all', async (_req, res) => {
  const [rows] = await query(
    `SELECT ss.*, z.name AS zoneName, d.name AS directionName
     FROM signage_states ss
     JOIN zones z ON ss.zoneId = z.zoneId
     LEFT JOIN zones d ON ss.recommendedDirectionZoneId = d.zoneId`
  );
  res.json(rows);
});

module.exports = router;
