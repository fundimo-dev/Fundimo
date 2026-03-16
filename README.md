# Fundimo

Budgeting app backend (NestJS + Prisma + Postgres).

## Backend

### Prerequisites

- Node 18+ (pnpm recommended: `corepack enable && corepack prepare pnpm@9 --activate`)
- Docker (for Postgres) or local Postgres

### Setup

1. From repo root, install dependencies (required for the API and Plaid; without this you may see `Cannot find module 'plaid'` when starting the API):

   ```bash
   pnpm install
   ```

2. Copy env and set `DATABASE_URL` and `JWT_SECRET`:

   ```bash
   cp apps/api/.env.example apps/api/.env
   ```

3. Run migrations (with Postgres running, e.g. `docker compose up -d postgres`):

   ```bash
   pnpm -C apps/api prisma migrate dev
   ```

4. Seed the database (creates demo user):

   ```bash
   pnpm -C apps/api prisma db seed
   ```

### Run the API

```bash
pnpm -C apps/api start:dev
```

Or from root: `pnpm dev:api` (if configured in root `package.json`).

API runs at `http://localhost:3000` by default.

### Demo login

- **Email:** `demo@fundimo.local`  
- **Password:** `Password123!`

Example (all API routes are under `/api`):

```bash
curl -c cookies.txt -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"demo@fundimo.local","password":"Password123!"}'
```

Then call the current user endpoint with the stored cookie:

```bash
curl -b cookies.txt http://localhost:3000/api/me
```

Without the cookie, `GET /api/me` returns `401` with `error.code` `UNAUTHORIZED`.

---

### Plaid Sandbox (bank linking + transaction sync)

To use Plaid Link and transaction sync in **sandbox** mode:

1. In [Plaid Dashboard → Keys](https://dashboard.plaid.com/developers/keys), copy **Client ID** and **Sandbox** secret.
2. Generate a 32-byte encryption key (used to encrypt Plaid access tokens at rest):

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```

3. In `apps/api/.env`, set (all required if any Plaid env is set):

   - `PLAID_CLIENT_ID` — your Plaid Client ID  
   - `PLAID_SECRET` — Plaid **Sandbox** secret  
   - `PLAID_ENV=sandbox`  
   - `APP_ENCRYPTION_KEY` — the base64 string from step 2  
  - `PLAID_REDIRECT_URI` — optional in sandbox; required for many OAuth institutions in development/production  
  - `PLAID_OAUTH_CONTINUE_URI` — optional backend redirect target back to app/web domain after OAuth callback  

4. Restart the API. If any of these are missing in a non-test environment, the app will fail fast on startup. Env is loaded from `apps/api/.env` (and from the process when running from repo root).

Endpoints (all require auth, under `/api`):

- **POST /api/plaid/link-token** — returns `{ link_token }` for Plaid Link  
- **POST /api/plaid/exchange** — body `{ public_token }`; exchanges token, creates PlaidItem + ConnectedAccounts, returns `{ accounts }` (no tokens)  
- **POST /api/plaid/sync** — manual sync of Plaid transactions into the app; returns `{ added, modified, removed }`  
- **GET /api/plaid/oauth-redirect** — OAuth callback endpoint for institutions that redirect through bank auth; forwards to `PLAID_OAUTH_CONTINUE_URI` when set  

Mock flows (**POST /api/accounts/mock-link**, seed data, mock transactions) continue to work; the UI shows both MOCK and PLAID accounts.

---

### Smoke test (Plaid link-token)

With the API running and Plaid env set in `apps/api/.env`:

```bash
# 1) Login (saves cookie)
curl -c cookies.txt -X POST http://127.0.0.1:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"demo@fundimo.local","password":"Password123!"}'

# 2) Get link token (expect 200 + JSON with link_token)
curl -i -b cookies.txt -X POST http://127.0.0.1:3000/api/plaid/link-token
```

**Expected when Plaid is configured:** `HTTP/1.1 200` and body like `{"link_token":"link-sandbox-..."}`.

**Expected when Plaid is not configured:** `400` with `error.code` `PLAID_NOT_CONFIGURED` and `error.message` listing missing keys (e.g. `PLAID_CLIENT_ID`, `PLAID_SECRET`, `APP_ENCRYPTION_KEY`). Set those in `apps/api/.env` and restart the API.
