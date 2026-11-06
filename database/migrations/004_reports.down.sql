-- 004_reports DOWN: deletes report history and report schedules.
DROP TABLE IF EXISTS report_schedules;
DROP TABLE IF EXISTS reports;
DELETE FROM schema_migrations WHERE version = '004_reports';
