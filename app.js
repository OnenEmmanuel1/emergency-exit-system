'use strict';
require('dotenv').config();
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  throw new Error('SESSION_SECRET must be set to at least 32 characters.');
}
if (!process.env.WEBHOOK_API_KEY) {
  throw new Error('WEBHOOK_API_KEY must be configured before the service starts.');
}

const express        = require('express');
const http           = require('http');
const { Server }     = require('socket.io');
const session        = require('express-session');
const path           = require('path');

const { recomputeRoutes } = require('./services/routingEngine');
const { startSimulator }  = require('./services/simulator');

// ── Routes ────────────────────────────────────────────────────
const authRoutes     = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const zonesRoutes    = require('./routes/zones');
const hazardsRoutes  = require('./routes/hazards');
const densityRoutes  = require('./routes/density');
const reportsRoutes  = require('./routes/reports');
const displayRoutes  = require('./routes/display');
const apiHazardRoutes = require('./routes/api/hazards');
const apiSignageRoutes = require('./routes/api/signage');
const apiDensityRoutes = require('./routes/api/density');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*' },
});

// ── View engine ───────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ── Static files ──────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── Body parsing ──────────────────────────────────────────────
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ── Sessions ──────────────────────────────────────────────────
app.use(session({
  secret:            process.env.SESSION_SECRET,
  resave:            false,
  saveUninitialized: false,
  cookie:            { secure: false, httpOnly: true, maxAge: 8 * 60 * 60 * 1000 },
}));

// ── Make io available to routes ───────────────────────────────
app.use((req, _res, next) => { req.io = io; next(); });

// ── Shared broadcast function ─────────────────────────────────
/**
 * Recomputes all evacuation routes and broadcasts signage updates
 * to all connected Socket.IO clients.  Called by the simulator,
 * hazard routes, and density routes.
 */
async function broadcastRouteUpdate() {
  const updates = await recomputeRoutes();
  io.emit('signage_update', updates);
  return updates;
}
app.locals.broadcastRouteUpdate = broadcastRouteUpdate;

// ── Page routes ───────────────────────────────────────────────
app.use('/',           authRoutes);
app.use('/dashboard',  dashboardRoutes);
app.use('/zones',      zonesRoutes);
app.use('/hazards',    hazardsRoutes);
app.use('/density',    densityRoutes);
app.use('/reports',    reportsRoutes);
app.use('/display',    displayRoutes);

// ── JSON API routes ───────────────────────────────────────────
app.use('/api/hazards',  apiHazardRoutes);
app.use('/api/signage',  apiSignageRoutes);
app.use('/api/density',  apiDensityRoutes);

// ── Socket.IO: join zone-specific rooms ───────────────────────
io.on('connection', (socket) => {
  socket.on('join_zone', (zoneId) => {
    socket.join(`zone_${zoneId}`);
  });
});

// ── 404 handler ───────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).render('error', {
    title:   'Page Not Found',
    message: 'The page you requested does not exist.',
    user:    null,
  });
});

// ── Error handler ─────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('[Unhandled Error]', err);
  res.status(500).render('error', {
    title:   'Internal Server Error',
    message: 'Something went wrong. Please try again.',
    user:    null,
  });
});

// ── Start ─────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '3000');
server.listen(PORT, async () => {
  console.log(`\n🚨 SEEX — Smart Emergency Exit System`);
  console.log(`   http://localhost:${PORT}`);
  console.log(`   ⚠  Academic prototype — NOT a certified life-safety system\n`);

  // Initial route computation on startup
  try {
    await broadcastRouteUpdate();
    console.log('[Routing] Initial route computation complete');
  } catch (err) {
    console.warn('[Routing] Initial computation skipped (DB may not be ready):', err.message);
  }

  // Start density simulator
  startSimulator(broadcastRouteUpdate);
});

module.exports = { app, io };
