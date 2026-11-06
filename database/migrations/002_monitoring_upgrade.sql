-- 002_monitoring_upgrade: project-scoped websites, due-task scheduler columns, incident integrity, cron logs
-- BACK UP YOUR DATABASE FIRST (phpMyAdmin > Export). MySQL DDL is not transactional, so a failure part-way needs a restore.
-- Requires 001_foundation. Existing data is preserved: every current website is moved into a "Default Project".

-- 1. Close duplicate OPEN incidents for the same site (keep the newest) so the one-open-incident-per-site rule can be enforced.
UPDATE incidents i
  JOIN (SELECT site_id, MAX(id) AS keep_id FROM incidents WHERE resolved_at IS NULL GROUP BY site_id) k ON k.site_id = i.site_id
  SET i.resolved_at = i.started_at
  WHERE i.resolved_at IS NULL AND i.id <> k.keep_id;

-- 2. Default project for the websites that already exist.
INSERT INTO projects (name, slug, description, status)
  SELECT 'Default Project', 'default', 'Websites migrated from the original SiteWatch installation.', 'active' FROM DUAL
  WHERE EXISTS (SELECT 1 FROM monitored_sites) AND NOT EXISTS (SELECT 1 FROM projects WHERE slug = 'default');
INSERT IGNORE INTO project_settings (project_id) SELECT id FROM projects;

-- 3. monitored_sites: new columns. NULL in a setting column means "inherit the project default".
ALTER TABLE monitored_sites
  ADD COLUMN project_id BIGINT UNSIGNED NULL AFTER id,
  ADD COLUMN url_hash CHAR(64) NULL AFTER url,
  ADD COLUMN retry_count TINYINT UNSIGNED NULL,
  ADD COLUMN retry_delay_ms INT NULL,
  ADD COLUMN http_method ENUM('GET','HEAD') NULL,
  ADD COLUMN expected_status VARCHAR(100) NULL,
  ADD COLUMN alert_on_down TINYINT(1) NULL,
  ADD COLUMN alert_on_recovery TINYINT(1) NULL,
  ADD COLUMN maintenance_start DATETIME(3) NULL,
  ADD COLUMN maintenance_end DATETIME(3) NULL,
  ADD COLUMN next_run_at DATETIME(3) NULL,
  ADD COLUMN last_run_at DATETIME(3) NULL,
  ADD COLUMN claim_token CHAR(32) NULL,
  ADD COLUMN claimed_at DATETIME(3) NULL,
  ADD COLUMN last_is_up TINYINT(1) NULL,
  ADD COLUMN last_status_code SMALLINT NULL,
  ADD COLUMN last_response_ms INT NULL,
  ADD COLUMN last_checked_at DATETIME(3) NULL,
  ADD COLUMN created_by BIGINT UNSIGNED NULL,
  ADD COLUMN updated_by BIGINT UNSIGNED NULL,
  ADD COLUMN deleted_at DATETIME(3) NULL,
  MODIFY interval_minutes INT NULL DEFAULT NULL,
  MODIFY timeout_ms INT NULL DEFAULT NULL;

-- 4. Backfill. updated_at = updated_at stops the ON UPDATE trigger from rewriting timestamps.
UPDATE monitored_sites SET
  project_id = (SELECT id FROM projects WHERE slug = 'default'),
  url_hash = SHA2(url, 256),
  interval_minutes = IF(interval_minutes = 5, NULL, interval_minutes),
  next_run_at = UTC_TIMESTAMP(3),
  updated_at = updated_at;

UPDATE monitored_sites s
  JOIN (SELECT site_id, MAX(id) AS mid FROM check_results GROUP BY site_id) m ON m.site_id = s.id
  JOIN check_results r ON r.id = m.mid
  SET s.last_is_up = r.is_up, s.last_status_code = r.status_code, s.last_response_ms = r.response_ms,
      s.last_checked_at = r.checked_at, s.last_run_at = r.checked_at, s.updated_at = s.updated_at;

-- 5. Constraints. The old global UNIQUE(url(255)) is replaced by per-project uniqueness on the full-URL hash,
--    Soft-deleting a site rewrites its url_hash (done by the app), so a deleted URL can be added again later.
ALTER TABLE monitored_sites
  MODIFY project_id BIGINT UNSIGNED NOT NULL,
  MODIFY url_hash CHAR(64) NOT NULL,
  DROP INDEX uq_monitored_sites_url;
ALTER TABLE monitored_sites
  ADD UNIQUE KEY uq_sites_project_url (project_id, url_hash),
  ADD KEY idx_sites_due (is_active, deleted_at, next_run_at),
  ADD KEY idx_sites_project (project_id, deleted_at),
  ADD CONSTRAINT fk_sites_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_sites_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_sites_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL;

-- 6. incidents: project link, failure tracking, and a hard guarantee of ONE open incident per site.
ALTER TABLE incidents
  ADD COLUMN project_id BIGINT UNSIGNED NULL AFTER id,
  ADD COLUMN last_failure_at DATETIME(3) NULL,
  ADD COLUMN failure_count INT UNSIGNED NOT NULL DEFAULT 1;
UPDATE incidents i JOIN monitored_sites s ON s.id = i.site_id SET i.project_id = s.project_id, i.last_failure_at = i.started_at;
ALTER TABLE incidents MODIFY project_id BIGINT UNSIGNED NOT NULL;
ALTER TABLE incidents
  ADD COLUMN open_key BIGINT UNSIGNED GENERATED ALWAYS AS (IF(resolved_at IS NULL, site_id, NULL)) STORED,
  ADD UNIQUE KEY uq_incidents_one_open (open_key),
  ADD KEY idx_incidents_project (project_id, started_at),
  ADD CONSTRAINT fk_incident_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT;

-- 7. check_results: retry information + incident association.
ALTER TABLE check_results
  ADD COLUMN attempts TINYINT UNSIGNED NOT NULL DEFAULT 1,
  ADD COLUMN incident_id BIGINT UNSIGNED NULL,
  ADD KEY idx_results_incident (incident_id),
  ADD CONSTRAINT fk_check_incident FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE SET NULL;

-- 8. New tables.
CREATE TABLE IF NOT EXISTS incident_notifications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  incident_id BIGINT UNSIGNED NOT NULL,
  type ENUM('down','recovery') NOT NULL,
  recipients VARCHAR(1000) NULL,
  status ENUM('sent','failed','skipped') NOT NULL,
  error VARCHAR(500) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_notif_incident (incident_id),
  CONSTRAINT fk_notif_incident FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cron_execution_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  triggered_by VARCHAR(40) NOT NULL DEFAULT 'cron',
  started_at DATETIME(3) NOT NULL,
  finished_at DATETIME(3) NULL,
  duration_ms INT NULL,
  due_count INT NOT NULL DEFAULT 0,
  checked INT NOT NULL DEFAULT 0,
  up_count INT NOT NULL DEFAULT 0,
  down_count INT NOT NULL DEFAULT 0,
  maintenance_skipped INT NOT NULL DEFAULT 0,
  released INT NOT NULL DEFAULT 0,
  error VARCHAR(500) NULL,
  KEY idx_cronlog_started (started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO schema_migrations (version) VALUES ('002_monitoring_upgrade');
