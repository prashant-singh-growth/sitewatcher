-- 006_robots_monitoring: Robots.txt discovery, RFC 9309 rules parsing, crawlability tracking, snapshots, and issue detection.
-- Requires 001 and 002. Only creates new tables and seeds permissions.

CREATE TABLE IF NOT EXISTS robots_monitors (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  project_id BIGINT UNSIGNED NOT NULL,
  site_id BIGINT UNSIGNED NOT NULL,
  url VARCHAR(2048) NOT NULL,
  url_hash CHAR(64) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  check_interval_hours INT UNSIGNED NOT NULL DEFAULT 24,
  last_status ENUM('operational', 'failed', 'missing_404', 'server_error_5xx', 'pending') NOT NULL DEFAULT 'pending',
  last_status_code SMALLINT NULL,
  last_error VARCHAR(500) NULL,
  content_hash CHAR(64) NULL,
  total_rules_count INT UNSIGNED NOT NULL DEFAULT 0,
  total_monitored_urls INT UNSIGNED NOT NULL DEFAULT 0,
  crawlable_urls_count INT UNSIGNED NOT NULL DEFAULT 0,
  blocked_urls_count INT UNSIGNED NOT NULL DEFAULT 0,
  last_checked_at DATETIME(3) NULL,
  last_changed_at DATETIME(3) NULL,
  claim_token CHAR(32) NULL,
  claimed_at DATETIME(3) NULL,
  next_run_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_robots_site (site_id),
  KEY idx_robots_due (is_active, next_run_at),
  KEY idx_robots_project (project_id),
  CONSTRAINT fk_robots_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT,
  CONSTRAINT fk_robots_site FOREIGN KEY (site_id) REFERENCES monitored_sites(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS robots_snapshots (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  project_id BIGINT UNSIGNED NOT NULL,
  site_id BIGINT UNSIGNED NOT NULL,
  status_code SMALLINT NULL,
  content MEDIUMTEXT NULL,
  content_hash CHAR(64) NOT NULL,
  is_changed TINYINT(1) NOT NULL DEFAULT 0,
  error_message VARCHAR(500) NULL,
  rules_count INT UNSIGNED NOT NULL DEFAULT 0,
  sitemaps_declared_count INT UNSIGNED NOT NULL DEFAULT 0,
  fetched_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_robots_snapshots_site (site_id, fetched_at),
  KEY idx_robots_snapshots_project (project_id, fetched_at),
  CONSTRAINT fk_rsnap_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT,
  CONSTRAINT fk_rsnap_site FOREIGN KEY (site_id) REFERENCES monitored_sites(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS robots_rules (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  site_id BIGINT UNSIGNED NOT NULL,
  snapshot_id BIGINT UNSIGNED NOT NULL,
  user_agent VARCHAR(100) NOT NULL DEFAULT '*',
  directive ENUM('allow', 'disallow', 'crawl_delay', 'sitemap') NOT NULL,
  value VARCHAR(2048) NOT NULL,
  affected_urls_count INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_robots_rules_site (site_id, user_agent),
  KEY idx_robots_rules_snap (snapshot_id),
  CONSTRAINT fk_rrules_site FOREIGN KEY (site_id) REFERENCES monitored_sites(id) ON DELETE CASCADE,
  CONSTRAINT fk_rrules_snap FOREIGN KEY (snapshot_id) REFERENCES robots_snapshots(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS robots_url_evaluations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  project_id BIGINT UNSIGNED NOT NULL,
  site_id BIGINT UNSIGNED NOT NULL,
  url VARCHAR(2048) NOT NULL,
  url_hash CHAR(64) NOT NULL,
  user_agent VARCHAR(100) NOT NULL DEFAULT 'Googlebot',
  status ENUM('allowed', 'blocked') NOT NULL DEFAULT 'allowed',
  previous_status ENUM('allowed', 'blocked') NULL,
  matched_rule VARCHAR(2048) NULL,
  matched_user_agent VARCHAR(100) NULL,
  status_changed_at DATETIME(3) NULL,
  first_evaluated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_evaluated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_robots_eval_site_url_ua (site_id, url_hash, user_agent),
  KEY idx_robots_eval_site_status (site_id, user_agent, status),
  KEY idx_robots_eval_project (project_id),
  CONSTRAINT fk_reval_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT,
  CONSTRAINT fk_reval_site FOREIGN KEY (site_id) REFERENCES monitored_sites(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS robots_issues (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  project_id BIGINT UNSIGNED NOT NULL,
  site_id BIGINT UNSIGNED NOT NULL,
  issue_type VARCHAR(64) NOT NULL,
  severity ENUM('critical', 'warning', 'info') NOT NULL DEFAULT 'warning',
  title VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  rule_responsible VARCHAR(2048) NULL,
  affected_urls_count INT UNSIGNED NOT NULL DEFAULT 0,
  details JSON NULL,
  first_detected_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_detected_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  resolved_at DATETIME(3) NULL,
  occurrence_count INT UNSIGNED NOT NULL DEFAULT 1,
  open_key VARCHAR(120) GENERATED ALWAYS AS (IF(resolved_at IS NULL, CONCAT(site_id, ':', issue_type), NULL)) STORED,
  UNIQUE KEY uq_robots_issue_open (open_key),
  KEY idx_robots_issues_site (site_id, resolved_at),
  KEY idx_robots_issues_project (project_id, resolved_at),
  CONSTRAINT fk_rissues_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT,
  CONSTRAINT fk_rissues_site FOREIGN KEY (site_id) REFERENCES monitored_sites(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO permissions (code) VALUES ('robots.view'), ('robots.manage');
INSERT IGNORE INTO role_permissions (role, permission_code) VALUES
  ('super_admin', 'robots.view'), ('super_admin', 'robots.manage'),
  ('manager', 'robots.view'), ('manager', 'robots.manage'),
  ('member', 'robots.view');

INSERT IGNORE INTO schema_migrations (version) VALUES ('006_robots_monitoring');
