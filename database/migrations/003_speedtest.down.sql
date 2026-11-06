-- 003_speedtest DOWN: deletes all stored speed-test history and schedules.
DROP TABLE IF EXISTS speed_test_schedules;
DROP TABLE IF EXISTS pagespeed_audits;
DELETE FROM schema_migrations WHERE version = '003_speedtest';
