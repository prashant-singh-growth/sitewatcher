DROP TABLE IF EXISTS robots_issues;
DROP TABLE IF EXISTS robots_url_evaluations;
DROP TABLE IF EXISTS robots_rules;
DROP TABLE IF EXISTS robots_snapshots;
DROP TABLE IF EXISTS robots_monitors;
DELETE FROM role_permissions WHERE permission_code IN ('robots.view', 'robots.manage');
DELETE FROM permissions WHERE code IN ('robots.view', 'robots.manage');
DELETE FROM schema_migrations WHERE version = '006_robots_monitoring';
