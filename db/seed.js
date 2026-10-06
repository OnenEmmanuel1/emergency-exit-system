'use strict';
require('dotenv').config();
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');

/**
 * SEEX Seed Script
 * ─────────────────────────────────────────────────────────────
 * Populates a sample 5-zone building graph (Floors 1):
 *
 *   [Lobby]──10m──[Corridor A]──15m──[Office Block]
 *      │                │
 *     5m              12m
 *      │                │
 *   [Exit North]    [Stairwell]──8m──[Exit South]
 *
 * Two exits: "Exit North" (ground-floor door) and "Exit South"
 * (rear emergency stairwell exit).  All edges are bidirectional.
 *
 * Also seeds:
 *  - One Administrator account (email: admin@seex.local / password: password123)
 *  - 48 hours of simulated density_readings for each zone
 *  - Default signage_states rows (Normal urgency)
 */
async function seed() {
  const required = ['DB_USER', 'DB_NAME'];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) throw new Error(`Missing required database environment variables: ${missing.join(', ')}`);
  const connection = await mysql.createConnection({
    host:     process.env.DB_HOST     || 'localhost',
    port:     parseInt(process.env.DB_PORT || '3306'),
    user:     process.env.DB_USER,
    password: process.env.DB_PASSWORD !== undefined ? process.env.DB_PASSWORD : (process.env.DB_USER === 'root' ? (process.env.MYSQL_ROOT_PASSWORD || '') : (process.env.DB_PASS || '')),
    database: process.env.DB_NAME,
    multipleStatements: false,
  });

  try {
    console.log('📦 Running SEEX seed…');

    // ── 1. Create admin user ────────────────────────────────
    const passwordHash = await bcrypt.hash('password123', 12);
    await connection.execute(
      `INSERT INTO users (fullName, email, phone, passwordHash, role)
       VALUES (?, ?, ?, ?, 'Administrator')
       ON DUPLICATE KEY UPDATE fullName=VALUES(fullName), phone=VALUES(phone), passwordHash=VALUES(passwordHash)`,
      ['SEEX Administrator', process.env.ADMIN_EMAIL || 'admin@seex.local', process.env.ADMIN_PHONE || null, passwordHash]
    );
    console.log(`  ✔ Admin user provisioned: ${process.env.ADMIN_EMAIL || 'admin@seex.local'}`);

    // ── 2. Zones ────────────────────────────────────────────
    const zoneDefs = [
      { name: 'Lobby',         isExit: false, capacity: 40, area: 80.00 },
      { name: 'Corridor A',    isExit: false, capacity: 20, area: 30.00 },
      { name: 'Office Block',  isExit: false, capacity: 50, area: 120.00 },
      { name: 'Stairwell',     isExit: false, capacity: 15, area: 20.00 },
      { name: 'Exit North',    isExit: true,  capacity: 30, area: 25.00 },
      { name: 'Exit South',    isExit: true,  capacity: 30, area: 25.00 },
    ];

    const zoneIds = {};
    for (const z of zoneDefs) {
      const [existing] = await connection.execute(
        'SELECT zoneId FROM zones WHERE name = ?', [z.name]
      );
      if (existing.length > 0) {
        zoneIds[z.name] = existing[0].zoneId;
      } else {
        const [res] = await connection.execute(
          `INSERT INTO zones (name, isExit, capacityThreshold, areaM2)
           VALUES (?, ?, ?, ?)`,
          [z.name, z.isExit, z.capacity, z.area]
        );
        zoneIds[z.name] = res.insertId;
      }
    }
    console.log('  ✔ Zones seeded:', Object.keys(zoneIds).join(', '));

    // ── 3. Edges (bidirectional — insert both directions) ───
    const edgeDefs = [
      ['Lobby',        'Corridor A',   10.00],
      ['Lobby',        'Exit North',    5.00],
      ['Corridor A',   'Office Block', 15.00],
      ['Corridor A',   'Stairwell',    12.00],
      ['Stairwell',    'Exit South',    8.00],
    ];

    // Clear existing edges to avoid duplication on re-seed
    await connection.execute('DELETE FROM edges WHERE 1');
    for (const [a, b, dist] of edgeDefs) {
      await connection.execute(
        'INSERT INTO edges (fromZoneId, toZoneId, distanceMeters) VALUES (?, ?, ?)',
        [zoneIds[a], zoneIds[b], dist]
      );
      await connection.execute(
        'INSERT INTO edges (fromZoneId, toZoneId, distanceMeters) VALUES (?, ?, ?)',
        [zoneIds[b], zoneIds[a], dist]
      );
    }
    console.log('  ✔ Edges seeded (bidirectional)');

    // ── 4. Seed signage_states (Normal, no direction yet) ───
    for (const [name, id] of Object.entries(zoneIds)) {
      await connection.execute(
        `INSERT INTO signage_states (zoneId, recommendedDirectionZoneId, urgency, updatedAt)
         VALUES (?, NULL, 'Normal', NOW())
         ON DUPLICATE KEY UPDATE updatedAt = NOW()`,
        [id]
      );
    }
    console.log('  ✔ signage_states initialised');

    // ── 5. Historical density readings (48 hours, ~every 10 min)
    const now = new Date();
    const nonExitZones = zoneDefs
      .filter(z => !z.isExit)
      .map(z => ({ id: zoneIds[z.name], capacity: z.capacity }));

    // bounded random-walk state per zone
    const walkState = {};
    for (const z of nonExitZones) walkState[z.id] = Math.floor(z.capacity * 0.3);

    const readings = [];
    for (let minutesAgo = 48 * 60; minutesAgo >= 0; minutesAgo -= 10) {
      const ts = new Date(now.getTime() - minutesAgo * 60000);
      const tsStr = ts.toISOString().slice(0, 19).replace('T', ' ');
      for (const z of nonExitZones) {
        // bounded random-walk: ±3 people, clamp [0, capacity*1.3]
        const delta = Math.floor(Math.random() * 7) - 3;
        walkState[z.id] = Math.max(0, Math.min(
          Math.floor(z.capacity * 1.3),
          walkState[z.id] + delta
        ));
        readings.push([z.id, walkState[z.id], 'Simulated', tsStr]);
      }
    }

    // Batch insert in chunks of 500
    for (let i = 0; i < readings.length; i += 500) {
      const chunk = readings.slice(i, i + 500);
      const placeholders = chunk.map(() => '(?,?,?,?)').join(',');
      const values = chunk.flat();
      await connection.execute(
        `INSERT INTO density_readings (zoneId, personCount, source, recordedAt) VALUES ${placeholders}`,
        values
      );
    }
    console.log(`  ✔ ${readings.length} historical density readings seeded`);

    console.log('\n🎉 Seed complete. Login credentials are documented in README.md.');
  } finally {
    await connection.end();
  }
}

seed().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
