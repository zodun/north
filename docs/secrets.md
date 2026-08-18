# Secrets management

Per operating-doc DEC-15. The rule for every secret: **never store it in the repo, never bundle it to a client, never share it across environments by accident.**

For per-environment Supabase project provisioning (dev + prod), CI auto-deploy setup, and the full per-environment setup runbook, see **[`docs/supabase-projects.md`](./supabase-projects.md)** (DEC-16). This document is the secret-handling philosophy + the leak-check mechanism; that document is the operator's checklist.

## The pattern: native per platform

There is no central secret store (no Doppler, no Vault). Each platform that needs a secret manages its own:

| Where | What | How |
|---|---|---|
| **Supabase Edge Functions** | `DEEPSEEK_API_KEY`, `SUMMARY_TRIGGER_SECRET`, `POSTHOG_API_KEY` (for server events) | `supabase secrets set NAME=value` |
| **Cloudinary** | `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` (server-only); `CLOUDINARY_CLOUD_NAME` + `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` (cloud name is public) | Host env (Vercel/CF/Fly); local `apps/web/.env` |
| **Supabase Postgres** (for `pg_cron` calls) | `app.functions_url`, `app.summary_trigger_secret` | `alter database postgres set app.<name> = '<value>'` |
| **Next.js admin (`apps/web`)** | `SUPABASE_SERVICE_ROLE_KEY`, `DEEPSEEK_API_KEY` (if used), `CORS_ORIGIN` | Host's env (Vercel/Cloudflare/local `.env`) |
| **Expo native (`apps/native`)** build-time env | `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, future `EXPO_PUBLIC_POSTHOG_*` | `eas secret:create --scope project --name NAME --value value` |
| **Local development** | All of the above | `.env.example` files document required names; copy to `.env`, fill in values from a 1Password/Bitwarden vault (operator's choice; not in repo) |

## The naming rule (enforced by `scripts/check-client-bundle-secrets.sh`)

- **`NEXT_PUBLIC_*`** (web) and **`EXPO_PUBLIC_*`** (native) are intentionally bundled into the client. Use these only for values that are safe to publish — Supabase anon key, public PostHog token, public URLs.
- **Any other env var name** is server-only. It must never appear in:
  - `apps/web/src/components/`, `apps/web/src/app/login/`, `apps/web/src/app/north/`, or any other client-bundlable Next.js path
  - `apps/native/` (everything in the Expo bundle reaches the device)
  - `packages/ui/src/`, `packages/env/src/web.ts`, `packages/env/src/native.ts`, `packages/supabase/src/{browser,native}.ts`

The check script enumerates the protected names (`DEEPSEEK_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CLOUDINARY_URL`, `SUMMARY_TRIGGER_SECRET`, `POSTHOG_API_KEY`) and the client-bundlable paths. Add to either list as the project grows.

## Where checks run

1. **Pre-push hook** (lefthook): runs `scripts/check-client-bundle-secrets.sh` locally before `git push`. Bypass with `git push --no-verify` for emergencies.
2. **CI** (GitHub Actions, `.github/workflows/ci.yml`): runs the same script. Push-bypass is moot because the CI gate runs after the push lands.
3. **Manual**: `bun run check:secrets`.

If the check finds a violation, the fix is one of:
- Move the call to a server-only path (route handler, middleware, server component, Edge Function).
- If the value is genuinely public, rename it with the `NEXT_PUBLIC_` / `EXPO_PUBLIC_` prefix so the leak is deliberate and reviewable.
- If neither applies, the design is wrong — talk to it through.

## Setting up secrets for each environment

### Supabase (Edge Functions + Postgres `pg_cron`)

```bash
# Edge Function secrets
supabase secrets set DEEPSEEK_API_KEY=sk-...
supabase secrets set SUMMARY_TRIGGER_SECRET=$(openssl rand -hex 32)
supabase secrets set MISSION_TRIGGER_SECRET=$(openssl rand -hex 32)
supabase secrets set NOTIF_TRIGGER_SECRET=$(openssl rand -hex 32)

# FCM (Android push)
supabase secrets set FIREBASE_SERVICE_ACCOUNT_JSON='{ "project_id": "...", "client_email": "...", "private_key": "..." }'

# APNs (iOS push) — download .p8 key from Apple Developer → Certificates, Identifiers & Profiles
supabase secrets set APNS_TEAM_ID=XXXXXXXXXX
supabase secrets set APNS_KEY_ID=XXXXXXXXXX
supabase secrets set APNS_PRIVATE_KEY='-----BEGIN PRIVATE KEY-----
...
-----END PRIVATE KEY-----'
supabase secrets set APNS_BUNDLE_ID=com.north.app

# Postgres-side settings for pg_cron → Edge Functions
supabase db remote exec "alter database postgres set app.functions_url = 'https://<project-ref>.supabase.co/functions/v1'"
supabase db remote exec "alter database postgres set app.summary_trigger_secret = '<same value as SUMMARY_TRIGGER_SECRET>'"
supabase db remote exec "alter database postgres set app.mission_trigger_secret = '<same value as MISSION_TRIGGER_SECRET>'"
supabase db remote exec "alter database postgres set app.notif_trigger_secret = '<same value as NOTIF_TRIGGER_SECRET>'"

# Deploy Edge Functions
supabase functions deploy signal-summary
supabase functions deploy daily-mission
supabase functions deploy send-notifications
```

### Web admin (`apps/web`)

For local dev: `cp apps/web/.env.example apps/web/.env` and fill in. For deployment: configure the same variables in the host's dashboard (Vercel, Cloudflare Pages, Fly, etc.).

```
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
CORS_ORIGIN=https://admin.north.app
```

### Native (`apps/native`)

For local dev with `expo start`: `cp apps/native/.env.example apps/native/.env`. For EAS builds:

```bash
cd apps/native
eas secret:create --scope project --name EXPO_PUBLIC_SUPABASE_URL --value https://<project-ref>.supabase.co
eas secret:create --scope project --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value <anon-key>
```

The native app **never** receives the service-role key or the OpenAI key — those calls go through Edge Functions (`signal-summary`) or the admin app's server actions.

## Rotation

A secret rotation flips the value at the *source* (Supabase, EAS, host dashboard) and then redeploys / restarts the relevant service. There is no central rotation pipeline in v0; if rotation cadence becomes a recurring chore, that's the moment to introduce Doppler (a future DEC).

## What we deliberately don't do (v0)

- **Doppler / Vault / 1Password Connect** — none of these in v0. Native per-platform is fewer moving parts; revisit if the project grows past one developer or the rotation chore becomes painful.
- **Encrypted env files in git** (`git-crypt`, SOPS) — same reasoning; the platforms above already provide encryption-at-rest for their secret stores.
- **Auto-injecting secrets into CI** — CI uses stub values for the Supabase build-time env validation, never real keys. No CI step needs a real secret in v0.
