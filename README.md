# GeoFlow Lab

Subscription calculator service with a Next.js interface, Supabase accounts and private storage, Stripe billing, and an isolated Python/LibreOffice calculation worker.

The first calculator is State Rent Economics. The interface offers all 318 mapped inputs in eight groups, a 30-year editable schedule, example or blank starting points, saved projects, duplication, immutable run history, summary and annual results, and editable values-only Excel exports. Subscriptions are CAD $49.99 monthly or CAD $499.99 annually, covering all calculator types. Expired accounts retain viewing and download access.

## Start locally

Use Node 22.12 or newer and pnpm 11.19.0. Copy `.env.example` to `.env.local`, configure Supabase, then run:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

Open `http://localhost:3000`. `/preview` shows the mapped form without signing in; it does not save or calculate results.

```sh
pnpm typecheck
pnpm test
python -m pytest worker/tests -q
```

The worker requires the dependencies in `worker/requirements.txt`. Its Docker image pins LibreOffice 26.8.0. The Render blueprint defines the web and background-worker services; see [deployment instructions](docs/DEPLOYMENT.md).

For the separately configured Cloudflare interface preview and GitHub deployment
workflow, see [Cloudflare setup](docs/CLOUDFLARE.md). GitHub carries committed
changes between computers; local environment settings and private models stay
outside the repository.

## Private model boundary

Source workbooks, runtime workbooks, private manifests, numerical review records, and model preparation scripts are kept outside this public repository. The worker downloads an approved version from private Supabase storage using server-only credentials. Public preview data contains input definitions and example values, never model formulas. Customer exports are newly constructed workbooks with two visible result sheets and numeric chart data.

The owner workspace includes private release preparation tools. The public registration script accepts explicit `--manifest` and `--template` paths when releasing a model from that workspace. A managed release must include an immutable workbook checksum, mapping, defaults, output definitions and approved validation fixtures.

## Release status

This is an implementation awaiting model and deployment approval. Checkout is disabled by default. State Rent is registered as an unapproved candidate; the server and worker both reject customer execution until approval.

Fresh LibreOffice recalculation is tested locally; approved Excel parity is still required. The outstanding 12% calculation / 15% label decision has not been silently changed. Google OAuth, production email delivery, Stripe test-mode acceptance, and the Render Docker deployment must be configured and verified before launch.

No private credentials belong in Git or in `NEXT_PUBLIC_` variables. Use Render's secret settings for server and worker credentials.
