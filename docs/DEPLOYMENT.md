# Whittaker Geo deployment

This application is a Next.js web service backed by Supabase and a separate Python calculation worker. The Render blueprint defines a Node web service, a Docker background worker, and a separate private HTTP calculation service for live edits. The Cloudflare frontend is configured separately; see [Cloudflare setup](CLOUDFLARE.md). The worker is responsible for processing queued immutable runs; the web service owns authentication, API requests, and signed download URLs.

## Temporary sign-in entry

The root URL temporarily redirects to `/signin` while the homepage is unfinished.
Existing auth-error and selected-plan query parameters are preserved. Signed-in
users continue to their workspace through the existing sign-in flow. The sign-in
screen no longer links back to the hidden homepage; preview navigation links to
sign-in. The homepage source remains available for the later launch.

## Local setup

Requirements are Node 22 or newer and pnpm 11.19.0. The checked-in Render web service uses Node 22; local development may use the installed Node 24.19.0. The worker image requires Python dependencies from `worker/requirements.txt` and LibreOffice in the worker image.

```text
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

Copy `.env.example` to `.env.local` and fill in the values described below. Never commit `.env.local`, service-role keys, Stripe secrets, database URLs, or OAuth client secrets.

## Environment variables

The browser can receive only variables prefixed with `NEXT_PUBLIC_`. These are identifiers, not credentials:

| Variable                        | Owner         | Purpose                                                                                   |
| ------------------------------- | ------------- | ----------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | Browser       | Supabase project URL.                                                                     |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser       | Supabase publishable/anon key.                                                            |
| `APP_URL`                       | Server        | Canonical public origin used for auth redirects, checkout return URLs, and origin checks. |
| `SUPABASE_SERVICE_ROLE_KEY`     | Server only   | Service-role database/storage operations. Never expose to the browser.                    |
| `SUPABASE_URL`                  | Server/worker | Supabase URL for trusted server and worker calls.                                         |
| `DATABASE_URL`                  | Worker/server | Postgres connection used by the worker.                                                   |
| `STRIPE_SECRET_KEY`             | Server only   | Stripe API access.                                                                        |
| `STRIPE_WEBHOOK_SECRET`         | Server only   | Signature verification for `/api/billing/webhook`.                                        |
| `STRIPE_MONTHLY_PRICE_ID`       | Server        | Stripe price for the monthly CAD plan.                                                    |
| `STRIPE_ANNUAL_PRICE_ID`        | Server        | Stripe price for the annual CAD plan.                                                     |
| `BILLING_ENABLED`               | Server        | Keep `false` until live prices, webhook handling, and launch approval are complete.       |
| `CALC_ENGINE_URL`              | Server        | HTTPS origin of the private live engine; never a browser endpoint.                         |
| `CALC_ENGINE_SECRET`           | Server/engine | Shared engine authentication secret, at least 32 bytes; server-only.                      |
| `UNO_PYTHON_BIN`               | Worker        | Python with UNO bridge for a warm live process.                                          |
| `SOFFICE_BIN`                   | Worker        | LibreOffice executable; default `soffice`.                                                |

Do not put `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, Stripe secrets, or worker credentials in any `NEXT_PUBLIC_` variable.

## Supabase

Create a Supabase project, enable Google OAuth and email magic links, and add these redirect URLs in Supabase Auth:

```text
http://localhost:3000/auth/callback
https://<your-app-domain>/auth/callback
```

Configure the Google provider with its OAuth client in the Supabase dashboard. Configure email delivery before relying on magic links in production.

Apply migrations from the repository root with the project migration runner. This uses `DATABASE_URL` and maintains the immutable checksum ledger; the project does not include Supabase CLI configuration:

```text
python scripts/migrate.py
```

The migrations create immutable calculator versions, user-owned calculations/runs, worker jobs, subscriptions, billing event guards, checkout leases, and the private storage buckets used for templates and exports. The production database must use the committed migrations in order; do not edit an approved calculator version in place.

## Registering a model version

Source workbooks, prepared runtime templates, manifests, preparation scripts, and numerical records are owner-only files excluded from Git. The new candidate is `state-rent@2.0.0-candidate.1`; older saved runs retain their original model version. See [model runtime and review](MODEL_RUNTIME.md) for the private runtime requirements, compatibility evidence, and local review setup. Do not use the legacy preparation script to regenerate the new model.

The registration script verifies the runtime SHA-256, uploads the private template, and inserts an immutable candidate with `approved=false`:

```text
python scripts/register_model.py \
  --manifest models/state-rent/2.0.0-candidate.1.json \
  --template private/models/state-rent/2.0.0-candidate.1.xlsx
```

It requires `DATABASE_URL`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY`. Registration does not grant numerical approval. The database, frontend API, and worker reject customer execution of an unapproved version.

Generate the allowlisted public preview separately:

```text
node scripts/generate-preview-manifest.mjs --manifest models/state-rent/2.0.0-candidate.1.json
```

The new artifact contains 195 operational input definitions, guide notes, display choices and validation only. It excludes formulas, private mappings and presentation source ranges, hashes, paths, repairs, and review records.

## Render

The checked-in `render.yaml` provisions:

- `geoflow-lab-web`: Node 22, `pnpm build`, `pnpm start`, health check `/api/health`.
- `geoflow-lab-calculations`: the Docker worker from `worker/Dockerfile` for saved immutable runs.
- `whittaker-geo-live-calculations`: the private HTTP engine from the same image, `python -m worker.live`, health check `/health`, warm concurrency one. Configure its shared secret and Supabase access, then set `CALC_ENGINE_URL` and the same `CALC_ENGINE_SECRET` on the frontend. This service has not been provisioned by the local implementation.

Create the Render services from the blueprint, set all `sync: false` values in the Render dashboard, and set `APP_URL` to the final HTTPS origin. Keep `BILLING_ENABLED=false` until the launch gates below are complete. Confirm the web service binds through the provided start command and that the worker can reach the same Supabase/Postgres project.

## Stripe

Create two recurring Stripe Prices in CAD: monthly CAD $49.99 and annual CAD $499.99. Put only their Price IDs in `STRIPE_MONTHLY_PRICE_ID` and `STRIPE_ANNUAL_PRICE_ID`. Configure the webhook endpoint:

```text
https://<your-app-domain>/api/billing/webhook
```

The server keeps checkout idempotent through the database checkout lease and applies subscription state from verified webhook events. Leave checkout disabled when Stripe is not configured.

## Approval checklist

Deployment is not a model approval. Before setting a version `approved=true` or enabling billing, record these checks:

- [ ] Numerical review of the exact candidate and representative changed-input scenarios is signed off by the model owner. The legacy 12/15 checkpoint remains separate.
- [ ] The candidate worker output has been reviewed against the source workbook.
- [ ] No approved Excel parity claim has been made; Excel parity remains unapproved until explicitly validated.
- [ ] The candidate's 20-year schedule, source NPV labels, payout logic, compatibility preparation, and dependencies have been reviewed. Legacy versions retain their original schedule.
- [ ] The exact source/runtime SHA-256 values and immutable version row are recorded.
- [ ] Worker queue processing, retries, leases, and immutable run behavior have been exercised against the deployment database.
- [ ] Google OAuth and email magic-link redirects work on the final HTTPS origin.
- [ ] Stripe test checkout and signed webhook delivery have been verified before live prices are used.
- [ ] `BILLING_ENABLED` is changed to `true` only after the above checks and live Price IDs are configured.

The Docker worker and full Render deployment are not tested by the local Next.js typecheck/build alone. Validate them in a staging environment before production rollout. The original source workbook remains preserved at its owner workstation path; release preparation reads that source and writes the separate private runtime candidate.

## Official references

- [Next.js environment variables](https://nextjs.org/docs/pages/guides/environment-variables)
- [Render web services](https://render.com/docs/web-services)
- [Supabase Google OAuth](https://supabase.com/docs/guides/auth/social-login/auth-google)
- [Supabase passwordless email](https://supabase.com/docs/guides/auth/passwordless-login/auth-magic-link)
- [Stripe Checkout quickstart](https://docs.stripe.com/payments/checkout/quickstarts)
- [Stripe Checkout Sessions API](https://docs.stripe.com/api/checkout/sessions)
