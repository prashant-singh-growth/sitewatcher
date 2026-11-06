-- 003_speedtest: Google PageSpeed Insights audits (history is append-only) and custom audit schedules.
-- Requires 001 and 002. Only creates new tables.

CREATE TABLE IF NOT EXISTS pagespeed_audits (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  project_id BIGINT UNSIGNED NOT NULL,
  site_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NULL,
  schedule_id BIGINT UNSIGNED NULL,
  device ENUM('mobile','desktop') NOT NULL,
  triggered_by ENUM('manual','schedule') NOT NULL DEFAULT 'manual',
  status ENUM('success','failed') NOT NULL,
  error_message VARCHAR(500) NULL,
  tested_url VARCHAR(2048) NOT NULL,
  performance_score TINYINT UNSIGNED NULL,
  accessibility_score TINYINT UNSIGNED NULL,
  best_practices_score TINYINT UNSIGNED NULL,
  seo_score TINYINT UNSIGNED NULL,
  fcp_ms INT NULL,
  lcp_ms INT NULL,
  cls DECIMAL(8,4) NULL,
  tbt_ms INT NULL,
  speed_index_ms INT NULL,
  ttfb_ms INT NULL,
  inp_ms INT NULL,
  field_data JSON NULL,
  details JSON NULL,
  lighthouse_version VARCHAR(40) NULL,
  audited_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_psa_site_device (site_id, device, audited_at),
  KEY idx_psa_project (project_id, audited_at),
  CONSTRAINT fk_psa_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT,
  CONSTRAINT fk_psa_site FOREIGN KEY (site_id) REFERENCES monitored_sites(id) ON DELETE CASCADE,
  CONSTRAINT fk_psa_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- kind: once (one run at start_at), recurring (every every_days), custom (runs at start_at + each offset in offsets_days).
CREATE TABLE IF NOT EXISTS speed_test_schedules (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  project_id BIGINT UNSIGNED NOT NULL,
  site_id BIGINT UNSIGNED NOT NULL,
  created_by BIGINT UNSIGNED NULL,
  device ENUM('mobile','desktop','both') NOT NULL DEFAULT 'mobile',
  kind ENUM('once','recurring','custom') NOT NULL,
  start_at DATETIME(3) NOT NULL,
  every_days SMALLINT UNSIGNED NULL,
  offsets_days JSON NULL,
  step_index INT UNSIGNED NOT NULL DEFAULT 0,
  next_run_at DATETIME(3) NULL,
  last_run_at DATETIME(3) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  claim_token CHAR(32) NULL,
  claimed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_sts_due (is_active, next_run_at),
  KEY idx_sts_site (site_id),
  KEY idx_sts_project (project_id),
  CONSTRAINT fk_sts_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT,
  CONSTRAINT fk_sts_site FOREIGN KEY (site_id) REFERENCES monitored_sites(id) ON DELETE CASCADE,
  CONSTRAINT fk_sts_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO schema_migrations (version) VALUES ('003_speedtest');
