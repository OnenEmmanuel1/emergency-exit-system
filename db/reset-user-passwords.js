'use strict';

require('dotenv').config();
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');

async function resetUserPasswords() {
  const required = ['DB_USER', 'DB_NAME'];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(`Missing required database environment variables: ${missing.join(', ')}`);
  }

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number.parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD !== undefined ? process.env.DB_PASSWORD : (process.env.DB_USER === 'root' ? (process.env.MYSQL_ROOT_PASSWORD || '') : (process.env.DB_PASS || '')),
    database: process.env.DB_NAME,
  });

  try {
    const passwordHash = await bcrypt.hash('password123', 12);
    const [result] = await connection.execute(
      'UPDATE users SET passwordHash = ?',
      [passwordHash]
    );
    console.log(`Updated passwords for ${result.affectedRows} user account(s).`);
  } finally {
    await connection.end();
  }
}

resetUserPasswords().catch((error) => {
  console.error('Could not reset user passwords:', error.message);
  process.exitCode = 1;
});
