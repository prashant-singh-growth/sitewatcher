-- 002_monitoring_upgrade DOWN. Restores the original single-tenant shape. History is kept.
-- WARNING: re-adding the global UNIQUE URL index fails if two projects now monitor the same URL; remove those rows first.
-- Rows soft-deleted since the upgrade are removed first so they do not reappear in the old UI.
DELETE FROM monitored_sites WHERE deleted_at IS NOT NULL;
DROP TABLE IF EXISTS cron_execution_logs;
DROP TABLE IF EXISTS incident_notifications;
ALTER TABLE check_results DROP FOREIGN KEY fk_check_incident, DROP KEY idx_results_incident, DROP COLUMN incident_id, DROP COLUMN attempts;
ALTER TABLE incidents DROP FOREIGN KEY fk_incident_project, DROP KEY idx_incidents_project, DROP KEY uq_incidents_one_open,
  DROP COLUMN open_key, DROP COLUMN project_id, DROP COLUMN last_failure_at, DROP COLUMN failure_count;
ALTER TABLE monitored_sites DROP FOREIGN KEY fk_sites_project, DROP FOREIGN KEY fk_sites_created_by, DROP FOREIGN KEY fk_sites_updated_by,
  DROP KEY uq_sites_project_url, DROP KEY idx_sites_due, DROP KEY idx_sites_project;
UPDATE monitored_sites SET interval_minutes = COALESCE(interval_minutes, 5), timeout_ms = COALESCE(timeout_ms, 10000), updated_at = updated_at;
ALTER TABLE monitored_sites
  DROP COLUMN project_id, DROP COLUMN url_hash, DROP COLUMN retry_count, DROP COLUMN retry_delay_ms,
  DROP COLUMN http_method, DROP COLUMN expected_status, DROP COLUMN alert_on_down, DROP COLUMN alert_on_recovery,
  DROP COLUMN maintenance_start, DROP COLUMN maintenance_end, DROP COLUMN next_run_at, DROP COLUMN last_run_at,
  DROP COLUMN claim_token, DROP COLUMN claimed_at, DROP COLUMN last_is_up, DROP COLUMN last_status_code,
  DROP COLUMN last_response_ms, DROP COLUMN last_checked_at, DROP COLUMN created_by, DROP COLUMN updated_by, DROP COLUMN deleted_at,
  MODIFY interval_minutes INT NOT NULL DEFAULT 5, MODIFY timeout_ms INT NOT NULL DEFAULT 15000,
  ADD UNIQUE KEY uq_monitored_sites_url (url(255));
DELETE FROM schema_migrations WHERE version = '002_monitoring_upgrade';
