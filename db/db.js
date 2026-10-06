'use strict';
require('dotenv').config();
const mysql = require('mysql2/promise');

let pool;

async function getPool() {
  if (!pool) {
    const required = ['DB_USER', 'DB_NAME'];
    const missing = required.filter((key) => !process.env[key]);
    if (missing.length) throw new Error(`Missing required database environment variables: ${missing.join(', ')}`);
    pool = mysql.createPool({
      host:               process.env.DB_HOST     || 'localhost',
      port:               parseInt(process.env.DB_PORT || '3306'),
      user:               process.env.DB_USER,
      password:           process.env.DB_PASSWORD !== undefined ? process.env.DB_PASSWORD : (process.env.DB_USER === 'root' ? (process.env.MYSQL_ROOT_PASSWORD || '') : (process.env.DB_PASS || '')),
      database:           process.env.DB_NAME,
      waitForConnections: true,
      connectionLimit:    10,
      queueLimit:         0,
      timezone:           '+00:00',
    });
  }
  return pool;
}

/**
 * Execute a parameterised query and return [rows, fields].
 * All callers use this — no raw string interpolation anywhere.
 */
async function query(sql, params = []) {
  const p = await getPool();
  return p.execute(sql, params);
}

module.exports = { query };
