DROP TABLE IF EXISTS sitemap_issues;
DROP TABLE IF EXISTS sitemap_scan_changes;
DROP TABLE IF EXISTS sitemap_urls;
DROP TABLE IF EXISTS sitemap_scans;
DROP TABLE IF EXISTS sitemaps;
DELETE FROM role_permissions WHERE permission_code IN ('sitemap.view', 'sitemap.manage');
DELETE FROM permissions WHERE code IN ('sitemap.view', 'sitemap.manage');
DELETE FROM schema_migrations WHERE version = '005_sitemap_monitoring';
