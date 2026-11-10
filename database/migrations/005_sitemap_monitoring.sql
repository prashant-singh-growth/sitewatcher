-- 005_sitemap_monitoring: XML sitemap discovery, continuous monitoring, URL snapshots, diff tracking, and issue detection.
-- Requires 001 and 002. Only creates new tables and seeds permissions.

CREATE TABLE IF NOT EXISTS sitemaps (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  project_id BIGINT UNSIGNED NOT NULL,
  site_id BIGINT UNSIGNED NOT NULL,
  url VARCHAR(2048) NOT NULL,
  url_hash CHAR(64) NOT NULL,
  type ENUM('index', 'urlset', 'unknown') NOT NULL DEFAULT 'unknown',
  discovery_source ENUM('auto_default', 'robots_txt', 'sitemap_index', 'manual') NOT NULL DEFAULT 'manual',
  parent_sitemap_id BIGINT UNSIGNED NULL,
  parent_url VARCHAR(2048) NULL,
  check_interval_hours INT UNSIGNED NOT NULL DEFAULT 24,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  last_status ENUM('success', 'failed', 'incomplete', 'pending') NOT NULL DEFAULT 'pending',
  last_status_code SMALLINT NULL,
  last_error VARCHAR(500) NULL,
  last_url_count INT UNSIGNED NOT NULL DEFAULT 0,
  last_added_count INT UNSIGNED NOT NULL DEFAULT 0,
  last_removed_count INT UNSIGNED NOT NULL DEFAULT 0,
  last_duration_ms INT UNSIGNED NULL,
  last_scanned_at DATETIME(3) NULL,
  last_successful_scan_at DATETIME(3) NULL,
  next_run_at DATETIME(3) NULL,
  claim_token CHAR(32) NULL,
  claimed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_sitemaps_site_url (site_id, url_hash),
  KEY idx_sitemaps_due (is_active, next_run_at),
  KEY idx_sitemaps_site (site_id),
  KEY idx_sitemaps_project (project_id),
  KEY idx_sitemaps_parent (parent_sitemap_id),
  CONSTRAINT fk_sitemaps_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT,
  CONSTRAINT fk_sitemaps_site FOREIGN KEY (site_id) REFERENCES monitored_sites(id) ON DELETE CASCADE,
  CONSTRAINT fk_sitemaps_parent FOREIGN KEY (parent_sitemap_id) REFERENCES sitemaps(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sitemap_scans (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  project_id BIGINT UNSIGNED NOT NULL,
  site_id BIGINT UNSIGNED NOT NULL,
  sitemap_id BIGINT UNSIGNED NOT NULL,
  triggered_by ENUM('cron', 'manual', 'retry') NOT NULL DEFAULT 'cron',
  status ENUM('success', 'failed', 'incomplete') NOT NULL,
  status_code SMALLINT NULL,
  error_message VARCHAR(500) NULL,
  sitemap_type ENUM('index', 'urlset', 'unknown') NOT NULL DEFAULT 'unknown',
  total_urls INT UNSIGNED NOT NULL DEFAULT 0,
  added_urls_count INT UNSIGNED NOT NULL DEFAULT 0,
  removed_urls_count INT UNSIGNED NOT NULL DEFAULT 0,
  unchanged_urls_count INT UNSIGNED NOT NULL DEFAULT 0,
  child_sitemaps_count INT UNSIGNED NOT NULL DEFAULT 0,
  duration_ms INT UNSIGNED NOT NULL DEFAULT 0,
  scanned_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_scans_sitemap (sitemap_id, scanned_at),
  KEY idx_scans_site (site_id, scanned_at),
  KEY idx_scans_project (project_id, scanned_at),
  CONSTRAINT fk_scans_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT,
  CONSTRAINT fk_scans_site FOREIGN KEY (site_id) REFERENCES monitored_sites(id) ON DELETE CASCADE,
  CONSTRAINT fk_scans_sitemap FOREIGN KEY (sitemap_id) REFERENCES sitemaps(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sitemap_urls (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  project_id BIGINT UNSIGNED NOT NULL,
  site_id BIGINT UNSIGNED NOT NULL,
  sitemap_id BIGINT UNSIGNED NOT NULL,
  loc VARCHAR(2048) NOT NULL,
  loc_hash CHAR(64) NOT NULL,
  lastmod DATETIME(3) NULL,
  changefreq VARCHAR(20) NULL,
  priority DECIMAL(3,2) NULL,
  status ENUM('active', 'removed') NOT NULL DEFAULT 'active',
  first_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  removed_at DATETIME(3) NULL,
  first_scan_id BIGINT UNSIGNED NULL,
  last_scan_id BIGINT UNSIGNED NULL,
  UNIQUE KEY uq_sitemap_urls_map_loc (sitemap_id, loc_hash),
  KEY idx_sitemap_urls_site_status (site_id, status),
  KEY idx_sitemap_urls_sitemap_status (sitemap_id, status),
  CONSTRAINT fk_sm_urls_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT,
  CONSTRAINT fk_sm_urls_site FOREIGN KEY (site_id) REFERENCES monitored_sites(id) ON DELETE CASCADE,
  CONSTRAINT fk_sm_urls_sitemap FOREIGN KEY (sitemap_id) REFERENCES sitemaps(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sitemap_scan_changes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  scan_id BIGINT UNSIGNED NOT NULL,
  sitemap_id BIGINT UNSIGNED NOT NULL,
  site_id BIGINT UNSIGNED NOT NULL,
  change_type ENUM('added', 'removed') NOT NULL,
  loc VARCHAR(2048) NOT NULL,
  lastmod DATETIME(3) NULL,
  detected_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_sm_changes_scan (scan_id),
  KEY idx_sm_changes_sitemap (sitemap_id, detected_at),
  KEY idx_sm_changes_site (site_id, detected_at),
  CONSTRAINT fk_sm_changes_scan FOREIGN KEY (scan_id) REFERENCES sitemap_scans(id) ON DELETE CASCADE,
  CONSTRAINT fk_sm_changes_sitemap FOREIGN KEY (sitemap_id) REFERENCES sitemaps(id) ON DELETE CASCADE,
  CONSTRAINT fk_sm_changes_site FOREIGN KEY (site_id) REFERENCES monitored_sites(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sitemap_issues (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  project_id BIGINT UNSIGNED NOT NULL,
  site_id BIGINT UNSIGNED NOT NULL,
  sitemap_id BIGINT UNSIGNED NOT NULL,
  issue_type VARCHAR(64) NOT NULL,
  severity ENUM('critical', 'warning', 'info') NOT NULL DEFAULT 'warning',
  title VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  details JSON NULL,
  first_detected_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_detected_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  resolved_at DATETIME(3) NULL,
  occurrence_count INT UNSIGNED NOT NULL DEFAULT 1,
  open_key VARCHAR(120) GENERATED ALWAYS AS (IF(resolved_at IS NULL, CONCAT(sitemap_id, ':', issue_type), NULL)) STORED,
  UNIQUE KEY uq_sitemap_issue_open (open_key),
  KEY idx_sm_issues_sitemap (sitemap_id, resolved_at),
  KEY idx_sm_issues_site (site_id, resolved_at),
  KEY idx_sm_issues_project (project_id, resolved_at),
  CONSTRAINT fk_sm_issues_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT,
  CONSTRAINT fk_sm_issues_site FOREIGN KEY (site_id) REFERENCES monitored_sites(id) ON DELETE CASCADE,
  CONSTRAINT fk_sm_issues_sitemap FOREIGN KEY (sitemap_id) REFERENCES sitemaps(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO permissions (code) VALUES ('sitemap.view'), ('sitemap.manage');
INSERT IGNORE INTO role_permissions (role, permission_code) VALUES
  ('super_admin', 'sitemap.view'), ('super_admin', 'sitemap.manage'),
  ('manager', 'sitemap.view'), ('manager', 'sitemap.manage'),
  ('member', 'sitemap.view');

INSERT IGNORE INTO schema_migrations (version) VALUES ('005_sitemap_monitoring');
