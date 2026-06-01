# Stratus — Production Deploy Runbook

> Last updated: 2026-06-01

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Secrets management (Doppler)](#2-secrets-management-doppler)
3. [Database (Neon Postgres)](#3-database-neon-postgres)
4. [Deploy web → Vercel](#4-deploy-web--vercel)
5. [Deploy API → Scaleway](#5-deploy-api--scaleway)
6. [Deploy Agent → Scaleway](#6-deploy-agent--scaleway)
7. [DNS (stratus.tax)](#7-dns-stratustax)
8. [Monitoring & alerting](#8-monitoring--alerting)
9. [Onboard Enderix Finance](#9-onboard-enderix-finance)
10. [Pre-flight checklist (YC submission)](#10-pre-flight-checklist-yc-submission)
11. [Rollback procedure](#11-rollback-procedure)

---

## 1. Prerequisites

### CLI tools
```sh
npm i -g vercel@latest
brew install scaleway-cli k6
pip install doppler-cli
```

### Accounts needed
| Service        | URL                          | Notes                         |
|----------------|------------------------------|-------------------------------|
| Vercel         | vercel.com                   | Connect GitHub repo           |
| Scaleway       | console.scaleway.com         | fr-par region, Serverless     |
| Neon           | console.neon.tech            | Postgres 16, fr-paris         |
| Qdrant Cloud   | cloud.qdrant.io              | 1 cluster, 1 GB free tier     |
| Clerk          | dashboard.clerk.com          | Production instance           |
| Doppler        | doppler.com                  | stratus/production config     |
| Sentry         | sentry.io                    | 3 projects: web, api, agent   |
| Resend         | resend.com                   | Domain verified: stratus.tax  |
| Better Uptime  | betteruptime.com             | 3 monitors                    |

---

## 2. Secrets management (Doppler)

```sh
# Login and setup project
doppler login
doppler setup --project stratus --config production

# Inject secrets for any command
doppler run -- pnpm build
doppler run -- node dist/main
```

### Required secrets

**Shared**
```
DATABASE_URL=postgresql://...@neon.tech/stratus?sslmode=require
```

**apps/web** (set in Vercel env vars)
```
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_...
CLERK_SECRET_KEY=sk_live_...
NEXT_PUBLIC_API_URL=https://api.stratus.tax
NEXT_PUBLIC_SENTRY_DSN=https://...@sentry.io/...
NEXT_PUBLIC_POSTHOG_KEY=phc_...
RESEND_API_KEY=re_...
```

**apps/api** (Scaleway container env)
```
DATABASE_URL=...
CLERK_SECRET_KEY=sk_live_...
SENTRY_DSN=https://...@sentry.io/...
WEB_URL=https://stratus.tax
RESEND_API_KEY=re_...
NODE_ENV=production
```

**apps/agent** (Scaleway container env)
```
ANTHROPIC_API_KEY=sk-ant-...
QDRANT_URL=https://xxx.qdrant.io
QDRANT_API_KEY=...
SENTRY_DSN=https://...@sentry.io/...
APP_ENV=production
GIT_COMMIT_SHA=${CI_COMMIT_SHA}
```

---

## 3. Database (Neon Postgres)

```sh
# 1. Create project in Neon console: stratus-prod, region: fr-paris
# 2. Copy DATABASE_URL (pooled connection string)
# 3. Run migrations
DATABASE_URL="..." pnpm --filter @stratus/api exec prisma migrate deploy

# 4. Verify
DATABASE_URL="..." pnpm --filter @stratus/api exec prisma db execute \
  --stdin <<< "SELECT count(*) FROM organizations;"
```

**Connection pool settings** (set in Neon console):
- Pool mode: `transaction`
- Max connections: `25`
- Min pool size: `2`

---

## 4. Deploy web → Vercel

```sh
cd apps/web

# First deploy (links project)
vercel --prod

# Subsequent deploys (CI does this automatically on push to main)
vercel --prod --token $VERCEL_TOKEN
```

### Vercel project settings
- Framework preset: **Next.js**
- Root directory: `apps/web`
- Build command: `pnpm --filter web build`
- Output: `.next`
- Node version: **20**

### After first deploy
1. Add custom domain `stratus.tax` in Vercel dashboard
2. Set all env vars from section 2
3. Enable **Analytics** (Vercel built-in)
4. Enable **Speed Insights**

---

## 5. Deploy API → Scaleway

```sh
# 1. Authenticate
scw init  # paste API key + secret key

# 2. Create registry namespace (once)
scw registry namespace create name=stratus region=fr-par

# 3. Build and push
docker build -t rg.fr-par.scw.cloud/stratus/api:latest \
  -f apps/api/Dockerfile .
docker push rg.fr-par.scw.cloud/stratus/api:latest

# 4. Deploy container
scw container container create \
  --from-file infra/scaleway/api.yaml \
  region=fr-par

# Or update existing container (after first deploy)
CONTAINER_ID=$(scw container container list region=fr-par -o json \
  | jq -r '.[] | select(.name=="stratus-api") | .id')
scw container container update $CONTAINER_ID \
  image-uri=rg.fr-par.scw.cloud/stratus/api:latest \
  region=fr-par

# 5. Inject secrets (one-time, stored in Scaleway secret manager)
scw container container update $CONTAINER_ID \
  environment-variables.DATABASE_URL="$(doppler secrets get DATABASE_URL --plain)" \
  environment-variables.CLERK_SECRET_KEY="$(doppler secrets get CLERK_SECRET_KEY --plain)" \
  environment-variables.SENTRY_DSN="$(doppler secrets get SENTRY_DSN_API --plain)" \
  region=fr-par
```

### Smoke test
```sh
curl https://api.stratus.tax/health
# Expected: {"status":"ok","checks":{"database":"ok"},...}
```

---

## 6. Deploy Agent → Scaleway

```sh
# Build and push
docker build -t rg.fr-par.scw.cloud/stratus/agent:latest \
  -f apps/agent/Dockerfile apps/agent/
docker push rg.fr-par.scw.cloud/stratus/agent:latest

# Deploy
scw container container create \
  --from-file infra/scaleway/agent.yaml \
  region=fr-par

# Smoke test (internal — agent is private)
# Proxy through API:
curl https://api.stratus.tax/v1/agent/health
```

---

## 7. DNS (stratus.tax)

| Record | Type  | Value                            |
|--------|-------|----------------------------------|
| `@`    | A     | `76.76.21.21` (Vercel)           |
| `www`  | CNAME | `cname.vercel-dns.com`           |
| `api`  | CNAME | `<container-id>.containers.fnc.fr-par.scw.cloud` |

TTL: 300s during first deploy, then 3600s.

### Verify
```sh
dig stratus.tax A +short
dig api.stratus.tax CNAME +short
curl -I https://stratus.tax  # should return 200
```

---

## 8. Monitoring & alerting

### Better Uptime monitors
Create 3 monitors (30-second interval, alert threshold: 2 failures):

| Monitor         | URL                                 | Alert to        |
|-----------------|-------------------------------------|-----------------|
| Web health      | `https://stratus.tax/api/health`    | email + Slack   |
| API health      | `https://api.stratus.tax/health`    | email + Slack   |
| Agent health    | `https://api.stratus.tax/v1/agent/health` | email    |

### Sentry alerts
For each project (web, api, agent), set:
- Error rate spike: alert if > 5 new issues / 5 min
- P95 latency: alert if > 10 s
- New issue: alert always

### PostHog dashboards
Key metrics to track post-launch:
- `beta_signup` — daily signups
- `fec_upload` → `classification_complete` funnel — conversion rate
- `ca3_computed` per week — activation metric
- `chat_message_sent` — engagement

---

## 9. Onboard Enderix Finance

```sh
# 1. Create Clerk org for Enderix in dashboard
#    → copy org ID (org_xxx) and user ID for ACK (user_xxx)

# 2. Run seed
CLERK_ORG_ID=org_xxx \
CLERK_USER_ID=user_xxx \
DATABASE_URL="$(doppler secrets get DATABASE_URL --plain)" \
pnpm tsx apps/api/prisma/seed-enderix.ts

# 3. Upload real FEC files (3 months: Oct-Dec 2024)
#    Via dashboard: /dashboard/clients/enderix-finance-sas → Import FEC
#    Or via API:
for month in 202410 202411 202412; do
  curl -X POST https://api.stratus.tax/v1/fec-imports \
    -H "Authorization: Bearer $CLERK_SESSION_TOKEN" \
    -H "x-org-id: $ORG_ID" \
    -F "file=@FEC_Enderix_${month}.txt" \
    -F "fiscal_client_id=enderix-finance-sas"
done

# 4. Trigger classification for each import
# (done automatically if auto-classify is enabled, otherwise via dashboard)

# 5. Compute CA3 for each month
# → Dashboard: declarations → Generate → Review → Do NOT file (demo mode)

# 6. Confirm with Enderix that CA3 figures match their records
#    → If deltas found, open GitHub issue for agent calibration
```

---

## 10. Pre-flight checklist (YC submission)

Run through this list the day before submitting the YC application.

### Functional
- [ ] Homepage loads at `https://stratus.tax` — hero, sections, beta form
- [ ] Beta signup form submits and sends confirmation email
- [ ] Dashboard loads after Clerk sign-in
- [ ] FEC upload works (try `load-tests/sample.txt` — 10-row FEC)
- [ ] Classification returns results in < 10 s for small FEC
- [ ] CA3 form is populated after classification
- [ ] XML download produces valid `<Echange>` document
- [ ] Chat returns an answer to "Quel est le crédit TVA reportable ?"
- [ ] Audit tab shows events for a validated declaration
- [ ] `/pricing`, `/audit-by-design`, `/about` render correctly

### Infrastructure
- [ ] `GET https://stratus.tax/api/health` → `{"status":"ok"}`
- [ ] `GET https://api.stratus.tax/health` → `{"status":"ok","checks":{"database":"ok"}}`
- [ ] Better Uptime all monitors green
- [ ] Sentry 0 unresolved errors (web + api + agent)
- [ ] Neon DB dashboard: no slow queries > 2 s

### Security
- [ ] All endpoints except `/health` and `POST /v1/beta-signups` require Clerk auth
- [ ] `NEXT_PUBLIC_*` env vars contain no secrets
- [ ] HTTPS enforced on all domains (check Vercel + Scaleway httpOption)
- [ ] Security headers present (`X-Content-Type-Options`, `X-Frame-Options`)

### Demo (Enderix Finance)
- [ ] Enderix org provisioned in Clerk + DB
- [ ] 3 months of FECs imported and classified
- [ ] At least 1 CA3 declaration in `validated` state
- [ ] AC Kamgang can log in and navigate the full flow

### E2E
- [ ] `pnpm --filter web exec playwright test` passes all 3 suites
- [ ] Latest CI run on `main` is green (check GitHub Actions)

### Metrics (optional but impressive)
- [ ] PostHog has at least 1 beta signup tracked
- [ ] Sentry release linked to current git SHA

---

## 11. Rollback procedure

### Web (Vercel)
```sh
# List recent deployments
vercel ls

# Rollback to previous deployment
vercel rollback <deployment-url>
```

### API / Agent (Scaleway)
```sh
# Re-deploy previous image tag
docker pull rg.fr-par.scw.cloud/stratus/api:v0.1.0  # replace with previous tag
docker tag  rg.fr-par.scw.cloud/stratus/api:v0.1.0 \
            rg.fr-par.scw.cloud/stratus/api:latest
docker push rg.fr-par.scw.cloud/stratus/api:latest

scw container container update $CONTAINER_ID \
  image-uri=rg.fr-par.scw.cloud/stratus/api:latest \
  region=fr-par
```

### Database
```sh
# Rollback last migration (only if no data loss)
DATABASE_URL="..." pnpm --filter @stratus/api exec prisma migrate resolve \
  --rolled-back <migration_name>

# For destructive rollbacks: restore from Neon point-in-time backup
# → Neon console → Branches → Restore to point in time
```
