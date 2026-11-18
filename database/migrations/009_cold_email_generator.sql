-- 009_cold_email_generator: AI Cold Email Generator history with 7-day retention.
-- Requires 001. Only creates new tables and seeds permissions.

CREATE TABLE IF NOT EXISTS cold_email_generations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  inputs JSON NOT NULL,
  outputs JSON NOT NULL,
  model_used VARCHAR(80) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at DATETIME(3) NOT NULL,
  KEY idx_ceg_user_created (user_id, created_at),
  KEY idx_ceg_expires (expires_at),
  KEY idx_ceg_user_expires (user_id, expires_at),
  CONSTRAINT fk_ceg_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO permissions (code) VALUES ('cold_email.use'), ('cold_email.manage');

INSERT IGNORE INTO role_permissions (role, permission_code) VALUES
  ('super_admin', 'cold_email.use'), ('super_admin', 'cold_email.manage'),
  ('manager', 'cold_email.use'), ('manager', 'cold_email.manage'),
  ('member', 'cold_email.use');

INSERT IGNORE INTO schema_migrations (version) VALUES ('009_cold_email_generator');
