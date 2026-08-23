# PDE board

A small read-only course stream made for GitHub Pages.

The browser only reads `data/feed.json`. There are no account credentials, API keys or private tokens in the site bundle.

## run it

```bash
python -m http.server 8000
```

Open `http://localhost:8000`.

## feed shape

```json
{
  "updated": "2026-08-24T02:30:00+05:30",
  "items": [
    {
      "id": "p-1",
      "kind": "post",
      "author": "course",
      "title": "room change",
      "text": "Tomorrow's class is in AB1 316.",
      "created": "2026-08-24T01:15:00+05:30",
      "links": [
        {
          "label": "open file",
          "url": "https://example.com/file"
        }
      ]
    }
  ]
}
```

`kind` can be `post`, `work` or `file`.

## publish

The Pages workflow is already in `.github/workflows/pages.yml`.

In GitHub, open **Settings → Pages → Build and deployment** and set **Source** to **GitHub Actions**. Pushes to `main` will deploy the site.

The normal Pages address will be:

`https://saptarshihalder.github.io/classroom-login/`

## data source

Keep the public site dumb. Anything that is allowed to publish course updates should end by replacing `data/feed.json` with the small public-safe payload above.

If an automated source is ever approved by the course owner, keep its OAuth exchange, refresh credentials and API calls outside GitHub Pages. Put secrets only in a private server-side store or GitHub Actions secrets, then publish only the fields that are actually meant to be mirrored.

Never commit Google OAuth credentials, session cookies, access tokens or refresh tokens to this repository.

## checks

`.github/workflows/check.yml` does a JS syntax check, validates the feed JSON, checks the required files and rejects obvious credential strings.
