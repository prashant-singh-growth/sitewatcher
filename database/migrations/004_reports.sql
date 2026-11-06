-- 004_reports: report history and scheduled email reports. PDFs are regenerated on demand from the stored parameters
-- (no files stored on disk), so access is always checked against current project membership.

CREATE TABLE IF NOT EXISTS reports (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  project_id BIGINT UNSIGNED NOT NULL,
  site_id BIGINT UNSIGNED NULL,
  created_by BIGINT UNSIGNED NULL,
  schedule_id BIGINT UNSIGNED NULL,
  title VARCHAR(200) NOT NULL,
  period_from DATETIME(3) NOT NULL,
  period_to DATETIME(3) NOT NULL,
  sections JSON NOT NULL,
  timezone VARCHAR(64) NOT NULL DEFAULT 'UTC',
  emailed_to VARCHAR(1000) NULL,
  emailed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_reports_project (project_id, created_at),
  CONSTRAINT fk_reports_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT,
  CONSTRAINT fk_reports_site FOREIGN KEY (site_id) REFERENCES monitored_sites(id) ON DELETE SET NULL,
  CONSTRAINT fk_reports_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS report_schedules (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  project_id BIGINT UNSIGNED NOT NULL,
  site_id BIGINT UNSIGNED NULL,
  created_by BIGINT UNSIGNED NULL,
  name VARCHAR(160) NOT NULL,
  frequency ENUM('daily','weekly','monthly','custom') NOT NULL,
  every_days SMALLINT UNSIGNED NULL,
  period_days SMALLINT UNSIGNED NOT NULL DEFAULT 7,
  sections JSON NOT NULL,
  recipients VARCHAR(1000) NOT NULL,
  subject VARCHAR(200) NULL,
  message TEXT NULL,
  timezone VARCHAR(64) NOT NULL DEFAULT 'UTC',
  next_run_at DATETIME(3) NOT NULL,
  last_run_at DATETIME(3) NULL,
  last_error VARCHAR(500) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  claim_token CHAR(32) NULL,
  claimed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_rs_due (is_active, next_run_at),
  KEY idx_rs_project (project_id),
  CONSTRAINT fk_rs_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT,
  CONSTRAINT fk_rs_site FOREIGN KEY (site_id) REFERENCES monitored_sites(id) ON DELETE CASCADE,
  CONSTRAINT fk_rs_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO schema_migrations (version) VALUES ('004_reports');
