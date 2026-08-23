# PDE board

A read-only public course stream backed by Google Classroom.

The public site stays static. It reads only `data/feed.json`, so no Google credentials, session cookies or GitHub write token ever ship to the browser.

The sync side lives in `worker/`. It signs one admin into Google, reads the selected Classroom course, keeps the full sync in private Cloudflare KV, and writes only the items selected for publication into `data/feed.json`.

## what it mirrors

- published Classroom announcements
- published classwork materials and descriptions
- ordinary links, forms and YouTube material links
- the original post order and timestamps

Drive attachments are treated differently. A Classroom Drive file can still be access-controlled by its owner, so the worker does not proxy it or turn it public. Restricted Drive files are counted in the dashboard and withheld from the public JSON. If a PDF or note should be public, share a copy only when you have permission to redistribute it.

## public site

Run it locally with:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`.

GitHub Pages is already deployed by `.github/workflows/pages.yml`. In **Settings → Pages**, set the source to **GitHub Actions**.

The normal Pages address is:

`https://saptarshihalder.github.io/classroom-login/`

## sync worker

The worker gives you the mobile login/admin page and runs a scheduled sync every ten minutes.

### 1. Google Cloud

Create a Google Cloud project, enable **Google Classroom API**, then configure an OAuth consent screen.

Request only these scopes:

```text
openid
email
profile
https://www.googleapis.com/auth/classroom.courses.readonly
https://www.googleapis.com/auth/classroom.announcements.readonly
https://www.googleapis.com/auth/classroom.courseworkmaterials.readonly
```

Create an OAuth **Web application** client.

After the worker is deployed, add this redirect URI to the client:

```text
https://YOUR-WORKER.workers.dev/oauth
```

If the OAuth app remains in Google's **Testing** publishing state, Classroom refresh authorization expires after seven days. For a persistent scheduled sync, move the OAuth app to the appropriate production/internal state for your account or have the Workspace administrator trust the app.

### 2. Cloudflare

```bash
cd worker
npm install
cp wrangler.toml.example wrangler.toml
npx wrangler kv namespace create STATE
```

Put the returned KV namespace id in `wrangler.toml` and replace `ADMIN_EMAIL` with the one Google account allowed to manage the board.

Set secrets without putting them in git:

```bash
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put GITHUB_TOKEN
```

`GITHUB_TOKEN` only needs permission to update repository contents for this repository.

Deploy:

```bash
npx wrangler deploy
```

Open the worker URL on your phone, sign in with Google, choose the PDE Classroom course, and press **sync now**.

New synced posts stay private until selected. If you are allowed to mirror the whole course stream, use **publish all synced** once and then turn **auto-publish** on. After that, the ten-minute cron keeps the public board current.

### 3. OAuth redirect

Once the workers.dev address is known, make sure the Google OAuth client's exact authorized redirect URI is:

```text
https://YOUR-WORKER.workers.dev/oauth
```

A mismatch here is the most common setup failure.

## feed format

The worker writes:

```json
{
  "course": {
    "name": "Partial Differential Equations",
    "short": "PDE",
    "about": "Announcements and shared course material"
  },
  "updated": "2026-08-24T03:00:00.000Z",
  "items": [
    {
      "id": "announcement:123",
      "kind": "post",
      "author": "Course",
      "title": "",
      "text": "Tomorrow's room has changed.",
      "created": "2026-08-24T01:15:00.000Z",
      "links": [],
      "lockedCount": 0
    }
  ]
}
```

`kind` is `post` or `file`.

## checks

The CI workflow checks the browser script, worker syntax, JSON files, required paths, and obvious committed credential signatures.
