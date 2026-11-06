-- 001_foundation: users, DB-backed sessions, RBAC, projects, memberships, audit log, rate limits, system settings
-- Run once. Back up the database first. Safe on an existing production database (only creates new tables).

CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(100) NOT NULL PRIMARY KEY,
  applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(190) NOT NULL,
  username VARCHAR(60) NOT NULL,
  display_name VARCHAR(120) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('super_admin','manager','member') NOT NULL DEFAULT 'member',
  status ENUM('active','suspended') NOT NULL DEFAULT 'active',
  timezone VARCHAR(64) NOT NULL DEFAULT 'UTC',
  last_login_at DATETIME(3) NULL,
  created_by BIGINT UNSIGNED NULL,
  deleted_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_users_email (email),
  UNIQUE KEY uq_users_username (username),
  KEY idx_users_role_status (role, status),
  CONSTRAINT fk_users_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_sessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL,
  ip_address VARCHAR(45) NULL,
  user_agent VARCHAR(255) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at DATETIME(3) NOT NULL,
  revoked_at DATETIME(3) NULL,
  UNIQUE KEY uq_sessions_token (token_hash),
  KEY idx_sessions_user (user_id, revoked_at),
  KEY idx_sessions_expires (expires_at),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS permissions (
  code VARCHAR(60) NOT NULL PRIMARY KEY
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS role_permissions (
  role VARCHAR(20) NOT NULL,
  permission_code VARCHAR(60) NOT NULL,
  PRIMARY KEY (role, permission_code),
  CONSTRAINT fk_roleperm_perm FOREIGN KEY (permission_code) REFERENCES permissions(code) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS projects (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  slug VARCHAR(80) NOT NULL,
  description TEXT NULL,
  client_name VARCHAR(160) NULL,
  logo_url VARCHAR(500) NULL,
  primary_domain VARCHAR(253) NULL,
  status ENUM('active','paused','archived') NOT NULL DEFAULT 'active',
  created_by BIGINT UNSIGNED NULL,
  updated_by BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_projects_slug (slug),
  KEY idx_projects_status (status),
  CONSTRAINT fk_projects_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_projects_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS project_members (
  project_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  role ENUM('manager','member') NOT NULL DEFAULT 'member',
  added_by BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (project_id, user_id),
  KEY idx_members_user (user_id),
  CONSTRAINT fk_members_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_members_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_members_added_by FOREIGN KEY (added_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Project-level monitoring DEFAULTS. A website column that is NULL inherits the value from here.
CREATE TABLE IF NOT EXISTS project_settings (
  project_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  interval_minutes INT NOT NULL DEFAULT 5,
  timeout_ms INT NOT NULL DEFAULT 10000,
  retry_count TINYINT UNSIGNED NOT NULL DEFAULT 1,
  retry_delay_ms INT NOT NULL DEFAULT 1000,
  http_method ENUM('GET','HEAD') NOT NULL DEFAULT 'GET',
  expected_status VARCHAR(100) NOT NULL DEFAULT '200-399',
  alert_on_down TINYINT(1) NOT NULL DEFAULT 1,
  alert_on_recovery TINYINT(1) NOT NULL DEFAULT 1,
  alert_emails VARCHAR(1000) NULL,
  timezone VARCHAR(64) NOT NULL DEFAULT 'UTC',
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_psettings_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS system_settings (
  setting_key VARCHAR(100) NOT NULL PRIMARY KEY,
  setting_value TEXT NOT NULL,
  updated_by BIGINT UNSIGNED NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- user_name is a snapshot so the log stays readable after a user is deleted. project_id is intentionally not a FK.
CREATE TABLE IF NOT EXISTS activity_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NULL,
  user_name VARCHAR(120) NULL,
  action VARCHAR(60) NOT NULL,
  entity_type VARCHAR(40) NULL,
  entity_id VARCHAR(40) NULL,
  project_id BIGINT UNSIGNED NULL,
  metadata JSON NULL,
  ip_address VARCHAR(45) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_activity_user (user_id, created_at),
  KEY idx_activity_project (project_id, created_at),
  KEY idx_activity_action (action, created_at),
  KEY idx_activity_time (created_at),
  CONSTRAINT fk_activity_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rate_limits (
  bucket_key VARCHAR(190) NOT NULL PRIMARY KEY,
  window_start BIGINT NOT NULL,
  hits INT NOT NULL DEFAULT 0,
  KEY idx_rate_window (window_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO permissions (code) VALUES
  ('project.create'),
  ('project.view'),
  ('project.update'),
  ('project.archive'),
  ('project.members.manage'),
  ('site.view'),
  ('site.create'),
  ('site.update'),
  ('site.delete'),
  ('site.configure'),
  ('speedtest.view'),
  ('speedtest.run'),
  ('speedtest.schedule'),
  ('report.view'),
  ('report.generate'),
  ('report.email'),
  ('report.schedule'),
  ('activity.view'),
  ('user.manage'),
  ('settings.manage'),
  ('platform.view_all');

INSERT IGNORE INTO role_permissions (role, permission_code) VALUES
  ('super_admin','project.create'),
  ('super_admin','project.view'),
  ('super_admin','project.update'),
  ('super_admin','project.archive'),
  ('super_admin','project.members.manage'),
  ('super_admin','site.view'),
  ('super_admin','site.create'),
  ('super_admin','site.update'),
  ('super_admin','site.delete'),
  ('super_admin','site.configure'),
  ('super_admin','speedtest.view'),
  ('super_admin','speedtest.run'),
  ('super_admin','speedtest.schedule'),
  ('super_admin','report.view'),
  ('super_admin','report.generate'),
  ('super_admin','report.email'),
  ('super_admin','report.schedule'),
  ('super_admin','activity.view'),
  ('super_admin','user.manage'),
  ('super_admin','settings.manage'),
  ('super_admin','platform.view_all'),
  ('manager','project.create'),
  ('manager','project.view'),
  ('manager','project.update'),
  ('manager','project.members.manage'),
  ('manager','project.archive'),
  ('manager','site.view'),
  ('manager','site.create'),
  ('manager','site.update'),
  ('manager','site.delete'),
  ('manager','site.configure'),
  ('manager','speedtest.view'),
  ('manager','speedtest.run'),
  ('manager','speedtest.schedule'),
  ('manager','report.view'),
  ('manager','report.generate'),
  ('manager','report.email'),
  ('manager','report.schedule'),
  ('manager','activity.view'),
  ('member','project.view'),
  ('member','site.view'),
  ('member','speedtest.view'),
  ('member','speedtest.run'),
  ('member','report.view'),
  ('member','report.generate');

INSERT IGNORE INTO system_settings (setting_key, setting_value) VALUES
  ('monitor.max_concurrency', '5'),
  ('monitor.max_sites_per_run', '40'),
  ('monitor.min_interval_minutes', '1'),
  ('monitor.stale_claim_minutes', '5'),
  ('monitor.run_budget_seconds', '85'),
  ('session.days', '7');

INSERT IGNORE INTO schema_migrations (version) VALUES ('001_foundation');
