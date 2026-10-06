'use strict';

/**
 * simulator.js
 * ─────────────────────────────────────────────────────────────
 * Simulated density input (Section 5.2 / Section 3.6 "Data Collection")
 *
 * Uses node-cron to generate density_readings for non-exit zones
 * every 60 seconds using a bounded random-walk model:
 *
 *   newCount = clamp(prevCount + delta, 0, floor(threshold × 1.5))
 *   delta    = random integer in [-3, +3]
 *
 * This matches the simulation pattern described in Section 1.6
 * and is the same bounded-walk used in the seed script.
 *
 * Density readings from this and the manual/webcam paths share the
 * sustained-high-density monitor in densityEngine.js.
 *
 * The simulator is started once by app.js and runs for the lifetime
 * of the process.
 */

const cron              = require('node-cron');
const { query }         = require('../db/db');
const { observeDensity } = require('./densityEngine');

const walkState = new Map();

async function runSimulatorTick(broadcastFn) {
  // Load non-exit zones
  const [zones] = await query(
    `SELECT z.zoneId, z.name, z.capacityThreshold,
            COALESCE(dr.personCount, 0) AS personCount,
            dr.source,
            TIMESTAMPDIFF(SECOND, dr.recordedAt, NOW()) AS readingAgeSeconds
     FROM zones z
     LEFT JOIN density_readings dr ON dr.readingId = (
       SELECT readingId FROM density_readings WHERE zoneId=z.zoneId ORDER BY recordedAt DESC LIMIT 1
     )
     WHERE z.isExit = FALSE`
  );

  for (const zone of zones) {
    // Fresh real/manual observations take precedence. The simulator resumes
    // only after five minutes without an update, and remains source-labeled.
    if ((zone.source === 'Webcam' || zone.source === 'Manual') && zone.readingAgeSeconds < 300) continue;
    const prev    = walkState.get(zone.zoneId) ?? {
      count:     Number(zone.personCount),
    };

    // Bounded random walk
    const delta    = Math.floor(Math.random() * 7) - 3;
    const maxCount = Math.floor(zone.capacityThreshold * 1.5);
    const newCount = Math.max(0, Math.min(maxCount, prev.count + delta));

    // Write density reading
    await query(
      `INSERT INTO density_readings (zoneId, personCount, source, recordedAt)
       VALUES (?, ?, 'Simulated', NOW())`,
      [zone.zoneId, newCount]
    );
    await observeDensity(zone, newCount, 'Simulated');
    walkState.set(zone.zoneId, { count: newCount });
  }

  // Trigger route recomputation and broadcast
  if (typeof broadcastFn === 'function') {
    try {
      await broadcastFn();
    } catch (err) {
      console.error('[Simulator] Broadcast error:', err.message);
    }
  }
}

/**
 * Start the density simulator.
 * @param {Function} broadcastFn  – async () => void, called after each tick
 *                                   to trigger route recomputation + Socket.IO push
 */
function startSimulator(broadcastFn) {
  // Run every 60 seconds
  cron.schedule('* * * * *', async () => {
    try {
      await runSimulatorTick(broadcastFn);
    } catch (err) {
      console.error('[Simulator] Tick error:', err.message);
    }
  });
  console.log('[Simulator] Started — density readings every 60 s');
}

module.exports = { startSimulator };
