# Cloudflare deployment and development across computers

GitHub is the shared source of truth. Commit and push changes from either
computer, then pull before continuing on the other computer. Files that are
only saved locally are not synced by hosting or by GitHub.

## Deployment

The `Deploy GeoFlow preview` GitHub Actions workflow validates pull requests.
Pushes to `main` deploy the web application after the Next.js build, application
tests, Cloudflare build, and Cloudflare configuration checks pass.

The target is the `geoflow-preview` Worker in Cloudflare account
`032b3907437b929309a3bb9c45964a13`. The production domain is:

`https://whittakergeo.com`

This deployment includes the interface and the configured Supabase connection
described below. Billing is explicitly disabled. Pushes to `main` deploy
application code after the GitHub checks pass. They do not upload private model
files, register or approve a model version, or activate it. The legacy Node
Render web service remains in the repository blueprint for reference; Cloudflare
serves the production frontend. Ordinary `pnpm dev`, `pnpm build`, and `pnpm start`
commands remain available for local development and the legacy service.

The Cloudflare Worker is configured to send live evaluations to
`https://whittaker-geo-live-calculations.onrender.com`, using a server-only
shared secret. This is a public HTTPS connection authenticated by the secret,
not private networking between Cloudflare and Render. The Render service exists
on its Free plan as a staging service, but its Docker/runtime behavior and the
full request path have not been validated for production. Its requested $7 plan
upgrade is pending; the saved-run worker upgrade is pending as well. The v2
model candidate is registered with `approved=false`, while the active catalog
pointer remains v1. The production interface can show the v2 preview, but that
does not mean hosted live calculations for v2 are enabled or approved.

Cloudflare's current Next.js integration uses vinext and the Cloudflare Vite
plugin. These provide a separate build path. Their beta status means this setup
is not evidence that authenticated production workflows or calculation parity
have been accepted.

## One-time authorization

Create a Cloudflare API token limited to the account above, with Account /
Workers Scripts / Edit and Account / Account Settings / Read. Store it as the
`CLOUDFLARE_API_TOKEN` Actions secret only in `adamhfx/geoflowlab`.
Do not put it in Git, source files, workflow YAML, logs, or chat.

GitHub Actions supplies this credential only to the deployment step. Pull
requests run checks without the Cloudflare token and cannot deploy.

This workflow does not change the existing Cloudflare GitHub App installation
or its access to other repositories. Cloudflare's built-in connection did not
advance to repository selection in this account during setup.

## Local Cloudflare checks

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm build
corepack pnpm test
corepack pnpm build:vinext
corepack pnpm typecheck:cloudflare
corepack pnpm start:vinext --port 4173 --host 127.0.0.1
```

Visit `http://127.0.0.1:4173/preview` to exercise the built app in the Workers
runtime. `pnpm dev:vinext` starts a separate Vite development server on 3001.
Switching build tools regenerates their `.next` route declarations; run
`pnpm build` or restart `pnpm dev` before checking Next.js types after a vinext
build. Worker runtime types are isolated in `tsconfig.cloudflare.json` so they
do not change the browser's TypeScript definitions.

## whittakergeo.com

The domain serves the current application. `APP_URL` is
`https://whittakergeo.com`; production sign-in and workspace pages opened through
the older Workers hostname redirect to this origin before starting authentication.
Preview routes remain available on the Workers hostname. Local development keeps
its configured loopback origin.

Supabase Auth's Site URL must be `https://whittakergeo.com` and its Redirect URLs
must include exactly `https://whittakergeo.com/auth/callback`. A missing exact
callback makes Supabase fall back to the Site URL, which previously sent users
to the old Render deployment. Keep the existing local callbacks for development.

## Laptop-only material

Transfer `.env.local`, private model workbooks/manifests, and owner-only release
tools separately when full service development is needed. Keep them out of
the public repository. Local Codex chats also do not transfer through Git.

## Supabase connection

The public browser build and Worker runtime both target the existing Calculations
App Supabase project (`mkjlxkctrtqcvxucuzcs`). The workflow includes only its public
URL and publishable key. Those identifiers are intentionally safe to ship to the
browser; database Row Level Security remains responsible for user data access.

Set `SUPABASE_SERVICE_ROLE_KEY` as an encrypted secret on `geoflow-preview` in
Cloudflare. Despite the legacy environment-variable name, the JavaScript SDK and
Python storage helper accept a modern `sb_secret_` key. Never place this value in
Git, a `NEXT_PUBLIC_` variable, or build environment variables.

For local Next.js development, use the same public URL/publishable key and a server
secret in ignored `.env.local`, then restart the development server. Set local
`APP_URL` to `http://127.0.0.1:3000` for the configured development hostname.

Supabase Auth must allow these exact callback URLs:
- `https://whittakergeo.com/auth/callback`
- `https://geoflow-preview.roger-d-whittaker.workers.dev/auth/callback`
- `http://127.0.0.1:3000/auth/callback`
- `http://localhost:3000/auth/callback`

Preserve existing Render callback URLs while the legacy service remains in use.
Add future custom-domain callbacks only after confirming their ownership and
route. API keys do not apply SQL migrations, approve the private numerical
model, start the separate calculation worker, or enable billing.
