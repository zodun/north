# Supabase projects (dev + prod)

Per operating-doc DEC-16. North runs against two remote Supabase projects — `north-dev` and `north-prod` — plus the operator's local Supabase Docker stack for day-to-day development.

| Environment | Project | URL | Used by |
| --- | --- | --- | --- |
| **local** | `supabase/config.toml` (Docker) | `http://127.0.0.1:54321` | `bun run dev:*`, hooks, ad-hoc psql |
| **dev** | `north-dev` (free tier) | `https://<dev-ref>.supabase.co` | CI auto-deploy of migrations, preview/internal builds, demo data |
| **prod** | `north-prod` (free until traffic warrants Pro) | `https://<prod-ref>.supabase.co` | Production native + admin |

Local stays the fast loop; dev is the always-running shared remote that always reflects `main`; prod is hand-applied.

## One-time operator setup

Do all of this once per operator (or once per Supabase org).

### 1 · Create the two projects

Easiest: **Dashboard**. Sign in at <https://supabase.com/dashboard>, click *New project*, twice:

- Name `north-dev` · Region `East US (N. Virginia)` · DB password: generate + store (1Password / Bitwarden) · Tier: Free
- Name `north-prod` · Region `East US (N. Virginia)` · DB password: generate + store · Tier: Free (upgrade to Pro when warranted)

(Region rationale: closest to the Caribbean target audience among free-tier regions.)

CLI alternative (requires a paid org for project-create via API):

```bash
export SUPABASE_ACCESS_TOKEN=sbp_...
supabase projects create north-dev  --org-id <org> --region us-east-1 --db-password "$(openssl rand -hex 16)"
supabase projects create north-prod --org-id <org> --region us-east-1 --db-password "$(openssl rand -hex 16)"
```

### 2 · Populate `supabase/projects.json`

```bash
cp supabase/projects.example.json supabase/projects.json
```

Edit, pasting each project's ref (the slug in the dashboard URL — `xxxxxxxxxxxxxxxxxxxx`):

```json
{
  "dev":  { "ref": "abcdef1234567890",   "region": "us-east-1", "url": "https://abcdef1234567890.supabase.co" },
  "prod": { "ref": "ghijkl1234567890",   "region": "us-east-1", "url": "https://ghijkl1234567890.supabase.co" }
}
```

`projects.json` is gitignored — every developer/CI keeps their own copy.

### 3 · Get a personal access token

Create one at <https://supabase.com/dashboard/account/tokens>. Export it:

```bash
export SUPABASE_ACCESS_TOKEN=sbp_...
```

Add the same value to your shell profile so it's always set.

### 4 · Link locally + apply baseline migrations

```bash
# Dev
bun run supabase:link:dev
supabase db push              # applies migrations 0001–0009 to north-dev
supabase functions deploy signal-summary

# Prod (only when you're ready — no auto-deploy)
bun run supabase:link:prod
supabase db push
supabase functions deploy signal-summary
```

After each `supabase db push`, set the per-environment `pg_cron` settings:

```bash
# Replace <env-ref> with the dev or prod ref.
supabase db remote exec "
  alter database postgres set app.functions_url = 'https://<env-ref>.supabase.co/functions/v1';
  alter database postgres set app.summary_trigger_secret = '<same value as SUMMARY_TRIGGER_SECRET>';
"
```

(See `docs/north-core-metrics-spec.md` DEC-07 appendix for what these settings do.)

### 5 · Per-environment Supabase secrets

For each project, set the Edge Function env. Re-link first, then run:

```bash
supabase secrets set DEEPSEEK_API_KEY=sk-...
supabase secrets set SUMMARY_TRIGGER_SECRET=$(openssl rand -hex 32)
```

You can use the same DeepSeek key across environments if cost-tracking via the dashboard is sufficient; use distinct keys if you want per-environment cost reports.

### 6 · Web admin host env

In the host's env-var UI (Vercel / Cloudflare Pages / Fly), set:

```
APP_ENV=production
NEXT_PUBLIC_SUPABASE_URL=https://<prod-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<prod anon key from Settings → API>
SUPABASE_URL=https://<prod-ref>.supabase.co
SUPABASE_ANON_KEY=<same anon key>
SUPABASE_SERVICE_ROLE_KEY=<prod service-role key>
CORS_ORIGIN=https://<admin domain>
DEEPSEEK_API_KEY=<if admin server actions call DeepSeek>
SUMMARY_TRIGGER_SECRET=<same as Supabase secret>
```

For dev preview deployments (if you spin one up), use the dev project's keys and `APP_ENV=development`.

### 7 · EAS secrets for native

The DEC-13 EAS profiles map to environments like this:

| EAS profile | Supabase project | EAS secret values |
| --- | --- | --- |
| `dev` | north-dev | dev URL + dev anon |
| `preview` | north-prod | prod URL + prod anon |
| `production` | north-prod | prod URL + prod anon |

```bash
cd apps/native
eas secret:create --scope project --name EXPO_PUBLIC_SUPABASE_URL --value https://<dev-ref>.supabase.co --environment dev
eas secret:create --scope project --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value <dev anon> --environment dev
eas secret:create --scope project --name EXPO_PUBLIC_SUPABASE_URL --value https://<prod-ref>.supabase.co --environment preview
eas secret:create --scope project --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value <prod anon> --environment preview
eas secret:create --scope project --name EXPO_PUBLIC_SUPABASE_URL --value https://<prod-ref>.supabase.co --environment production
eas secret:create --scope project --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value <prod anon> --environment production
```

### 8 · CI auto-deploy

CI auto-deploys migrations + the `signal-summary` Edge Function to **dev** on every merge to `main` (see `.github/workflows/ci.yml` job `deploy-migrations-dev`). Set two repository secrets at <https://github.com/Pricetagjmd/north/settings/secrets/actions>:

| Secret | Value |
| --- | --- |
| `SUPABASE_ACCESS_TOKEN` | Your personal access token (same one you exported locally) |
| `SUPABASE_DEV_PROJECT_REF` | The dev project's ref (e.g., `abcdef1234567890`) |

The job is gated by `if: github.event_name == 'push' && github.ref == 'refs/heads/main'` so PRs don't accidentally apply migrations.

### 9 · Clean up the legacy local `.env`

If `apps/web/.env` still references `BETTER_AUTH_*`, `POLAR_*`, or `DATABASE_URL`, it's left over from the pre-DEC-06 scaffold and will fail `@t3-oss/env` validation. Replace it from the updated `.env.example`:

```bash
mv apps/web/.env apps/web/.env.bak
cp apps/web/.env.example apps/web/.env
$EDITOR apps/web/.env   # paste in the dev (or local) values
```

## Social-provider OAuth setup (DEC-18)

The v0 stack ships **Google + Apple** as the two social-sign-in providers (per DEC-18). Skip this section if you're not yet running social sign-in.

### Google (web + iOS + Android)

1. Open <https://console.cloud.google.com> → *APIs & Services* → *Credentials*.
2. Create three OAuth 2.0 Client IDs in the same Google project:
   - **Web** — authorised redirect: `https://<dev-ref>.supabase.co/auth/v1/callback` (and the prod equivalent). Used by Supabase for the web `signInWithOAuth` flow + by expo-auth-session as the OIDC issuer on native.
   - **iOS** — bundle ID `app.north.client`.
   - **Android** — package name `app.north.client` + the SHA-1 of your Expo / EAS signing key (`eas credentials` to fetch).
3. Populate env vars:
   - Supabase (per environment, via the host's env UI + `apps/web/.env`):
     - `GOOGLE_OAUTH_CLIENT_ID` = web client ID
     - `GOOGLE_OAUTH_CLIENT_SECRET` = web client secret
   - EAS / native (via `eas secret:create --scope project`):
     - `EXPO_PUBLIC_GOOGLE_OAUTH_IOS_CLIENT_ID`
     - `EXPO_PUBLIC_GOOGLE_OAUTH_ANDROID_CLIENT_ID`
     - `EXPO_PUBLIC_GOOGLE_OAUTH_WEB_CLIENT_ID`

### Apple (iOS + web)

1. <https://developer.apple.com/account/resources/identifiers/list> → enable **Sign in with Apple** capability on the `app.north.client` App ID.
2. Create a **Services ID** (e.g., `app.north.client.web`) for the web flow; set Return URLs to `https://<dev-ref>.supabase.co/auth/v1/callback` (and prod equivalent).
3. Create a **Sign in with Apple key** (`.p8`) and download it. Capture the Key ID + your Team ID.
4. Generate the client secret JWT (Supabase docs cover the script; rotate every 6 months).
5. Populate env vars:
   - `APPLE_OAUTH_CLIENT_ID` = the Services ID (web) for Supabase's web flow.
   - `APPLE_OAUTH_CLIENT_SECRET` = the generated client-secret JWT.

   On native, Sign in with Apple uses the device's own credentials via `expo-apple-authentication` — no env vars needed beyond `app.json`'s `usesAppleSignIn: true` (already set per DEC-18).

### Apply Supabase config

`supabase/config.toml` already enables `[auth.external.google]` and `[auth.external.apple]` with `env(...)` substitution (DEC-18). For the hosted projects: in the Supabase Dashboard → *Authentication* → *Providers*, paste the same client IDs + secrets. (`config.toml` only applies to local; hosted needs Dashboard config.)

### Verify

- Web: open `/login` → "Continue with Google" / "Continue with Apple" should appear above the magic-link field. Click through to confirm a session lands in `auth.users` with `app_metadata.provider = 'google'` (or `'apple'`).
- Native: on an EAS dev build, the buttons render (Google when client IDs are set; Apple only on iOS 13+). Tapping should produce a session.

## Cloudinary setup (DEC-20)

The admin app uploads media to Cloudinary via a server-side signed-upload flow (DEC-20). Skip this section if you're not yet hosting any content via Cloudinary (the link-out path of DEC-10 doesn't require it).

1. Create an account at <https://cloudinary.com>. Free tier covers v0 traffic.
2. From the Cloudinary console, grab the cloud name + API key + API secret. *Treat the API secret as sensitive — it never reaches the client.*
3. Populate env vars per environment:
   - Web admin host (Vercel / CF / Fly): `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` (same value as `CLOUDINARY_CLOUD_NAME` — the `NEXT_PUBLIC_` copy is what the browser bundle reads).
   - Local dev: same four in `apps/web/.env`.
4. Optional: create a Cloudinary upload preset named `north-content` (Settings → Upload → Add upload preset) if you want server-side transformations on every upload. The Widget defaults work without one.
5. Verify: visit `/admin/content` as an allow-listed admin → "Upload to Cloudinary" button is visible → upload a test image → row appears in `content_items` with `cloudinary_public_id` populated, `license_type = 'cloudinary-hosted'`, `license_status = 'draft'`. Flipping `license_status` to `cleared` (and filling `attribution_text`) makes the image readable by anon clients via the existing RLS predicate.

## Firebase Cloud Messaging setup (DEC-21)

Operating doc §8.1 commits to FCM as the push platform. The native app uses bare FCM/APNs tokens (`Notifications.getDevicePushTokenAsync()`), not the Expo Push Service proxy — operator-owned, direct delivery.

1. **Create one Firebase project per Supabase environment.** Suggested names: `north-fcm-dev`, `north-fcm-prod`. (Mirroring the Supabase split keeps dev pushes from accidentally hitting prod devices.)
2. **Register the apps** in each Firebase project:
   - iOS app — bundle ID `app.north.client`. Upload an APNs Authentication Key (`.p8`) under *Project Settings → Cloud Messaging → Apple app config*. Capture the Key ID + your Apple Team ID.
   - Android app — package name `app.north.client`. Add the SHA-1 of your EAS signing key (`eas credentials` from `apps/native/` fetches it).
3. **Download the per-platform config files**:
   - `GoogleService-Info.plist` (iOS) — *Project Settings → General → Your apps → iOS → GoogleService-Info.plist*.
   - `google-services.json` (Android) — same place under the Android app.
4. **Place them locally** for `expo start` and `eas build --local`:
   ```
   apps/native/google-services/GoogleService-Info.plist
   apps/native/google-services/google-services.json
   ```
   The `apps/native/.gitignore` blocks `google-services/` so these files stay per-developer.
5. **EAS secrets per profile** so cloud builds receive the right config:
   ```bash
   cd apps/native
   eas secret:create --type file --scope project --name GoogleService-Info.plist \
       --value ./google-services/GoogleService-Info.plist --environment dev
   eas secret:create --type file --scope project --name google-services.json \
       --value ./google-services/google-services.json --environment dev
   # Repeat with --environment preview / production using the prod project's files.
   ```
6. **Verify** on a real device (push doesn't work in simulators):
   - `bun run build:dev:ios` (or `:android`), install on device.
   - Sign in; check `public.push_tokens` — a row appears with `platform = 'ios'|'android'` and the FCM/APNs token.
   - Server-side push *send* lands later (FR-NOT-* in M2/M3); this PR only wires the credential collection side.

## Day-to-day workflow

- **Default**: work against local Supabase (`supabase start`, `bun run dev:web` / `dev:native`). Fastest loop; no remote billing exposure.
- **Need to test a migration against real-shape data**: link to dev (`bun run supabase:link:dev`), `supabase db push`, run the app pointing at the dev URL.
- **Touching prod**: link to prod explicitly, `supabase db push`, verify, then unlink (`supabase unlink`) so subsequent commands fall back to local.

Switching between dev and prod link state is cheap — just re-run the link script — but accidentally running `supabase db reset` against a linked prod is not. The CLI prints the linked project ref on every command; double-check it.

## Future work

- **Supabase branching** for per-PR preview DBs. Requires Pro tier on the prod project; not in v0. When wired in, every PR gets an ephemeral DB seeded from a snapshot — useful when migration review needs side-by-side comparison.
- **Tag-triggered prod deploys**. `supabase db push` on git tag `v*` would automate prod releases; out of v0 scope.
- **Disaster-recovery runbook**. Supabase handles backups on Pro+; documenting RPO/RTO + restore steps is its own DEC when prod is on Pro.
