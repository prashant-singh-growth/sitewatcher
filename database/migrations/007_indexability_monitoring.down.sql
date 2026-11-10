DROP TABLE IF EXISTS indexability_issues;
DROP TABLE IF EXISTS url_indexability_snapshots;
DROP TABLE IF EXISTS url_indexability_pages;
DROP TABLE IF EXISTS indexability_monitors;
DELETE FROM role_permissions WHERE permission_code IN ('indexability.view', 'indexability.manage');
DELETE FROM permissions WHERE code IN ('indexability.view', 'indexability.manage');
DELETE FROM schema_migrations WHERE version = '007_indexability_monitoring';
