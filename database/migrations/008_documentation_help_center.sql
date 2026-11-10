-- 008_documentation_help_center: Documentation categories, articles, feedback, and role permissions.
-- Requires 001. Only creates new tables and seeds permissions.

CREATE TABLE IF NOT EXISTS doc_categories (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  slug VARCHAR(64) NOT NULL UNIQUE,
  title VARCHAR(120) NOT NULL,
  description VARCHAR(255) NULL,
  icon VARCHAR(40) NOT NULL DEFAULT 'file',
  display_order INT NOT NULL DEFAULT 0,
  min_role ENUM('member', 'manager', 'super_admin') NOT NULL DEFAULT 'member',
  is_published TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_doc_cat_order (is_published, display_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS doc_articles (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  category_id INT UNSIGNED NOT NULL,
  slug VARCHAR(80) NOT NULL UNIQUE,
  title VARCHAR(160) NOT NULL,
  summary VARCHAR(300) NOT NULL,
  content_md MEDIUMTEXT NOT NULL,
  min_role ENUM('member', 'manager', 'super_admin') NOT NULL DEFAULT 'member',
  required_permission VARCHAR(64) NULL,
  display_order INT NOT NULL DEFAULT 0,
  is_published TINYINT(1) NOT NULL DEFAULT 1,
  version VARCHAR(20) NOT NULL DEFAULT '1.0',
  read_time_minutes INT UNSIGNED NOT NULL DEFAULT 3,
  related_slugs JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_doc_art_cat (category_id, display_order),
  KEY idx_doc_art_pub (is_published, min_role),
  CONSTRAINT fk_doc_cat FOREIGN KEY (category_id) REFERENCES doc_categories(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS doc_feedback (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  article_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NULL,
  is_helpful TINYINT(1) NOT NULL,
  comment TEXT NULL,
  user_role VARCHAR(40) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_doc_fb_art (article_id, is_helpful),
  CONSTRAINT fk_doc_feedback_art FOREIGN KEY (article_id) REFERENCES doc_articles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO permissions (code) VALUES ('docs.view'), ('docs.manage');

INSERT IGNORE INTO role_permissions (role, permission_code) VALUES
  ('super_admin', 'docs.view'), ('super_admin', 'docs.manage'),
  ('manager', 'docs.view'),
  ('member', 'docs.view');

INSERT IGNORE INTO schema_migrations (version) VALUES ('008_documentation_help_center');
