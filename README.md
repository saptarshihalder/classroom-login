# PDE board

A public, read-only copy of a Google Classroom course: announcements, notes and
the attachments themselves, at one link anyone can open.

The board is a static site. It reads `data/feed.json` and the files committed
under `files/`, so no Google credentials, session cookies or repository token
ever reach a visitor's browser.

Everything that talks to Google lives in `worker/`. It signs one account in,
reads the course, keeps the full sync in private Cloudflare KV, and publishes
only what has been selected: the feed, and a copy of each attachment.

## the board

Three views, matching the shape of the course:

- **Stream** — announcements and material newest first, the way the class sees them
- **Classwork** — material grouped by the course's own topics
- **Files** — every published handout, with an inline viewer for PDFs and images

Each file also has its own link (`#file=files/...`), so one set of notes can be
shared on its own without sending someone the whole board.

Run it locally with:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`.

Deployment is `.github/workflows/pages.yml`. In **Settings → Pages**, set the
source to **GitHub Actions**. The published address is:

`https://saptarshihalder.github.io/classroom-login/`

## the sync workspace

`worker/` is a Cloudflare Worker. It serves the sign-in and publishing screens,
and runs a scheduled sync every ten minutes.

### 1. Google Cloud

Create a Google Cloud project, enable the **Google Classroom API** and the
**Google Drive API**, then configure an OAuth consent screen with these scopes:

```text
openid
email
profile
https://www.googleapis.com/auth/classroom.courses.readonly
https://www.googleapis.com/auth/classroom.announcements.readonly
https://www.googleapis.com/auth/classroom.courseworkmaterials.readonly
https://www.googleapis.com/auth/classroom.topics.readonly
https://www.googleapis.com/auth/classroom.rosters.readonly
https://www.googleapis.com/auth/drive.readonly
```

Create an OAuth **Web application** client. Once the worker is deployed, add its
`/oauth` address as an authorized redirect URI:

```text
https://YOUR-WORKER.workers.dev/oauth
```

A mismatch here is the most common setup failure.

`drive.readonly` is one of Google's restricted scopes, which has a practical
consequence: while the OAuth app sits in **Testing**, refresh authorization
expires after seven days and the scheduled sync stops until you sign in again.
The dashboard says so when it happens. For a sync that keeps running, move the
app to production, or publish it as an internal app if the account belongs to a
Workspace organisation.

### 2. Cloudflare

```bash
cd worker
npm install
cp wrangler.toml.example wrangler.toml
npx wrangler kv namespace create STATE
```

Put the returned namespace id in `wrangler.toml` and set `ADMIN_EMAIL` to the
one Google account allowed to publish.

Secrets stay out of git:

```bash
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put GITHUB_TOKEN
```

`GITHUB_TOKEN` only needs permission to update repository contents here.

```bash
npx wrangler deploy
```

### 3. Publishing

Open the worker address on your phone, sign in, pick the course, and press
**sync now**. Nothing is public yet: select the posts you want and press
**publish selected**, or turn **auto-publish** on to have every new post go
straight to the board. After the first sign-in the worker writes its own
address into `data/site.json`, which is what wires up the sign-in button on the
public site.

## attachments

Published attachments are copied into `files/` in this repository and served
from the same site as the board:

- ordinary Drive files are copied as they are
- Docs, Slides, Sheets and Drawings are exported to PDF
- links, forms and videos stay as links to their original home
- anything above `MAX_FILE_MB` (20 by default) is left out and reported in the dashboard

Attachments are fetched a few per run so a sync stays inside a scheduled run's
budget; the board marks the rest as still being copied and the next run picks
them up. Removing a post from the board deletes its files from the repository
too, unless another published post still uses them.

Only publish material you are allowed to pass on. Course handouts are often
someone else's copyright, and the point of the selection step is that you decide
file by file rather than mirroring a course wholesale by accident.

## feed format

The worker writes `data/feed.json`:

```json
{
  "course": {
    "name": "Partial Differential Equations",
    "short": "PDE",
    "section": "MA 4021",
    "room": "LT-4",
    "about": "Announcements and shared course material",
    "teachers": ["R. Mukherjee"]
  },
  "updated": "2026-08-24T03:00:00.000Z",
  "items": [
    {
      "id": "material:123",
      "kind": "material",
      "title": "Problem set 2",
      "text": "Attempt every question before Friday.",
      "author": "R. Mukherjee",
      "topic": "Week 3",
      "created": "2026-08-24T01:15:00.000Z",
      "links": [],
      "files": [
        {"name": "Problem set 2.pdf", "path": "files/problem-set-2-d4e5f6.pdf", "size": 184320, "type": "pdf"}
      ],
      "pending": 0,
      "blocked": 0
    }
  ]
}
```

`kind` is `post` for an announcement or `material` for classwork material.
`pending` counts attachments still being copied, `blocked` counts the ones that
could not be.

## checks

```bash
node tools/verify.mjs      # feed shape, file paths, page references
cd worker && npm test      # sync and feed-building tests
```

CI runs both on every push, along with a syntax pass and a scan for committed
credentials.
