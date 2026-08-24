# Course boards

Somewhere to put a course's announcements and notes so people outside the class
can read them. Anyone enrolled in a course can sign in, pick it, choose what
should be public, and hand out one link.

Readers never sign in. They get a directory of courses and a board per course
with the stream, the classwork grouped by topic, and every shared file.

## how it is put together

Two halves, deployed separately:

- the **site** is static and lives on GitHub Pages: a directory (`index.html`),
  a board (`board.html?c=<course>`) and a sign-in page
- the **workspace** is a Cloudflare Worker: it holds the Google sign-ins, syncs
  each connected course, serves the public API, and streams published
  attachments from Google Drive when a reader opens one

The site knows where the workspace is from one field, `api`, in
`data/site.json`. Nothing else is wired between them, and no credential ever
reaches a reader's browser.

```
reader ──▶ Pages (directory, board)
              │  fetch /api/board/<course>, /f/<course>/…
              ▼
          Worker ──▶ KV (who published what)
              └──▶ Google Classroom + Drive, as the account that connected it
```

## who can publish what

A board belongs to the course, not to a person. Whoever connects a course first
creates its board; anyone else enrolled who connects the same course joins as
another publisher of the same board rather than making a second one.

Publishers choose post by post what readers see. A board stays invisible until
it is explicitly put up, and taking it down hides it at once.

Only publish material you are allowed to pass on. Course handouts are often
someone else's copyright, and choosing post by post is what keeps that a
decision rather than an accident.

## running the site

```bash
python -m http.server 8000
```

Deployment is `.github/workflows/pages.yml`; in **Settings → Pages** set the
source to **GitHub Actions**.

## running the workspace

### 1. Google Cloud

Create a project, enable the **Google Classroom API** and the **Google Drive
API**, then configure an OAuth consent screen asking for:

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

Create an OAuth **Web application** client and keep the id and secret.

**How many people can publish.** While the OAuth app is unverified, Google
allows up to 100 accounts, each added as a test user, and their sign-in has to
be renewed every seven days. That is the mode this is built for. Two ways past
it: if the app is owned by a Google Workspace organisation, marking it
**Internal** removes both the cap and the renewal for that organisation's
accounts; going fully public means Google verification, and because
`drive.readonly` is a restricted scope, a paid third-party security assessment.
Readers are never affected by any of this.

### 2. Cloudflare

With step 1 done, a script does the rest. From the repository folder:

```bat
powershell -ExecutionPolicy Bypass -File tools\setup.ps1
```

or on macOS, Linux or WSL:

```bash
bash tools/setup.sh
```

It installs what the worker needs, signs in to Cloudflare in the browser,
creates the KV namespace, writes `wrangler.toml`, deploys,
takes the two Google credentials on the prompt, and points `data/site.json` at
the deployed address. Commit that file and the site starts talking to the
workspace.

Without a terminal, the same thing runs from the Actions tab: add
`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `GOOGLE_CLIENT_ID` and
`GOOGLE_CLIENT_SECRET` as repository secrets, then run the **workspace**
workflow once with *create the state store* ticked and once without.

Either way, finish by adding the workspace's `/oauth` address to the Google
OAuth client's authorized redirect URIs. A mismatch there is the usual failure.

## attachments

When a post is published, its Drive attachment metadata is prepared. Opening a
file streams it from Drive through the workspace, so no paid Cloudflare R2
subscription is needed:

- ordinary Drive files are streamed as they are
- Docs, Slides, Sheets and Drawings are streamed as PDF exports
- links, forms and videos stay as links to where they already live
- anything above `MAX_FILE_MB` (20) is left out and reported on the board

Files are prepared a few per run, so a board shows the rest as still pending
until the next scheduled run catches up. The scheduled run works through the
accounts `ACCOUNTS_PER_RUN` at a time, so one busy course cannot starve the
others.

## the API

Two public endpoints, both open to any origin:

| route | gives |
| --- | --- |
| `GET /api/directory` | every board that is up |
| `GET /api/board/<course>` | one board: course, posts, files |
| `GET /f/<course>/<id>/<name>` | one published Drive file, streamed on demand |

## checks

```bash
node tools/verify.mjs      # required files, site config, page references
cd worker && npm test      # slugs, board building, deletion, the directory
```

CI runs both on every push, with a syntax pass and a scan for committed
credentials.
