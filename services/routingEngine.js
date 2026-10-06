'use strict';

/**
 * routingEngine.js
 * ─────────────────────────────────────────────────────────────
 * Decision Engine — Section 2.2.2 / Section 5.4
 *
 * Implements a genuine Dijkstra shortest-path algorithm over the
 * building graph.  Edge weights are:
 *
 *   weight(edge) = edge.distanceMeters × congestionCost(destination zone)
 *
 * This means the algorithm genuinely steers evacuees away from
 * congested zones, not just toward geometrically near exits.
 *
 * Critical safety rule:
 *   Any zone with an ACTIVE hazard is REMOVED from the graph
 *   entirely before Dijkstra runs — it cannot appear anywhere
 *   in any computed path.
 *
 * After computing routes, results are persisted to:
 *   • evacuation_recommendations  (latest route per zone)
 *   • signage_states              (next-hop + urgency per zone)
 *
 * The caller (app.js) broadcasts signage updates via Socket.IO.
 */

const { query }                               = require('../db/db');
const { getCurrentDensities, urgencyFromCongestion } = require('./densityEngine');

// ── Dijkstra implementation ───────────────────────────────────

/**
 * A simple binary-heap priority queue for Dijkstra.
 * Stores { id, priority } objects.
 */
class MinHeap {
  constructor() { this._heap = []; }

  push(item) {
    this._heap.push(item);
    this._bubbleUp(this._heap.length - 1);
  }

  pop() {
    const top = this._heap[0];
    const last = this._heap.pop();
    if (this._heap.length > 0) {
      this._heap[0] = last;
      this._sinkDown(0);
    }
    return top;
  }

  get size() { return this._heap.length; }

  _bubbleUp(i) {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this._heap[parent].priority <= this._heap[i].priority) break;
      [this._heap[parent], this._heap[i]] = [this._heap[i], this._heap[parent]];
      i = parent;
    }
  }

  _sinkDown(i) {
    const n = this._heap.length;
    while (true) {
      let smallest = i;
      const l = 2 * i + 1, r = 2 * i + 2;
      if (l < n && this._heap[l].priority < this._heap[smallest].priority) smallest = l;
      if (r < n && this._heap[r].priority < this._heap[smallest].priority) smallest = r;
      if (smallest === i) break;
      [this._heap[smallest], this._heap[i]] = [this._heap[i], this._heap[smallest]];
      i = smallest;
    }
  }
}

/**
 * Core Dijkstra.
 * @param {number}   sourceId       Starting zone ID.
 * @param {Set}      hazardZoneIds  Zone IDs to exclude entirely.
 * @param {Map}      adjacency      Map<fromZoneId, [{toZoneId, distanceMeters}]>
 * @param {Map}      densities      Map<zoneId, {congestionCost, …}> from densityEngine
 * @returns {{ dist: Map<zoneId, number>, prev: Map<zoneId, number|null> }}
 */
function dijkstra(sourceId, hazardZoneIds, adjacency, densities) {
  const dist = new Map();
  const prev = new Map();
  const visited = new Set();

  // Initialise all reachable nodes
  for (const zoneId of adjacency.keys()) {
    dist.set(zoneId, Infinity);
    prev.set(zoneId, null);
  }
  dist.set(sourceId, 0);

  const heap = new MinHeap();
  heap.push({ id: sourceId, priority: 0 });

  while (heap.size > 0) {
    const { id: u } = heap.pop();
    if (visited.has(u)) continue;
    visited.add(u);

    const neighbours = adjacency.get(u) || [];
    for (const { toZoneId: v, distanceMeters } of neighbours) {
      if (hazardZoneIds.has(v)) continue; // exclude hazard zones
      const dv         = densities.get(v);
      const congestion = dv ? dv.congestionCost : 1;
      const weight     = distanceMeters * congestion;
      const alt        = dist.get(u) + weight;

      if (alt < (dist.get(v) ?? Infinity)) {
        dist.set(v, alt);
        prev.set(v, u);
        heap.push({ id: v, priority: alt });
      }
    }
  }

  return { dist, prev };
}

/** Reconstruct path from Dijkstra prev map */
function reconstructPath(prev, targetId) {
  const path = [];
  let current = targetId;
  while (current !== null && current !== undefined) {
    path.unshift(current);
    current = prev.get(current);
  }
  return path;
}

// ── Main recompute function ───────────────────────────────────

/**
 * Full recomputation pass:
 *  1. Load graph (zones + edges)
 *  2. Load active hazard zone IDs
 *  3. Load current densities (congestionCost per zone)
 *  4. For each non-exit, non-hazard zone: run Dijkstra → find best exit
 *  5. Persist results to evacuation_recommendations + signage_states
 *  6. Return signage update payload for Socket.IO broadcast
 */
async function recomputeRoutes() {
  // 1. Load zones
  const [zoneRows] = await query('SELECT zoneId, name, isExit FROM zones');
  const zones      = new Map(zoneRows.map(z => [z.zoneId, z]));
  const exitZoneIds = new Set(zoneRows.filter(z => z.isExit).map(z => z.zoneId));

  // 2. Load active hazards
  const [hazardRows] = await query(
    "SELECT zoneId FROM hazard_events WHERE status = 'Active'"
  );
  const hazardZoneIds = new Set(hazardRows.map(h => h.zoneId));

  // 3. Current densities
  const densities = await getCurrentDensities();
  const densityPayload = (zoneId) => {
    const d = densities.get(zoneId);
    return {
      personCount: d?.personCount ?? 0,
      densityPerM2: d?.densityPerM2 ?? 0,
      readingSource: d?.source ?? 'No reading',
    };
  };

  // 4. Build adjacency list (exclude hazard zones from graph entirely)
  const [edgeRows] = await query(
    'SELECT fromZoneId, toZoneId, distanceMeters FROM edges'
  );
  const adjacency = new Map();
  for (const z of zones.keys()) adjacency.set(z, []);
  for (const e of edgeRows) {
    if (hazardZoneIds.has(e.fromZoneId) || hazardZoneIds.has(e.toZoneId)) continue;
    adjacency.get(e.fromZoneId)?.push({
      toZoneId:       e.toZoneId,
      distanceMeters: parseFloat(e.distanceMeters),
    });
  }

  // 5. Route each non-exit, non-hazard zone
  const signageUpdates = [];

  for (const [zoneId, zone] of zones) {
    if (zone.isExit) continue;     // exits don't need a route
    if (hazardZoneIds.has(zoneId)) {
      await query(
        `INSERT INTO signage_states (zoneId, recommendedDirectionZoneId, urgency, updatedAt)
         VALUES (?, NULL, 'Critical', NOW())
         ON DUPLICATE KEY UPDATE recommendedDirectionZoneId = NULL, urgency = 'Critical', updatedAt = NOW()`,
        [zoneId]
      );
      signageUpdates.push({ zoneId, zoneName: zone.name, recommendedDirectionZoneId: null,
        recommendedDirectionName: null, urgency: 'Critical', pathZoneIds: [], pathNames: [],
        totalCost: null, isHazard: true, ...densityPayload(zoneId) });
      continue;
    }

    const { dist, prev } = dijkstra(zoneId, hazardZoneIds, adjacency, densities);

    // Find the reachable exit with lowest cost
    let bestExit = null;
    let bestCost = Infinity;
    for (const exitId of exitZoneIds) {
      if (hazardZoneIds.has(exitId)) continue;
      const d = dist.get(exitId) ?? Infinity;
      if (d < bestCost) { bestCost = d; bestExit = exitId; }
    }

    if (bestExit === null) {
      // No reachable exit — update signage to Critical with no direction
      await query(
        `INSERT INTO signage_states (zoneId, recommendedDirectionZoneId, urgency, updatedAt)
         VALUES (?, NULL, 'Critical', NOW())
         ON DUPLICATE KEY UPDATE
           recommendedDirectionZoneId = NULL,
           urgency = 'Critical',
           updatedAt = NOW()`,
        [zoneId]
      );
      signageUpdates.push({
        zoneId,
        zoneName: zone.name,
        recommendedDirectionZoneId: null,
        recommendedDirectionName: null,
        urgency: 'Critical',
        pathZoneIds: [],
        totalCost: null,
        ...densityPayload(zoneId),
      });
      continue;
    }

    const path          = reconstructPath(prev, bestExit);
    const nextHop       = path.length > 1 ? path[1] : bestExit;
    const nextHopName   = zones.get(nextHop)?.name ?? null;
    const density       = densities.get(zoneId);
    const congestion    = density ? density.congestionCost : 1;
    const urgency       = urgencyFromCongestion(congestion);

    // Persist to evacuation_recommendations
    await query(
      `INSERT INTO evacuation_recommendations
         (fromZoneId, recommendedExitZoneId, pathJson, totalCost, computedAt)
       VALUES (?, ?, ?, ?, NOW())`,
      [zoneId, bestExit, JSON.stringify(path), parseFloat(bestCost.toFixed(2))]
    );

    // Persist to signage_states (upsert)
    await query(
      `INSERT INTO signage_states (zoneId, recommendedDirectionZoneId, urgency, updatedAt)
       VALUES (?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
         recommendedDirectionZoneId = VALUES(recommendedDirectionZoneId),
         urgency                    = VALUES(urgency),
         updatedAt                  = NOW()`,
      [zoneId, nextHop, urgency]
    );

    signageUpdates.push({
      zoneId,
      zoneName:                   zone.name,
      recommendedDirectionZoneId: nextHop,
      recommendedDirectionName:   nextHopName,
      urgency,
      pathZoneIds:                path,
      pathNames:                  path.map(id => zones.get(id)?.name ?? id),
      totalCost:                  parseFloat(bestCost.toFixed(2)),
      ...densityPayload(zoneId),
    });
  }

  // Also include exit zones themselves (urgency: Normal, direction: null)
  for (const exitId of exitZoneIds) {
    const zone = zones.get(exitId);
    await query(
      `INSERT INTO signage_states (zoneId, recommendedDirectionZoneId, urgency, updatedAt)
       VALUES (?, NULL, 'Normal', NOW())
       ON DUPLICATE KEY UPDATE
         recommendedDirectionZoneId = NULL,
         urgency = 'Normal',
         updatedAt = NOW()`,
      [exitId]
    );
    signageUpdates.push({
      zoneId: exitId,
      zoneName: zone?.name ?? 'Exit',
      recommendedDirectionZoneId: null,
      recommendedDirectionName: null,
      urgency: 'Normal',
      pathZoneIds: [exitId],
      pathNames: [zone?.name ?? 'Exit'],
      totalCost: 0,
      isExit: true,
      ...densityPayload(exitId),
    });
  }

  return signageUpdates;
}

module.exports = { recomputeRoutes, dijkstra };
