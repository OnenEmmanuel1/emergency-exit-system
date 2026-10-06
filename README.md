# SEEX — Smart Emergency Exit System Using Crowd Movement Analytics

> ⚠️ **IMPORTANT DISCLAIMER — READ BEFORE USE**
>
> SEEX is an **academic software prototype** demonstrating dynamic, congestion-aware evacuation guidance. It is **NOT** a substitute for code-compliant physical exit signage (NFPA 101/ISO 23601), fire-alarm systems, or certified building life-safety equipment. It has **not** been validated in a real emergency. This system should never be treated as more authoritative than clearly labelled certified safety equipment. Refer to your building's official evacuation plan and installed fire-alarm systems for all actual safety guidance.

---

## What SEEX Is

SEEX is a full-stack web application prototype for a School Final-Year Project on crowd-movement-aware evacuation routing. It models a building as a graph of zones and pathways, computes congestion-weighted evacuation routes using **Dijkstra's algorithm**, and updates every connected display in real time via **Socket.IO** when density or hazard conditions change.

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js + Express.js |
| Views | EJS templates with partials |
| Styling | Flat vanilla CSS + Bootstrap 5 via CDN |
| Database | MySQL 8.0 via mysql2 (parameterised queries throughout) |
| Routing engine | Real Dijkstra's algorithm (`services/routingEngine.js`) |
| Density engine | Congestion cost formula (`services/densityEngine.js`) |
| Real-time | Socket.IO |
| Auth | express-session + bcrypt |
| Email alerts | Nodemailer (SMTP) |
| SMS alerts | Twilio (`SMS_MODE=simulate\|live`) |
| CV (webcam) | TensorFlow.js + COCO-SSD (browser-side, camera page only) |
| Simulation | node-cron bounded random-walk simulator |
| Infra | Docker Compose |

## Scope Decisions (Honest — Not Hidden)

### 1. Crowd Density Input: Two Real Code Paths

The system implements two **genuine** input mechanisms, not one real and one fake:

1. **Webcam (TensorFlow.js / COCO-SSD)** — The `/density/camera` page loads a pretrained neural-network object-detection model directly in your browser and runs inference against a webcam feed every 2 seconds. Each detected "person" above the confidence threshold is counted and POSTed to `POST /api/density/webcam`, writing a real `density_readings` row (`source='Webcam'`).

   **Genuine limitations:** Requires a physical camera. Works best with good lighting and unobstructed sightlines. The COCO-SSD model is a general-purpose detector — not crowd-optimised. Results will vary with camera angle and room conditions. This is real computer vision running in the browser — not a simulation — but not a substitute for dedicated CCTV infrastructure.

2. **Simulated / Manual** — A `node-cron` job runs every 60 seconds, generating readings using a bounded random-walk (±3 people, clamped to 150% of zone capacity). Admins can also set any zone's count manually via `/density`. Both write `density_readings` rows (`source='Simulated'` or `source='Manual'`). The simulator pauses for a zone while a manual or webcam reading is less than five minutes old, then resumes with an explicit `Simulated` source if updates stop.

### 2. IoT Hazard Sensors → Manual + Webhook

No physical smoke/temperature/motion sensors exist in this build. An Admin declares a hazard manually at `/hazards`. The system also exposes a **complete, real webhook endpoint** (`POST /api/hazards/report`) that a physical sensor controller could call in a future hardware deployment:

```
POST /api/hazards/report
Headers: X-API-Key: <WEBHOOK_API_KEY>
Body: { "zoneId": 3, "type": "Smoke" }
```

### 3. LED Signage → Virtual Signage State

No physical LED signs are controlled. The system computes and stores a `signage_state` per zone (recommended direction + urgency) and renders it on the **Exit-Status Display** page (`/display/:zoneId`) — a full-screen, high-contrast board suitable for wall mounting. A physical sign controller can poll `GET /api/signage/:zoneId/state` for the current computed state.

---

## Quick Start (Local — without Docker)

### Prerequisites
- Node.js 18+
- MySQL 8.0 running locally

### 1. Clone and install

```bash
cd "smart emergency exit system"
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env — set DB credentials, SMTP, Twilio, webhook API key
```

### 3. Create the database

```sql
  Create the database and application user in MySQL using the `DB_NAME` and `DB_USER` values from `.env`, then grant that user access to that database. Passwordless application users connect with an empty password; when `DB_USER=root`, the app uses `MYSQL_ROOT_PASSWORD`.
```

Then import the schema (for a database that was created before alert simulation statuses were added, apply `db/migrations/001-alert-simulated-status.sql` once):

```bash
mysql -u seex_user -p seex_db < db/schema.sql
```

### 4. Seed sample data

```bash
npm run seed
```

This creates:
- **Admin user:** `admin@seex.local` / `password123`
- A 6-zone building graph (Lobby, Corridor A, Office Block, Stairwell, Exit North, Exit South)
- 48 hours of simulated density readings

### 5. Run the app

```bash
npm run dev   # development (nodemon)
# or
npm start     # production
```

Open: **http://localhost:3000**

---

## Quick Start (Docker Compose)

```bash
cp .env.example .env
# Edit .env as needed

docker-compose up --build
```

Wait for the MySQL healthcheck to pass, then:

```bash
docker-compose exec app npm run seed
```

Open: **http://localhost:3000**

> **UI initialization:** `ui-ux-pro-max-cli` was installed and `uipro init --ai antigravity` completed. The EJS pages use the project's flat `seex-` CSS system with Bootstrap 5 via CDN for shared layout utilities; Bootstrap is also the documented fallback if the initializer is unavailable in another environment.

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | HTTP port (default: 3000) |
| `DB_HOST` | Yes | MySQL host |
| `DB_PORT` | No | MySQL port (default: 3306) |
| `DB_USER` | Yes | MySQL user |
| `DB_NAME` | Yes | MySQL database name |
| `MYSQL_ROOT_PASSWORD` | Docker | MySQL root password used only to initialize the Compose database service |
| `SESSION_SECRET` | Yes | Express session secret (min 32 chars random string) |
| `WEBHOOK_API_KEY` | Yes | Shared API key for `X-API-Key` header on `POST /api/hazards/report` |
| `SMTP_HOST` | Yes | SMTP server hostname |
| `SMTP_PORT` | Yes | SMTP port (587 for TLS) |
| `SMTP_SECURE` | No | `true` for SSL (port 465) |
| `SMTP_USER` | Yes | SMTP username/email |
| `SMTP_PASS` | Yes | SMTP password / app password |
| `ALERT_FROM` | Yes | From-address for outbound alerts |
| `ADMIN_EMAIL` | Yes | Administrator email address |
| `SMS_MODE` | Yes | `simulate` (console log) or `live` (real Twilio send) |
| `TWILIO_ACCOUNT_SID` | If `live` | Twilio Account SID |
| `TWILIO_AUTH_TOKEN` | If `live` | Twilio Auth Token |
| `TWILIO_FROM_NUMBER` | If `live` | Twilio phone number |
| `ADMIN_PHONE` | If `live` | Admin mobile number for SMS |
| `DENSITY_ALERT_MINUTES` | No | Minutes a zone must exceed threshold before alert fires (default: 5) |

In `simulate` mode SMS messages are written to the application log and the alert history records `Simulated`, not `Sent`. Live SMS requires a valid Twilio configuration and `ADMIN_PHONE`; the seed script copies that number to the Administrator record. Email and SMS attempts, including missing-recipient or delivery failures, are recorded in the alert history.

---

## API Reference

### Hazard Webhook (for IoT sensor integration)

```
POST /api/hazards/report
Headers:
  X-API-Key: <WEBHOOK_API_KEY>
  Content-Type: application/json
Body: { "zoneId": <int>, "type": "Fire"|"Smoke"|"StructuralDamage"|"Security" }
Response 201: { "hazardId": ..., "zoneId": ..., "type": ..., "status": "Active" }
```

### Signage Polling (for physical sign controllers)

```
GET /api/signage/:zoneId/state
Response: { zoneId, zoneName, recommendedDirectionZoneId, recommendedDirectionName, urgency, updatedAt }

GET /api/signage/all
Response: Array of all zones' current signage states
```

### Density (Webcam client → server)

```
POST /api/density/webcam
Body: { "zoneId": <int>, "personCount": <int> }
Response 201: { ok, zoneId, personCount, source: "Webcam" }

GET /api/density/current
Response: Current person count and density info per zone
```

---

## Project Structure

```
├── app.js                    # Express app + Socket.IO + route mounting
├── db/
│   ├── db.js                 # MySQL connection pool
│   ├── schema.sql            # Full database schema
│   └── seed.js               # Seed script
├── middleware/
│   └── auth.js               # requireAuth + requireApiKey
├── routes/
│   ├── auth.js               # Login/logout
│   ├── dashboard.js          # Admin dashboard
│   ├── zones.js              # Building graph CRUD
│   ├── hazards.js            # Hazard declare/clear
│   ├── density.js            # Manual + webcam launcher
│   ├── reports.js            # Historical reports
│   ├── display.js            # Public exit-status display
│   └── api/
│       ├── hazards.js        # POST /api/hazards/report (webhook)
│       ├── signage.js        # GET /api/signage/:zoneId/state
│       └── density.js        # POST /api/density/webcam
├── services/
│   ├── routingEngine.js      # Real Dijkstra's algorithm
│   ├── densityEngine.js      # congestionCost = 1 + (count/threshold)
│   ├── alertService.js       # Nodemailer + Twilio
│   └── simulator.js          # node-cron bounded random-walk
├── views/
│   ├── partials/             # sidebar.ejs, layout.ejs
│   ├── auth/login.ejs
│   ├── dashboard/index.ejs
│   ├── zones/index.ejs
│   ├── hazards/index.ejs
│   ├── density/index.ejs + camera.ejs
│   ├── reports/index.ejs
│   ├── display/index.ejs + zone.ejs
│   └── error.ejs
└── public/
    ├── css/tokens.css + main.css + display.css
    └── js/webcam.js + dashboard.js
```

---

## Seeded Credentials

| Role | Email | Password |
|------|-------|----------|
| Administrator | `admin@seex.local` | `password123` |

Change the password immediately in any non-local deployment.

---

## Routing Algorithm

SEEX implements a genuine **Dijkstra's shortest-path** algorithm (`services/routingEngine.js`) with a MinHeap priority queue. Edge weights are:

```
weight(edge) = edge.distanceMeters × congestionCost(destination zone)
congestionCost(zone) = 1 + (latestPersonCount / zone.capacityThreshold)
```

**Hazard exclusion:** Before running Dijkstra, any zone with an active hazard is removed from the adjacency list entirely. No computed path will pass through a hazard zone.

---

*SEEX v1.0 — School Final-Year Project — Academic Software Prototype*
*NOT a certified life-safety system. NOT validated for real emergency use.*
