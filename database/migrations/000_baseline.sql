-- 000_baseline: the ORIGINAL SiteWatch schema (idempotent, safe on an existing production database)

CREATE TABLE IF NOT EXISTS monitored_sites (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  url VARCHAR(2048) NOT NULL,
  interval_minutes INT NOT NULL DEFAULT 5,
  timeout_ms INT NOT NULL DEFAULT 15000,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_monitored_sites_url (url(255)),
  KEY idx_sites_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS check_results (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  site_id BIGINT UNSIGNED NOT NULL,
  status_code SMALLINT NULL,
  is_up TINYINT(1) NOT NULL,
  response_ms INT NULL,
  error_message VARCHAR(1000) NULL,
  checked_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_check_site FOREIGN KEY (site_id) REFERENCES monitored_sites(id) ON DELETE CASCADE,
  KEY idx_results_site_time (site_id, checked_at),
  KEY idx_results_time (checked_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS incidents (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  site_id BIGINT UNSIGNED NOT NULL,
  started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  resolved_at DATETIME(3) NULL,
  last_error VARCHAR(1000) NULL,
  CONSTRAINT fk_incident_site FOREIGN KEY (site_id) REFERENCES monitored_sites(id) ON DELETE CASCADE,
  KEY idx_incidents_site_open (site_id, resolved_at),
  KEY idx_incidents_started (started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
