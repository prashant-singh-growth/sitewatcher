-- 007_indexability_monitoring: Technical indexability, meta robots, X-Robots-Tag, canonical tags, redirects, and issue detection.
-- Requires 001 and 002. Only creates new tables and seeds permissions.

CREATE TABLE IF NOT EXISTS indexability_monitors (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  project_id BIGINT UNSIGNED NOT NULL,
  site_id BIGINT UNSIGNED NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  check_interval_hours INT UNSIGNED NOT NULL DEFAULT 24,
  total_monitored_urls INT UNSIGNED NOT NULL DEFAULT 0,
  indexable_urls_count INT UNSIGNED NOT NULL DEFAULT 0,
  noindex_urls_count INT UNSIGNED NOT NULL DEFAULT 0,
  canonical_issues_count INT UNSIGNED NOT NULL DEFAULT 0,
  error_urls_count INT UNSIGNED NOT NULL DEFAULT 0,
  recently_changed_count INT UNSIGNED NOT NULL DEFAULT 0,
  last_checked_at DATETIME(3) NULL,
  claim_token CHAR(32) NULL,
  claimed_at DATETIME(3) NULL,
  next_run_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_idx_site (site_id),
  KEY idx_idx_due (is_active, next_run_at),
  KEY idx_idx_project (project_id),
  CONSTRAINT fk_idxm_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT,
  CONSTRAINT fk_idxm_site FOREIGN KEY (site_id) REFERENCES monitored_sites(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS url_indexability_pages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  project_id BIGINT UNSIGNED NOT NULL,
  site_id BIGINT UNSIGNED NOT NULL,
  url VARCHAR(2048) NOT NULL,
  url_hash CHAR(64) NOT NULL,
  source ENUM('sitemap', 'root', 'manual') NOT NULL DEFAULT 'sitemap',
  http_status SMALLINT NULL,
  is_indexable TINYINT(1) NOT NULL DEFAULT 1,
  previous_is_indexable TINYINT(1) NULL,
  has_noindex TINYINT(1) NOT NULL DEFAULT 0,
  noindex_source VARCHAR(64) NULL,
  meta_robots VARCHAR(255) NULL,
  meta_googlebot VARCHAR(255) NULL,
  x_robots_tag VARCHAR(500) NULL,
  canonical_url VARCHAR(2048) NULL,
  canonical_status ENUM('self_referencing', 'canonicalized', 'cross_domain', 'missing', 'multiple', 'invalid') NOT NULL DEFAULT 'missing',
  redirect_destination VARCHAR(2048) NULL,
  redirect_hops TINYINT UNSIGNED NOT NULL DEFAULT 0,
  status_changed_at DATETIME(3) NULL,
  first_checked_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_checked_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_uip_site_url (site_id, url_hash),
  KEY idx_uip_site_indexable (site_id, is_indexable),
  KEY idx_uip_site_status (site_id, http_status),
  KEY idx_uip_project (project_id),
  CONSTRAINT fk_uip_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT,
  CONSTRAINT fk_uip_site FOREIGN KEY (site_id) REFERENCES monitored_sites(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS url_indexability_snapshots (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  page_id BIGINT UNSIGNED NOT NULL,
  site_id BIGINT UNSIGNED NOT NULL,
  project_id BIGINT UNSIGNED NOT NULL,
  url VARCHAR(2048) NOT NULL,
  http_status SMALLINT NULL,
  is_indexable TINYINT(1) NOT NULL,
  has_noindex TINYINT(1) NOT NULL,
  meta_robots VARCHAR(255) NULL,
  meta_googlebot VARCHAR(255) NULL,
  x_robots_tag VARCHAR(500) NULL,
  canonical_url VARCHAR(2048) NULL,
  canonical_status VARCHAR(40) NOT NULL,
  redirect_destination VARCHAR(2048) NULL,
  error_message VARCHAR(500) NULL,
  checked_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_uis_page (page_id, checked_at),
  KEY idx_uis_site (site_id, checked_at),
  KEY idx_uis_project (project_id, checked_at),
  CONSTRAINT fk_uis_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT,
  CONSTRAINT fk_uis_site FOREIGN KEY (site_id) REFERENCES monitored_sites(id) ON DELETE CASCADE,
  CONSTRAINT fk_uis_page FOREIGN KEY (page_id) REFERENCES url_indexability_pages(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS indexability_issues (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  project_id BIGINT UNSIGNED NOT NULL,
  site_id BIGINT UNSIGNED NOT NULL,
  page_id BIGINT UNSIGNED NULL,
  url VARCHAR(2048) NOT NULL,
  issue_type VARCHAR(64) NOT NULL,
  severity ENUM('critical', 'warning', 'info') NOT NULL DEFAULT 'warning',
  title VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  previous_value VARCHAR(2048) NULL,
  current_value VARCHAR(2048) NULL,
  first_detected_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_detected_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  resolved_at DATETIME(3) NULL,
  occurrence_count INT UNSIGNED NOT NULL DEFAULT 1,
  open_key VARCHAR(190) GENERATED ALWAYS AS (IF(resolved_at IS NULL, CONCAT(site_id, ':', MD5(url), ':', issue_type), NULL)) STORED,
  UNIQUE KEY uq_idx_issue_open (open_key),
  KEY idx_idx_issues_site (site_id, resolved_at),
  KEY idx_idx_issues_project (project_id, resolved_at),
  CONSTRAINT fk_iissues_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT,
  CONSTRAINT fk_iissues_site FOREIGN KEY (site_id) REFERENCES monitored_sites(id) ON DELETE CASCADE,
  CONSTRAINT fk_iissues_page FOREIGN KEY (page_id) REFERENCES url_indexability_pages(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO permissions (code) VALUES ('indexability.view'), ('indexability.manage');
INSERT IGNORE INTO role_permissions (role, permission_code) VALUES
  ('super_admin', 'indexability.view'), ('super_admin', 'indexability.manage'),
  ('manager', 'indexability.view'), ('manager', 'indexability.manage'),
  ('member', 'indexability.view');

INSERT IGNORE INTO schema_migrations (version) VALUES ('007_indexability_monitoring');
