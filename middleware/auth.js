'use strict';

/**
 * Middleware: require an active Administrator session.
 * Redirects to /login if not authenticated.
 */
function requireAuth(req, res, next) {
  if (req.session && req.session.userId && req.session.role === 'Administrator') {
    return next();
  }
  req.session.returnTo = req.originalUrl;
  res.redirect('/login');
}

function requireApiAuth(req, res, next) {
  if (req.session && req.session.userId && req.session.role === 'Administrator') return next();
  return res.status(401).json({ error: 'Administrator authentication required.' });
}

/**
 * Middleware: require the X-API-Key header for webhook endpoints.
 */
function requireApiKey(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!key || key !== process.env.WEBHOOK_API_KEY) {
    return res.status(401).json({ error: 'Invalid or missing X-API-Key header.' });
  }
  next();
}

module.exports = { requireAuth, requireApiAuth, requireApiKey };
