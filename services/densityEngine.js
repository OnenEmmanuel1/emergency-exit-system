'use strict';

/**
 * densityEngine.js
 * ─────────────────────────────────────────────────────────────
 * Crowd Analytics Module (Section 3.6 "Data Processing")
 *
 * Responsibilities:
 *  1. Fetch the most-recent density reading per zone.
 *  2. Compute people-per-m² density.
 *  3. Compute the congestionCost multiplier:
 *
 *       congestionCost(zone) = 1 + (latestPersonCount / zone.capacityThreshold)
 *
 *     This is a real, documented formula — not a placeholder.
 *     When a zone is empty the multiplier is 1 (baseline).
 *     When personCount equals capacityThreshold the multiplier is 2
 *     (routing costs twice as much through that zone), steering
 *     Dijkstra toward less-congested paths.
 *
 * Current density values are fetched fresh for each routing pass. Sustained
 * alert timing is tracked separately in memory across incoming readings.
 */

const { query } = require('../db/db');
const { alertAllAdmins } = require('./alertService');

// High-density periods are tracked across all input sources. The clock resets
// when a reading drops below threshold; alerting happens on a subsequent read.
const highDensitySince = new Map();

async function observeDensity(zone, personCount, source) {
  const key = Number(zone.zoneId);
  const threshold = Number(zone.capacityThreshold);
  const now = Date.now();
  const prior = highDensitySince.get(key);
  if (personCount > threshold) {
    const since = prior ?? now;
    highDensitySince.set(key, since);
    const durationMs = Math.max(1, Number(process.env.DENSITY_ALERT_MINUTES || 5)) * 60000;
    if (now - since >= durationMs) {
      const message = `Zone "${zone.name}" has exceeded its capacity threshold (${threshold}) for at least ${Math.floor((now - since) / 60000)} minutes. Current count: ${personCount} (${source}).`;
      await alertAllAdmins({ hazardId: null, message, subject: `High Density — ${zone.name}` });
      highDensitySince.set(key, now);
    }
  } else {
    highDensitySince.delete(key);
  }
}

/**
 * Returns a Map<zoneId, { personCount, densityPerM2, congestionCost }>
 * for every zone in the database, using the most recent reading.
 * Zones with no reading at all default to personCount 0, cost 1.
 */
async function getCurrentDensities() {
  // Subquery: pick the single most-recent reading per zone
  const [rows] = await query(`
    SELECT
      z.zoneId,
      z.name,
      z.capacityThreshold,
      z.areaM2,
      COALESCE(dr.personCount, 0) AS personCount,
      COALESCE(dr.source, 'No reading') AS source
    FROM zones z
    LEFT JOIN density_readings dr ON dr.readingId = (
      SELECT readingId
      FROM density_readings
      WHERE zoneId = z.zoneId
      ORDER BY recordedAt DESC
      LIMIT 1
    )
  `);

  const result = new Map();
  for (const row of rows) {
    const personCount    = row.personCount;
    const densityPerM2   = row.areaM2 > 0 ? personCount / row.areaM2 : 0;
    const congestionCost = 1 + (personCount / row.capacityThreshold);
    result.set(row.zoneId, {
      zoneId:          row.zoneId,
      name:            row.name,
      capacityThreshold: row.capacityThreshold,
      areaM2:          row.areaM2,
      personCount,
      source:           row.source,
      densityPerM2:    parseFloat(densityPerM2.toFixed(4)),
      congestionCost:  parseFloat(congestionCost.toFixed(4)),
    });
  }
  return result;
}

/**
 * Determine urgency level for signage from the congestion cost.
 *   Normal:   cost < 1.5  (zone under half its threshold)
 *   Elevated: 1.5 ≤ cost < 2.0
 *   Critical: cost ≥ 2.0  (zone at or above threshold)
 */
function urgencyFromCongestion(congestionCost) {
  if (congestionCost >= 2.0) return 'Critical';
  if (congestionCost >= 1.5) return 'Elevated';
  return 'Normal';
}

module.exports = { getCurrentDensities, urgencyFromCongestion, observeDensity };
