-- 001_foundation DOWN: removes ALL multi-user data (users, sessions, projects, audit log). 002 must be rolled back first.
DROP TABLE IF EXISTS rate_limits;
DROP TABLE IF EXISTS activity_logs;
DROP TABLE IF EXISTS system_settings;
DROP TABLE IF EXISTS project_settings;
DROP TABLE IF EXISTS project_members;
DROP TABLE IF EXISTS projects;
DROP TABLE IF EXISTS role_permissions;
DROP TABLE IF EXISTS permissions;
DROP TABLE IF EXISTS user_sessions;
DROP TABLE IF EXISTS users;
DELETE FROM schema_migrations WHERE version = '001_foundation';
