-- 009_cold_email_generator: Rollback AI Cold Email Generator table and permissions.

DROP TABLE IF EXISTS cold_email_generations;

DELETE FROM role_permissions WHERE permission_code IN ('cold_email.use', 'cold_email.manage');
DELETE FROM permissions WHERE code IN ('cold_email.use', 'cold_email.manage');

DELETE FROM schema_migrations WHERE version = '009_cold_email_generator';
