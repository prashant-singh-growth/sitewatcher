# SiteWatch architecture (v2 foundation)

## Layout
database/migrations/   000_baseline, 001_foundation, 002_monitoring_upgrade (+ *.down.sql)
scripts/migrate.js     tracked runner: up | down | status
lib/                   platform core: db, auth, rbac, api, audit, ssrf, ratelimit, settings, password, validate, mailer, errors
modules/<name>/        one folder per feature: monitoring/ (probe, engine, settings, service), speedtest/ (psi, compare, service), reports/ (data, pdf, service), projects/
app/(app)/             authenticated UI pages (shell + sidebar from lib/nav.ts); app/ui/ holds the design kit
app/api/...            thin handlers: parse -> authorize -> call module -> audit

A future module (SSL, DNS, speed test...) adds modules/<name>/, its routes, a migration and a nav entry,
reusing api(), requireProject()/requireSite(), audit(), assertPublicUrl() and sendMail() unchanged.

## Data model
users(role) -< project_members >- projects -1:1- project_settings (defaults)
projects -< monitored_sites (nullable override columns) -< check_results, incidents -< incident_notifications
Also: activity_logs, user_sessions, rate_limits, system_settings, cron_execution_logs, permissions/role_permissions.

## Authorization
- Global role users.role: super_admin | manager | member (platform permissions: project.create, user.manage ...).
- Project role project_members.role: manager | member (permissions inside that project).
- Permissions are rows in role_permissions; built-in defaults are the fallback.
- Every handler calls requireProject / requireSite / requireGlobalPermission itself.
  A non-member gets 404 (not 403) so IDs cannot be enumerated.

## Scheduler
Hostinger Cron (every minute) -> /api/cron/check -> runMonitoring():
1. One UPDATE ... ORDER BY next_run_at LIMIT n atomically claims due sites with a random token.
2. Claimed sites run through a bounded worker pool (default 5 concurrent, 85 s budget).
3. Result -> incident logic -> check_results -> next_run_at = now + effective interval; claim released.
4. Unfinished or failed sites release their claim; a claim older than 5 min (crashed run) is reclaimable.
Overlapping dispatchers cannot claim the same site, so no global lock is needed.
Effective settings = website override, else project default.

## SSRF
lib/ssrf.ts: scheme/credential/hostname rules, IPv4+IPv6 private-range table (mapped, NAT64, 6to4),
DNS check when a URL is saved, and a lookup hook used at connect time so the connected IP is the validated IP
(DNS-rebinding safe). Redirects are followed manually and every hop is re-validated.

## Adding a module (example: SSL monitoring)
1. `database/migrations/005_ssl.sql` (+ down). 2. `modules/ssl/` with service functions. 3. `app/api/ssl/...` handlers using `api()`, `requireSite()`, `audit()`.
4. One entry in `lib/nav.ts` and a page under `app/(app)/ssl/`. 5. If it needs periodic work, add a `runDueSsl()` call next to the others in `app/api/cron/check/route.ts`.
Permissions go in `role_permissions` (and `ALL_PERMISSIONS` in `lib/rbac.ts`).

## Cron request order
uptime checks (priority) -> due speed-test schedules (skipped after 50 s) -> due sitemap checks (skipped after 40 s) -> due robots.txt checks (skipped after 35 s) -> due indexability checks (skipped after 40 s) -> due report emails (skipped after 70 s).
