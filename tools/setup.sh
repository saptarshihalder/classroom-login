#!/usr/bin/env bash
# Stands up the sync workspace on Cloudflare and points it at this repository.
#
#   bash tools/setup.sh
#
# Everything it asks for is typed in, never written to disk. The Google project
# and OAuth client have to be made in a browser first; the README says which
# screens.

set -euo pipefail

SITE_URL=${SITE_URL:-https://saptarshihalder.github.io/classroom-login/}
BUCKET=${BUCKET:-course-board-files}

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

step 'Creating the state store and the file bucket'
printf 'name = "course-boards"\nmain = "src/index.js"\ncompatibility_date = "2026-08-20"\n' > wrangler.toml
npx wrangler r2 bucket create "$BUCKET" 2>&1 | grep -v 'already exists' || true
made=$(npx wrangler kv namespace create STATE 2>&1) || fail "$made"
printf '%s\n' "$made"
kv=$(printf '%s' "$made" | grep -oE '[0-9a-f]{32}' | head -1 || true)
if [ -z "$kv" ]; then
  read -r -p 'Paste the namespace id shown above: ' kv < /dev/tty
fi
printf '%s' "$kv" | grep -qE '^[0-9a-f]{32}$' || fail "That does not look like a namespace id: $kv"

step 'Writing the settings'
sed -e "s|replace-with-kv-id|$kv|" \
    -e "s|^SITE_URL = .*|SITE_URL = \"$SITE_URL\"|" \
    -e "s|^bucket_name = .*|bucket_name = \"$BUCKET\"|" \
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

if [ -n "$url" ]; then
  step 'Pointing the site at the workspace'
  node -e "const f='../data/site.json',fs=require('fs');const j=JSON.parse(fs.readFileSync(f));j.api=process.argv[1];fs.writeFileSync(f,JSON.stringify(j,null,2)+'\n')" "$url"
fi

printf '\n\033[32mThe workspace is up.\033[0m\n'
if [ -n "$url" ]; then
  cat <<TXT

  workspace   $url
  site        $SITE_URL

Two things left.

1. In the browser, open the Google OAuth client and add this exact address
   under Authorized redirect URIs:

     $url/oauth

2. data/site.json has been pointed at the workspace. Commit and push it so
   the site knows where to look:

     git add data/site.json && git commit -m "point the site at the workspace" && git push

Then anyone enrolled can open the workspace, sign in, and put their course up.
TXT
else
  echo 'Could not read the address back. Find it in the Cloudflare dashboard under'
  echo 'Workers, then add <that address>/oauth to the Google OAuth client.'
fi
