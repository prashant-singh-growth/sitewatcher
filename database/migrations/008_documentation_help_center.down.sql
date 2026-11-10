-- 008_documentation_help_center: Rollback documentation tables and permissions.

DROP TABLE IF EXISTS doc_feedback;
DROP TABLE IF EXISTS doc_articles;
DROP TABLE IF EXISTS doc_categories;

DELETE FROM role_permissions WHERE permission_code IN ('docs.view', 'docs.manage');
DELETE FROM permissions WHERE code IN ('docs.view', 'docs.manage');

DELETE FROM schema_migrations WHERE version = '008_documentation_help_center';
