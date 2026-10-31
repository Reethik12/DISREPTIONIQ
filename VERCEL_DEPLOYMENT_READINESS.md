# Vercel Deployment Readiness & Guide

## Architecture Summary

DISRUPTIONIQ is built as a Node.js-native, zero-external-dependency platform. To make it deployable to Vercel without altering existing code or degrading the user experience, the following serverless deployment architecture has been implemented:

1. **Vercel Serverless Function Entrypoint (`api/index.js`)**:
   - Routes incoming HTTP requests into the core `server.js` request handler.
   - Preserves all session cookies (`diq_session`, `diq_csrf`), HTTP security headers, CORS origin checks, and RBAC route protection.
   - Supported on Node.js 22 runtime (matching `package.json` engines `>=22.13.0`).

2. **Routing & Static Asset Pipeline (`vercel.json`)**:
   - Pure static assets in `public/` (CSS stylesheets, client JavaScript, images, SVGs, fonts) are served directly by Vercel's global Edge CDN.
   - Protected application entry points (`/login`, `/app/*`, `/customer/*`), API endpoints (`/api/*`), and health monitoring (`/health`) are routed to `api/index.js`.
   - Function configuration bundles `public/**` to ensure server-side template serving (`app.html`, `login.html`, `customer.html`) remains functional.

3. **Database Architecture & Persistence**:
   - **Local Development**: Uses local SQLite in `./instance/disruptioniq.db`.
   - **Vercel Serverless Function**: Ephemeral scratch database is maintained in `/tmp/disruptioniq.db` across warm invocations.
   - **Production Persistence**: On stateless serverless platforms like Vercel, local disk storage is ephemeral. For long-term durable production data across distributed instances, migrate to a hosted PostgreSQL instance (e.g. Neon, Supabase) using the schema documented in `docs/PRODUCTION_POSTGRES_MIGRATION.md`.

---

## Required Environment Variables for Vercel

Configure these in the Vercel Dashboard under **Project Settings → Environment Variables**:

| Variable | Value / Description | Required? |
|---|---|---|
| `NODE_ENV` | `production` (default on Vercel) | Auto-set |
| `DEMO_MODE` | `true` for preview/demo deployment with built-in accounts; `false` in strict production | Recommended for preview |
| `WEBHOOK_SECRET` | Strong random secret string for carrier webhook validation | Required in production |
| `DEMO_HUB_PASSWORD` | Override default password for Hub In-Charge | Optional |
| `DEMO_RISK_PASSWORD` | Override default password for Risk Analyst | Optional |
| `DEMO_RECOVERY_PASSWORD` | Override default password for Recovery Manager | Optional |
| `DEMO_CUSTOMER_PASSWORD` | Override default password for Customer account | Optional |
| `DATABASE_URL` | Hosted PostgreSQL connection string (when migrating to hosted DB) | Optional / Future |
| `LLM_PROVIDER` | `none` (default deterministic), `openai-compatible`, or `gemini` | Optional |
| `LLM_API_KEY` | API key if external LLM explanations are enabled | Optional |

---

## Step-by-Step Vercel Deployment Instructions

### Method A: Deploy via Vercel Web Dashboard (Recommended)

1. Push your repository to GitHub (`main` branch):
   `https://github.com/Reethik12/DISREPTIONIQ`
2. Open [vercel.com](https://vercel.com) and log in.
3. Click **Add New… → Project**.
4. Import the **`Reethik12/DISREPTIONIQ`** repository.
5. In **Configure Project**:
   - **Framework Preset**: Other
   - **Root Directory**: `./` (leave default)
   - **Build Command**: `npm run build` (runs `node scripts/check.js`)
   - **Output Directory**: (leave empty)
6. Under **Environment Variables**, add:
   - `DEMO_MODE` = `true` (to test the 4 demo roles immediately on your preview URL)
   - `WEBHOOK_SECRET` = `<any-secure-random-string>`
7. Click **Deploy**.
8. Once built, open the generated `.vercel.app` URL:
   - Navigate to `/login`
   - Log in using any of the four roles documented in `START_HERE.txt`:
     - Hub In-Charge: `hub@disruptioniq.local` / `Hub@DIQ2026!`
     - Risk Analyst: `risk@disruptioniq.local` / `Risk@DIQ2026!`
     - Recovery Manager: `recovery@disruptioniq.local` / `Recover@DIQ2026!`
     - Customer: `customer@disruptioniq.local` / `Customer@DIQ2026!`

### Method B: Deploy via Vercel CLI

```bash
# Install Vercel CLI if not already installed
npm i -g vercel

# Link and deploy
vercel

# Deploy to production
vercel --prod
```
