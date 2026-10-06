'use strict';
const express         = require('express');
const { requireAuth } = require('../middleware/auth');
const { query }       = require('../db/db');
const router          = express.Router();

const user = (req) => ({ userId: req.session.userId, fullName: req.session.fullName, role: req.session.role });

// ── GET /reports ───────────────────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  // Historical density: hourly averages per zone, last 48 hours
  const [densityHistory] = await query(`
    SELECT
      z.zoneId,
      z.name AS zoneName,
      dr.source AS source,
      DATE_FORMAT(dr.recordedAt, '%Y-%m-%d %H:00:00') AS hour,
      ROUND(AVG(dr.personCount / z.areaM2), 4) AS avgDensity,
      ROUND(MAX(dr.personCount / z.areaM2), 4) AS peakDensity
    FROM density_readings dr
    JOIN zones z ON dr.zoneId = z.zoneId
    WHERE dr.recordedAt >= NOW() - INTERVAL 48 HOUR
    GROUP BY z.zoneId, z.name, dr.source, hour
    ORDER BY z.name, hour, dr.source
  `);

  // Hazard event log with resolution time
  const [hazardLog] = await query(`
    SELECT
      h.*,
      z.name AS zoneName,
      u.fullName AS declaredByName,
      TIMESTAMPDIFF(MINUTE, h.declaredAt, COALESCE(h.clearedAt, NOW())) AS durationMinutes
    FROM hazard_events h
    JOIN zones z ON h.zoneId = z.zoneId
    LEFT JOIN users u ON h.declaredBy = u.userId
    ORDER BY h.declaredAt DESC
    LIMIT 100
  `);

  // Group density history by zone for chart rendering
  const chartData = Object.create(null);
  for (const row of densityHistory) {
    if (!chartData[row.zoneName]) chartData[row.zoneName] = { hours: new Map() };
    const hours = chartData[row.zoneName].hours;
    if (!hours.has(row.hour)) hours.set(row.hour, {});
    hours.get(row.hour)[row.source] = { avg: Number(row.avgDensity), max: Number(row.peakDensity) };
  }

  for (const series of Object.values(chartData)) {
    const hours = [...series.hours.keys()].sort();
    const sources = [...new Set([...series.hours.values()].flatMap((hour) => Object.keys(hour)))];
    series.labels = hours;
    series.sources = Object.fromEntries(sources.map((source) => [source, {
      avgDensity: hours.map((hour) => series.hours.get(hour)[source]?.avg ?? null),
      peakDensity: hours.map((hour) => series.hours.get(hour)[source]?.max ?? null),
    }]));
    delete series.hours;
  }

  // Zone names are administrator input; escape HTML metacharacters before
  // embedding JSON in the reports page's script element.
  const safeChartData = JSON.stringify(chartData)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');

  res.render('reports/index', {
    title: 'Historical Reports — SEEX',
    user: user(req),
    chartData: safeChartData,
    hazardLog,
  });
});

module.exports = router;
