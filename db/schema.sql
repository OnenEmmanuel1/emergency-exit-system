-- ============================================================
-- SEEX — Smart Emergency Exit System
-- Database Schema v1.0
-- ============================================================

SET FOREIGN_KEY_CHECKS = 0;

-- ── users ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  userId        INT          NOT NULL AUTO_INCREMENT,
  fullName      VARCHAR(100) NOT NULL,
  email         VARCHAR(100) NOT NULL,
  phone         VARCHAR(20)  NULL,
  passwordHash  VARCHAR(255) NOT NULL,
  role          ENUM('Administrator') NOT NULL DEFAULT 'Administrator',
  createdAt     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (userId),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── zones ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS zones (
  zoneId            INT          NOT NULL AUTO_INCREMENT,
  name              VARCHAR(100) NOT NULL,
  isExit            BOOLEAN      NOT NULL DEFAULT FALSE,
  capacityThreshold INT          NOT NULL COMMENT 'Person-count above which congestion cost rises sharply',
  areaM2            DECIMAL(8,2) NOT NULL DEFAULT 50.00 COMMENT 'Floor area in m² used to compute density (people/m²)',
  createdAt         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (zoneId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── edges ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS edges (
  edgeId          INT            NOT NULL AUTO_INCREMENT,
  fromZoneId      INT            NOT NULL,
  toZoneId        INT            NOT NULL,
  distanceMeters  DECIMAL(6,2)   NOT NULL,
  PRIMARY KEY (edgeId),
  CONSTRAINT fk_edge_from FOREIGN KEY (fromZoneId) REFERENCES zones(zoneId) ON DELETE CASCADE,
  CONSTRAINT fk_edge_to   FOREIGN KEY (toZoneId)   REFERENCES zones(zoneId) ON DELETE CASCADE,
  INDEX idx_edge_from (fromZoneId),
  INDEX idx_edge_to   (toZoneId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── density_readings ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS density_readings (
  readingId   INT      NOT NULL AUTO_INCREMENT,
  zoneId      INT      NOT NULL,
  personCount INT      NOT NULL,
  source      ENUM('Webcam','Simulated','Manual') NOT NULL,
  recordedAt  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (readingId),
  CONSTRAINT fk_dr_zone FOREIGN KEY (zoneId) REFERENCES zones(zoneId) ON DELETE CASCADE,
  INDEX idx_dr_zone_time (zoneId, recordedAt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── hazard_events ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hazard_events (
  hazardId    INT      NOT NULL AUTO_INCREMENT,
  zoneId      INT      NOT NULL,
  type        ENUM('Fire','Smoke','StructuralDamage','Security') NOT NULL,
  status      ENUM('Active','Cleared') NOT NULL DEFAULT 'Active',
  declaredBy  INT      NULL COMMENT 'FK to users; NULL if declared via webhook or simulator',
  declaredAt  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  clearedAt   DATETIME NULL,
  PRIMARY KEY (hazardId),
  CONSTRAINT fk_haz_zone FOREIGN KEY (zoneId)      REFERENCES zones(zoneId) ON DELETE CASCADE,
  CONSTRAINT fk_haz_user FOREIGN KEY (declaredBy)  REFERENCES users(userId) ON DELETE SET NULL,
  INDEX idx_haz_status (status),
  INDEX idx_haz_zone   (zoneId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── evacuation_recommendations ───────────────────────────────
CREATE TABLE IF NOT EXISTS evacuation_recommendations (
  recommendationId    INT            NOT NULL AUTO_INCREMENT,
  fromZoneId          INT            NOT NULL,
  recommendedExitZoneId INT          NOT NULL,
  pathJson            TEXT           NOT NULL COMMENT 'Ordered list of zone IDs (JSON array)',
  totalCost           DECIMAL(10,2)  NOT NULL,
  computedAt          DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (recommendationId),
  CONSTRAINT fk_rec_from FOREIGN KEY (fromZoneId)           REFERENCES zones(zoneId) ON DELETE CASCADE,
  CONSTRAINT fk_rec_exit FOREIGN KEY (recommendedExitZoneId) REFERENCES zones(zoneId) ON DELETE CASCADE,
  INDEX idx_rec_from (fromZoneId),
  INDEX idx_rec_exit (recommendedExitZoneId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── signage_states ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS signage_states (
  zoneId                    INT      NOT NULL,
  recommendedDirectionZoneId INT     NULL COMMENT 'Next hop zone ID toward exit; NULL if this zone is itself an exit',
  urgency                   ENUM('Normal','Elevated','Critical') NOT NULL DEFAULT 'Normal',
  updatedAt                 DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (zoneId),
  CONSTRAINT fk_ss_zone FOREIGN KEY (zoneId)                     REFERENCES zones(zoneId) ON DELETE CASCADE,
  CONSTRAINT fk_ss_dir  FOREIGN KEY (recommendedDirectionZoneId) REFERENCES zones(zoneId) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── alerts ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alerts (
  alertId   INT          NOT NULL AUTO_INCREMENT,
  hazardId  INT          NULL,
  userId    INT          NOT NULL,
  channel   ENUM('Email','SMS') NOT NULL,
  message   VARCHAR(500) NOT NULL,
  status    ENUM('Sent','Failed','Simulated') NOT NULL,
  sentAt    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (alertId),
  CONSTRAINT fk_alert_hazard FOREIGN KEY (hazardId) REFERENCES hazard_events(hazardId) ON DELETE SET NULL,
  CONSTRAINT fk_alert_user   FOREIGN KEY (userId)   REFERENCES users(userId) ON DELETE CASCADE,
  INDEX idx_alert_hazard (hazardId),
  INDEX idx_alert_user   (userId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET FOREIGN_KEY_CHECKS = 1;
