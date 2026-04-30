# Decap CMS OAuth Proxy + Smart Update API

This folder contains a Cloudflare Worker used by:

- Decap CMS at `/admin/`
- Smart Update at `/admin/update.html`

Smart Update lets you paste a natural-language publication/activity update, optionally upload PDFs or images, preview normalized JSON, and publish it to GitHub Pages without editing code manually.
It also supports loading existing entries, editing them in place, and deleting them from the site.

## 1) Create GitHub OAuth App

In GitHub Developer Settings, create an OAuth App:

- Homepage URL: `https://<your-worker-domain>`
- Authorization callback URL: `https://<your-worker-domain>/callback`

Save:

- Client ID
- Client Secret

## 2) Deploy Worker

1. Install Wrangler:
   - `npm i -g wrangler`
2. In this folder, copy config:
   - `cp wrangler.toml.example wrangler.toml`
3. Login Cloudflare:
   - `wrangler login`
4. Set secrets:
   - `wrangler secret put GITHUB_OAUTH_ID`
   - `wrangler secret put GITHUB_OAUTH_SECRET`
   - `wrangler secret put OPENAI_API_KEY`
5. Deploy:
   - `wrangler deploy`

After deploy, note your worker URL, e.g.:

- `https://haowei614-decap-oauth.<subdomain>.workers.dev`

## 3) Update Decap config

In `admin/config.yml`, set:

```yml
backend:
  name: github
  repo: haowei614/haowei614.github.io
  branch: master
  base_url: https://<your-worker-domain>
  auth_endpoint: auth
  site_domain: haowei614.github.io
```

Important:

- Remove `auth_type`, `app_id`, and `auth_scope` for this external OAuth setup.
- If your repository is private, set `GITHUB_REPO_PRIVATE = "1"` in `wrangler.toml`.

## 4) Smart Update configuration

`wrangler.toml` contains non-secret defaults:

```toml
[vars]
GITHUB_REPO_PRIVATE = "0"
GITHUB_OWNER = "haowei614"
GITHUB_REPO = "haowei614.github.io"
GITHUB_BRANCH = "master"
SITE_ORIGIN = "https://haowei614.github.io"
ALLOWED_GITHUB_LOGINS = "haowei614"
OPENAI_MODEL = "gpt-4o-mini"
```

Secrets:

- `GITHUB_OAUTH_ID`: GitHub OAuth App client ID
- `GITHUB_OAUTH_SECRET`: GitHub OAuth App client secret
- `OPENAI_API_KEY`: OpenAI API key used only inside the Worker

If `OPENAI_API_KEY` is missing, Smart Update still works with a simple fallback parser, but you should review the preview carefully.

If you want the backend editor to access existing items, update them, and delete them, the Worker also exposes:

- `GET /items?kind=publication|update`
- `POST /save`
- `POST /delete`

If you change the Worker URL, update `WORKER_BASE` in:

```text
admin/update.js
admin/config.yml
```

## 5) Use Smart Update

Open:

```text
https://haowei614.github.io/admin/update.html
```

You can also add a shortcut button on the homepage to this path, which is already wired in the latest site version.

Workflow:

1. Login with GitHub.
2. Choose Auto detect, Publication, or Activity / News.
3. Paste a plain-language update.
4. Optionally attach files.
   - Publication PDF files are saved under `assets/pdf/publications/`.
   - Publication image files are saved as poster images under `assets/img/publications/`.
   - Activity image files are saved under `assets/img/news/`.
5. Click `Parse & Preview`.
6. Review and edit the normalized fields.
7. Click `Publish to GitHub`.

The Worker commits:

- uploaded files
- updated `data/publications.json` or `data/updates.json`

GitHub Pages then rebuilds the site automatically.

## 6) Verify

Open `https://haowei614.github.io/admin/` and click "Login with GitHub".

Expected behavior:

- Popup goes to your worker domain `/auth`, then GitHub authorize page, then `/callback`.
- It should no longer use `https://api.netlify.com/auth`.

For Smart Update, open `https://haowei614.github.io/admin/update.html`, log in, use a sample update, and confirm the Worker returns a commit URL after publishing.
