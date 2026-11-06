# SiteWatch: agency website monitoring platform (v2)

Multi-user, project-based uptime monitoring, Google PageSpeed (Lighthouse) tracking and PDF client reporting for
Hostinger Business Node.js hosting (Next.js 15 App Router, React 19, TypeScript, MySQL, Hostinger Cron, SMTP).

## What is included

| Area | Delivered |
|---|---|
| Users and roles | Master Admin, Manager, Member. Hashed passwords, revocable sessions, login rate limiting, suspend / delete / reset |
| Projects | Projects with client details, logo, status, members, project-level monitoring defaults and per-website overrides |
| Monitoring | One cron entry point, due-task scheduler, per-site interval / timeout / retries / method / status codes / alerts / maintenance window, incidents with timeline and email history |
| Speed Test | Google PageSpeed Insights, mobile and desktop, saved history, custom comparison (two audits, two dates, last two), one-time / recurring / custom-sequence schedules |
| Reports | PDF per website or project, presets or custom range, selectable sections, download or email to several recipients, scheduled daily / weekly / monthly / custom |
| Audit log | Logins, project / site / monitoring / speed-test / report / user / settings actions with filters |
| UI | Sidebar driven by `lib/nav.ts`, search, notifications, project switcher, role-aware overview, charts, modals, toasts, skeletons, responsive layout |

**Verification status (be aware):** Phases A and B were tested end to end against MariaDB 10.11 (55 checks: auth, isolation, SSRF, cron).
Phases C to F (Speed Test, Reports, new UI) **compile and build** (`tsc`, `next build`) but have **not** been run against a real database,
the real Google API, real SMTP, or a browser. Treat them as needing your acceptance testing. See "Verify after deploying" below.

## What changes for an existing install
- Login is per-user (hashed passwords, revocable DB sessions, rate limiting). Your existing `ADMIN_USERNAME` / `ADMIN_PASSWORD`
  work once: the first sign-in on an empty users table creates the Master Admin.
- All existing websites, history and incidents move into **Default Project**. Nothing is deleted.
- `/api/cron/check?key=...` is unchanged, so your cron command keeps working. Change its schedule to **every minute** (`* * * * *`);
  only websites that are due are checked.
- Removing a website is a soft delete: history stays for reports and the URL can be re-added.

## New environment variables
| Variable | Purpose |
|---|---|
| `GOOGLE_PAGESPEED_API_KEY` | Server-side key for the PageSpeed Insights API (enable "PageSpeed Insights API" in Google Cloud). Without it, Speed Test shows a clear "not configured" message |
| `ADMIN_EMAIL` | Email for the bootstrapped Master Admin |
| `PAGESPEED_API_BASE` | Optional, testing only: override the Google endpoint |
| `AUTH_SECRET` | No longer used |

## Upgrade an existing production install
1. **Back up**: hPanel > phpMyAdmin > Export (SQL).
2. Deploy the new code; update env vars from `.env.example` (add `ADMIN_EMAIL`; `AUTH_SECRET` is no longer needed).
3. Apply migrations, either:
   - terminal/SSH: `npm install && npm run db:migrate` (`npm run db:status` to inspect), or
   - phpMyAdmin SQL tab: run `001_foundation.sql`, `002_monitoring_upgrade.sql`, `003_speedtest.sql`, `004_reports.sql` (all in `database/migrations/`), once each, in order.
     (`000_baseline.sql` is the original schema, only needed on a brand-new database.)
4. Restart the app, sign in with your old admin credentials. Your sites are under "Default Project".
5. Change the cron job to `* * * * *`.

Rollback: `npm run db:rollback` undoes the latest migration via its `.down.sql`. MySQL DDL is not transactional, so if a migration
stops half-way, restore the backup instead of re-running it.

Tested on MariaDB 10.11 with a legacy-shaped database (including duplicate open incidents), including rollback and re-apply.
**MySQL 8 was not available to test.**

## Roles
| Role | Scope |
|---|---|
| super_admin | Everything: users, all projects, sites, activity |
| manager (global) | May create projects; inside a project manages sites, settings, members and sees that project's activity |
| member | Views assigned projects and websites; read-only for now |

Project membership has its own role (manager | member). Non-members get 404 for any project or site ID.

## Monitoring settings
Project defaults live in `project_settings`; a website column left NULL inherits the project value. Per website: interval (1-1440 min),
timeout, retries, retry delay, GET/HEAD, expected status codes (`200-399,401`), down/recovery alerts, maintenance window.
Project `alert_emails` override `ALERT_TO`. Settings whose worst case (attempts x timeout + delays) exceeds 60 s are rejected.
Engine limits (concurrency, sites per run, time budget) are rows in `system_settings`.

## API
`POST /api/auth/login|logout`, `GET /api/auth/me`, `GET|POST /api/projects`, `GET|PATCH /api/projects/:id` (PATCH takes `settings` for defaults),
`POST /api/projects/:id/members`, `PATCH|DELETE /api/projects/:id/members/:userId`, `GET|POST /api/sites?projectId=`,
`GET|PATCH|DELETE /api/sites/:id`, `GET /api/sites/:id/history` (status, from, to, before, limit), `GET|POST /api/users`,
`GET|PATCH|DELETE /api/users/:id`, `GET /api/activity`, `GET|POST /api/cron/check`, `GET /api/cron/logs`, `GET /api/overview`, `GET /api/search`, `GET|PATCH /api/settings`, `PATCH /api/auth/profile`,
`GET /api/sites/:id/series`, `GET|POST /api/speedtest`, `GET /api/speedtest/:id`, `GET /api/speedtest/compare`, `GET|POST /api/speedtest/schedules`, `PATCH|DELETE /api/speedtest/schedules/:id`,
`GET|POST /api/reports`, `GET /api/reports/:id/download`, `POST /api/reports/email`, `GET|POST /api/reports/schedules`, `PATCH|DELETE /api/reports/schedules/:id`.

## Security
- Passwords: scrypt (Node built-in, no native build on managed hosting; chosen over Argon2id for that reason). Minimum 12 characters.
- Sessions: 256-bit random token in an HTTP-only, SameSite=Strict, Secure cookie; only its SHA-256 is stored. Suspend, delete or reset revokes sessions immediately.
- Login limits: 8 per account and 30 per IP per 15 minutes. X-Forwarded-For is trusted for the IP, so the per-account limit is the stronger control.
- CSRF: SameSite=Strict plus an Origin check on writes. SSRF: see `docs/ARCHITECTURE.md`.
- Cron secret compared in constant time; prefer the `x-cron-secret` header.
- Audit log is append-only through the API; managers do not see IP addresses.

## Verify after deploying (checklist)
1. Sign in with the old admin credentials; confirm "Default Project" holds your sites.
2. Set `GOOGLE_PAGESPEED_API_KEY`, restart, run a mobile + desktop test on one site (takes up to a minute); open History and Compare.
3. Reports: download a PDF for the project and for one site; open it and check numbers against the website page.
4. Email: send a report to yourself (needs SMTP). Create a daily schedule, then confirm the cron run sends it.
5. Create a Manager and a Member, assign a project, and confirm the Member cannot see other projects, add sites or open Users / Activity.
6. Cron Monitor page shows recent runs within a minute or two.

## Known limits and design choices
- **Speed test duration:** manual tests run inside one web request (up to ~60 s for mobile + desktop). If Hostinger's proxy times out earlier, run one device at a time.
- **Scheduled speed tests and reports** run from the same minute cron, after uptime checks, only when enough request time remains. A busy minute delays them to the next.
- **PDF reports are regenerated on demand** from saved parameters (nothing stored on disk); re-downloading an old report reflects the data then in the database for that period. Logos must be public PNG/JPEG.
- **DOCX export** is not built; `modules/reports/data.ts` is renderer-independent, so a DOCX renderer can sit beside `pdf.ts`.
- **Uptime %** is the share of passed checks; downtime is the sum of incident time overlapping the period. Response time is time-to-headers.
- **Per-user permission overrides** are not implemented; access comes from the global role plus the project role (`role_permissions` table is editable in SQL).
- Monthly report schedules advance by one calendar month; "custom" uses a day interval.

## Tests performed (Phases A and B only)
`tsc --noEmit`, `next build`, and a 55-check end-to-end script against a real database: auth, bootstrap, role isolation
(ID tampering returns 404), 13 SSRF payloads, rate limiting, suspension killing live sessions, last-super-admin protection,
soft delete and re-add, audit scoping, and a real cron dispatch (due-only selection, retries, incident reuse, claim release).
Not tested: MySQL 8, real SMTP delivery, Hostinger itself.

## Fresh install on Hostinger
1. Create the subdomain as its own Hostinger website and choose Node.js Web App (Node 22 or 24); upload the ZIP or deploy from GitHub.
2. Create a MySQL database and user in hPanel. `DATABASE_URL=mysql://USER:URL_ENCODED_PASSWORD@HOST:3306/DBNAME`.
3. Set the environment variables from `.env.example`. Generate secrets with `openssl rand -base64 48`.
4. Run `npm run db:migrate`, or paste `000`, `001`, `002` into phpMyAdmin in order.
5. Build `npm run build`, start `npm run start`.
6. Cron Jobs (UTC), schedule `* * * * *`:
   `curl -fsS -H "x-cron-secret: YOUR_CRON_SECRET" "https://status.yourdomain.com/api/cron/check"`
   A good response is JSON with `due`, `checked`, `up`, `down`. 401 = wrong secret; 500 = check app logs.
7. Verify alerts using a test site you control.

## Notes
- Hostinger Node.js has request limits and no always-on workers; the dispatcher is a short bounded cron request.
- Unexpected status codes count as down (default 200-399, judged after redirects).
- History is kept until removed; add a retention job if volume grows.
- Response time is time-to-headers, not browser LCP; Lighthouse/CrUX data comes with the Speed Test module.

## Local development
```bash
cp .env.example .env && npm install && npm run db:migrate && npm run dev
```
# sitewatcher
