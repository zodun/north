#!/usr/bin/env bash
# Fails if a server-only env var name appears in a file that ships
# to a client (browser bundle or React Native bundle).
#
# Rule of thumb (DEC-15):
#   - NEXT_PUBLIC_* / EXPO_PUBLIC_* are intentionally public; allowed anywhere.
#   - Everything else (DEEPSEEK_API_KEY, SUPABASE_SERVICE_ROLE_KEY,
#     CLOUDINARY_URL, SUMMARY_TRIGGER_SECRET, …) must NEVER appear
#     in client-bundlable paths.
#
# Allowed server-only paths (these never reach the client bundle):
#   - apps/web/src/middleware.ts            (runs on the edge runtime)
#   - apps/web/src/lib/supabase-server.ts   (server-only helper)
#   - apps/web/src/app/admin/**             (server components only)
#   - apps/web/src/app/api/**               (route handlers)
#   - apps/web/src/app/auth/**              (route handlers)
#   - packages/env/src/server.ts            (server env schema)
#   - packages/supabase/src/server.ts       (service-role client)
#   - supabase/**                           (Edge Functions + migrations)

set -euo pipefail

SECRET_PATTERNS=(
    "DEEPSEEK_API_KEY"
    "SUPABASE_SERVICE_ROLE_KEY"
    "CLOUDINARY_URL"
    "CLOUDINARY_API_KEY"
    "CLOUDINARY_API_SECRET"
    "SUMMARY_TRIGGER_SECRET"
    "POSTHOG_API_KEY"
    "GOOGLE_OAUTH_CLIENT_SECRET"
    "APPLE_OAUTH_CLIENT_SECRET"
)

# Paths that are client-bundlable.
CLIENT_GLOBS=(
    "apps/web/src/app/page.tsx"
    "apps/web/src/app/layout.tsx"
    "apps/web/src/app/login"
    "apps/web/src/app/north"
    "apps/web/src/components"
    "apps/web/src/lib/auth-client.ts"
    "apps/native"
    "packages/ui/src"
    "packages/env/src/web.ts"
    "packages/env/src/native.ts"
    "packages/supabase/src/browser.ts"
    "packages/supabase/src/native.ts"
)

# Build a pipe-delimited grep pattern.
PATTERN=$(IFS='|'; echo "${SECRET_PATTERNS[*]}")

found_violations=0
for glob in "${CLIENT_GLOBS[@]}"; do
    if [ ! -e "$glob" ]; then continue; fi
    # --include filters by extension; -r recurses; -E enables alternation.
    # Exclude .env files (they're not bundled), node_modules, .next.
    matches=$(grep -REn \
        --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" \
        --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.expo \
        "($PATTERN)" "$glob" 2>/dev/null || true)
    if [ -n "$matches" ]; then
        echo "✘ Secret name in client-bundlable path: $glob"
        echo "$matches" | sed 's/^/    /'
        echo
        found_violations=$((found_violations + 1))
    fi
done

if [ $found_violations -gt 0 ]; then
    cat <<'EOF'

This check (DEC-15) prevents server-only env vars from reaching a
client bundle. If you genuinely need this value on the client, prefix
it with NEXT_PUBLIC_ (web) or EXPO_PUBLIC_ (native) so the leak is
deliberate and reviewable. Otherwise, move the call to a server
component, route handler, middleware, Edge Function, or admin server
action.

See docs/secrets.md for the full pattern.
EOF
    exit 1
fi

echo "✓ No client-bundle secret leaks."
