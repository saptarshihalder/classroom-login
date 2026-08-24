#!/usr/bin/env bash
# Stands up the sync workspace on Cloudflare and points it at this repository.
#
#   bash tools/setup.sh
#
# Everything it asks for is typed in, never written to disk. The Google project
# and OAuth client have to be made in a browser first; the README says which
# screens.

set -euo pipefail

ADMIN_EMAIL=${ADMIN_EMAIL:-}
OWNER=${OWNER:-saptarshihalder}
REPO=${REPO:-classroom-login}
BRANCH=${BRANCH:-main}
SITE_URL=${SITE_URL:-https://saptarshihalder.github.io/classroom-login/}

step(){ printf '\n\033[36m-- %s\033[0m\n' "$1"; }
fail(){ printf '\n\033[31m%s\033[0m\n' "$1" >&2; exit 1; }

ask_secret(){
  local value
  read -r -s -p "$1: " value < /dev/tty
  printf '\n' >&2
  printf '%s' "$value"
}

put_secret(){
  local name=$1 value=$2
  [ -n "$value" ] || fail "$name was blank, so nothing was stored."
  printf '%s' "$value" | npx wrangler secret put "$name" || fail "Could not store $name."
}

command -v node >/dev/null 2>&1 || fail 'Node.js is not installed. Get it from https://nodejs.org and run this again.'

here=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
[ -f "$here/worker/wrangler.toml.example" ] || fail 'Run this from inside the repository, it expects a worker folder beside tools.'
cd "$here/worker"

step 'Installing what the worker needs'
npm install --no-fund --no-audit

step 'Cloudflare account'
if npx wrangler whoami 2>&1 | grep -q 'not authenticated'; then
  echo 'A browser window will open. Approve it, then come back here.'
  npx wrangler login || fail 'Cloudflare sign-in did not finish.'
else
  echo 'Already signed in.'
fi

if [ -z "$ADMIN_EMAIL" ]; then
  read -r -p 'Google account allowed to publish: ' ADMIN_EMAIL < /dev/tty
fi
[ -n "$ADMIN_EMAIL" ] || fail 'That account is needed, it is the only one the dashboard will let in.'

step 'Creating the state store'
printf 'name = "course-board-sync"\nmain = "src/index.js"\ncompatibility_date = "2026-08-20"\n' > wrangler.toml
made=$(npx wrangler kv namespace create STATE 2>&1) || fail "$made"
printf '%s\n' "$made"
kv=$(printf '%s' "$made" | grep -oE '[0-9a-f]{32}' | head -1 || true)
if [ -z "$kv" ]; then
  read -r -p 'Paste the namespace id shown above: ' kv < /dev/tty
fi
printf '%s' "$kv" | grep -qE '^[0-9a-f]{32}$' || fail "That does not look like a namespace id: $kv"

step 'Writing the settings'
sed -e "s|replace-with-kv-id|$kv|" \
    -e "s|you@example.com|$ADMIN_EMAIL|" \
    -e "s|^GITHUB_OWNER = .*|GITHUB_OWNER = \"$OWNER\"|" \
    -e "s|^GITHUB_REPO = .*|GITHUB_REPO = \"$REPO\"|" \
    -e "s|^GITHUB_BRANCH = .*|GITHUB_BRANCH = \"$BRANCH\"|" \
    -e "s|^PUBLIC_SITE_URL = .*|PUBLIC_SITE_URL = \"$SITE_URL\"|" \
    wrangler.toml.example > wrangler.toml
grep -v '^#' wrangler.toml

step 'Deploying'
out=$(npx wrangler deploy 2>&1) || fail "$out"
printf '%s\n' "$out"
url=$(printf '%s' "$out" | grep -oE 'https://[a-z0-9.-]+\.workers\.dev' | head -1 || true)

step 'Credentials'
echo 'Typed in here, stored with Cloudflare, never saved to this computer.'
put_secret GOOGLE_CLIENT_ID     "$(ask_secret 'Google client ID')"
put_secret GOOGLE_CLIENT_SECRET "$(ask_secret 'Google client secret')"
put_secret GITHUB_TOKEN         "$(ask_secret 'GitHub token that may update this repository')"

printf '\n\033[32mThe workspace is up.\033[0m\n'
if [ -n "$url" ]; then
  cat <<TXT

  workspace   $url
  board       $SITE_URL

One thing left, in the browser: open the Google OAuth client and add this exact
address under Authorized redirect URIs.

  $url/oauth

Then open the workspace on your phone, sign in, pick the course, sync, and
publish. The sign-in button on the board starts working by itself.
TXT
else
  echo 'Could not read the address back. Find it in the Cloudflare dashboard under'
  echo 'Workers, then add <that address>/oauth to the Google OAuth client.'
fi
