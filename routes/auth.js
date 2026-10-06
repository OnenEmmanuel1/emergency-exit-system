'use strict';
const express = require('express');
const bcrypt  = require('bcrypt');
const { query } = require('../db/db');
const router  = express.Router();

// GET /login
router.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/dashboard');
  res.render('auth/login', { title: 'Sign In — SEEX', error: null, user: null });
});

// POST /login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.render('auth/login', {
      title: 'Sign In — SEEX',
      error: 'Email and password are required.',
      user:  null,
    });
  }
  try {
    const [rows] = await query(
      'SELECT userId, fullName, passwordHash, role FROM users WHERE email = ?',
      [email.trim().toLowerCase()]
    );
    if (!rows.length) {
      return res.render('auth/login', {
        title: 'Sign In — SEEX',
        error: 'Invalid credentials.',
        user:  null,
      });
    }
    const dbUser = rows[0];
    const match  = await bcrypt.compare(password, dbUser.passwordHash);
    if (!match) {
      return res.render('auth/login', {
        title: 'Sign In — SEEX',
        error: 'Invalid credentials.',
        user:  null,
      });
    }
    req.session.userId   = dbUser.userId;
    req.session.fullName = dbUser.fullName;
    req.session.role     = dbUser.role;

    const returnTo = req.session.returnTo || '/dashboard';
    delete req.session.returnTo;
    res.redirect(returnTo);
  } catch (err) {
    console.error('[Auth]', err);
    res.render('auth/login', {
      title: 'Sign In — SEEX',
      error: 'An error occurred. Please try again.',
      user:  null,
    });
  }
});

// GET / → redirect to dashboard or login
router.get('/', (req, res) => {
  if (req.session.userId) return res.redirect('/dashboard');
  res.redirect('/login');
});

// POST /logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
