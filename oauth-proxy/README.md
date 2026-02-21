# Decap CMS OAuth Proxy (Cloudflare Worker)

This folder contains a minimal OAuth proxy for Decap CMS + GitHub backend.

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

## 4) Verify

Open `https://haowei614.github.io/admin/` and click "Login with GitHub".

Expected behavior:

- Popup goes to your worker domain `/auth`, then GitHub authorize page, then `/callback`.
- It should no longer use `https://api.netlify.com/auth`.

