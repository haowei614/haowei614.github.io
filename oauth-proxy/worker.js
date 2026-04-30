const DEFAULT_OWNER = "haowei614";
const DEFAULT_REPO = "haowei614.github.io";
const DEFAULT_BRANCH = "master";
const DEFAULT_SITE_ORIGIN = "https://haowei614.github.io";
const DEFAULT_ALLOWED_LOGINS = "haowei614";
const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(request, env) });
    }

    try {
      if (url.pathname === "/auth") {
        return handleAuth(url, env);
      }
      if (url.pathname === "/callback") {
        return handleCallback(url, env);
      }
      if (url.pathname === "/parse" && request.method === "POST") {
        return jsonResponse(await handleParse(request, env), request, env);
      }
      if (url.pathname === "/publish" && request.method === "POST") {
        return jsonResponse(await handlePublish(request, env), request, env);
      }
      if (url.pathname === "/health") {
        return jsonResponse({ ok: true }, request, env);
      }

      return new Response("Decap OAuth proxy and Smart Update API are running.", {
        headers: corsHeaders(request, env),
      });
    } catch (err) {
      const status = err.status || 500;
      return jsonResponse({ error: err.message || "Unexpected error" }, request, env, status);
    }
  },
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function corsHeaders(request, env) {
  const origin = request.headers.get("origin") || "";
  const allowed = allowedOrigins(env);
  const allowOrigin = allowed.has(origin) || origin.startsWith("http://127.0.0.1") || origin.startsWith("http://localhost")
    ? origin
    : siteOrigin(env);

  return {
    "access-control-allow-origin": allowOrigin,
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,authorization",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

function jsonResponse(data, request, env, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...corsHeaders(request, env),
    },
  });
}

function siteOrigin(env) {
  return env.SITE_ORIGIN || DEFAULT_SITE_ORIGIN;
}

function allowedOrigins(env) {
  return new Set(
    [siteOrigin(env), ...(env.EXTRA_ALLOWED_ORIGINS || "").split(",")]
      .map((x) => x.trim())
      .filter(Boolean)
  );
}

function repoConfig(env) {
  return {
    owner: env.GITHUB_OWNER || DEFAULT_OWNER,
    repo: env.GITHUB_REPO || DEFAULT_REPO,
    branch: env.GITHUB_BRANCH || DEFAULT_BRANCH,
  };
}

function githubAuthorizeUrl({ clientId, redirectUri, scope, state }) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope,
    state,
  });
  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

function randomHex(bytes = 8) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

function handleAuth(url, env) {
  const provider = url.searchParams.get("provider");
  if (provider !== "github") {
    return new Response("Invalid provider", { status: 400 });
  }

  if (!env.GITHUB_OAUTH_ID) {
    return new Response("Missing GITHUB_OAUTH_ID secret", { status: 500 });
  }

  const scope = env.GITHUB_REPO_PRIVATE === "1" ? "repo,user" : "public_repo,user";
  const redirectUri = `${url.origin}/callback?provider=github`;
  const authorizationUri = githubAuthorizeUrl({
    clientId: env.GITHUB_OAUTH_ID,
    redirectUri,
    scope,
    state: randomHex(8),
  });

  return Response.redirect(authorizationUri, 302);
}

async function handleCallback(url, env) {
  const provider = url.searchParams.get("provider");
  if (provider !== "github") {
    return new Response("Invalid provider", { status: 400 });
  }

  if (!env.GITHUB_OAUTH_ID || !env.GITHUB_OAUTH_SECRET) {
    return new Response("Missing GitHub OAuth secrets", { status: 500 });
  }

  const code = url.searchParams.get("code");
  if (!code) {
    return new Response("Missing OAuth code", { status: 400 });
  }

  const redirectUri = `${url.origin}/callback?provider=github`;
  const token = await exchangeCodeForToken({
    clientId: env.GITHUB_OAUTH_ID,
    clientSecret: env.GITHUB_OAUTH_SECRET,
    code,
    redirectUri,
  });

  if (!token) {
    return new Response("GitHub token exchange failed", { status: 502 });
  }

  const tokenJson = JSON.stringify(token);
  const body = `<!doctype html>
<html>
  <body>
    <script>
      const receiveMessage = () => {
        window.opener.postMessage(
          'authorization:github:success:' + JSON.stringify({ token: ${tokenJson} }),
          '*'
        );
        window.removeEventListener('message', receiveMessage, false);
        window.close();
      };
      window.addEventListener('message', receiveMessage, false);
      window.opener.postMessage('authorizing:github', '*');
    </script>
    <p>Authorizing...</p>
  </body>
</html>`;

  return new Response(body, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

async function exchangeCodeForToken({ clientId, clientSecret, code, redirectUri }) {
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!res.ok) return null;
  const data = await res.json();
  return data.access_token || null;
}

async function handleParse(request, env) {
  await requireAuthorizedUser(request, env);
  const body = await request.json();
  const text = String(body.text || "").trim();
  const requestedKind = normalizeKind(body.kind || "auto");

  if (!text) throw new HttpError(400, "Missing update text.");

  if (env.OPENAI_API_KEY) {
    return parseWithOpenAI({ text, requestedKind, env });
  }

  const parsed = parseHeuristically(text, requestedKind);
  parsed.warnings = [
    ...(parsed.warnings || []),
    "OPENAI_API_KEY is not configured, so a simple fallback parser was used.",
  ];
  return parsed;
}

async function handlePublish(request, env) {
  const { token, user } = await requireAuthorizedUser(request, env);
  const body = await request.json();
  const kind = normalizeKind(body.kind);
  if (kind === "auto") throw new HttpError(400, "Publish requires kind=publication or kind=update.");

  const cfg = repoConfig(env);
  const files = Array.isArray(body.files) ? body.files : [];
  let item = kind === "publication" ? normalizePublication(body.item || {}) : normalizeUpdate(body.item || {});

  const uploadChanges = [];
  const uploadedPaths = [];
  files.forEach((file, index) => {
    const uploaded = prepareUploadChange(kind, item, file, index);
    if (!uploaded) return;
    uploadChanges.push(uploaded.change);
    uploadedPaths.push(uploaded.publicPath);

    if (kind === "publication") {
      if (uploaded.role === "pdf" && !item.pdf) item.pdf = uploaded.publicPath;
      if (uploaded.role === "poster" && !item.poster) item.poster = uploaded.publicPath;
    } else {
      item.images = [...(item.images || []), uploaded.publicPath];
    }
  });

  const dataPath = kind === "publication" ? "data/publications.json" : "data/updates.json";
  const dataFile = await getRepositoryFile({ token, cfg, path: dataPath });
  const data = JSON.parse(dataFile.text || "{\"items\":[]}");
  const items = Array.isArray(data.items) ? data.items : [];

  item.id = ensureUniqueId(kind, item, items);
  items.push(item);
  data.items = items.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

  const jsonChange = {
    path: dataPath,
    content: JSON.stringify(data, null, 2) + "\n",
    encoding: "utf-8",
  };

  const commit = await commitChanges({
    token,
    cfg,
    changes: [...uploadChanges, jsonChange],
    message: commitMessage(kind, item, user.login),
  });

  return {
    ok: true,
    kind,
    id: item.id,
    item,
    uploadedPaths,
    commitUrl: commit.html_url,
    commitSha: commit.sha,
  };
}

async function requireAuthorizedUser(request, env) {
  const token = bearerToken(request);
  if (!token) throw new HttpError(401, "Missing GitHub token. Please login first.");

  const user = await githubApi("/user", token);
  const allowed = new Set((env.ALLOWED_GITHUB_LOGINS || DEFAULT_ALLOWED_LOGINS).split(",").map((x) => x.trim()).filter(Boolean));
  if (!allowed.has(user.login)) {
    throw new HttpError(403, `GitHub user ${user.login} is not allowed to update this site.`);
  }

  return { token, user };
}

function bearerToken(request) {
  const header = request.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

async function parseWithOpenAI({ text, requestedKind, env }) {
  const today = new Date().toISOString().slice(0, 10);
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            "You normalize academic website updates into strict JSON.",
            `Today is ${today}.`,
            "Return only JSON with this top-level shape: {\"kind\":\"publication|update\",\"item\":{},\"warnings\":[]}.",
            "If requested kind is auto, choose publication for papers, accepted manuscripts, DOI/arXiv/publisher links, journals, conferences, or workshops with paper metadata. Choose update for activities, talks, awards, visits, jobs, and general news.",
            "Publication item fields: id, title, authors, venue, year, date, tags, abstract, pdf, poster, code, project, doi, externalUrl, featured, status.",
            "Update item fields: id, title, date, summary, content, links, images, category, pinned, status.",
            "Use YYYY-MM-DD dates. Use arrays for tags, links, images. Use published status by default. Do not invent PDF paths, DOI, external URLs, or exact dates if they are absent.",
            "For missing fields, use empty strings, false booleans, or empty arrays. Put uncertainty in warnings.",
          ].join(" "),
        },
        {
          role: "user",
          content: JSON.stringify({ requestedKind, text }),
        },
      ],
      temperature: 0.1,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new HttpError(502, `OpenAI parsing failed: ${body}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new HttpError(502, "OpenAI returned an empty response.");

  const parsed = JSON.parse(content);
  const kind = normalizeKind(parsed.kind);
  if (kind === "auto") throw new HttpError(502, "OpenAI did not choose a concrete content kind.");

  return {
    kind,
    item: kind === "publication" ? normalizePublication(parsed.item || {}) : normalizeUpdate(parsed.item || {}),
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
  };
}

function parseHeuristically(text, requestedKind) {
  const kind = requestedKind === "auto" ? guessKind(text) : requestedKind;
  const date = extractDate(text) || new Date().toISOString().slice(0, 10);
  const title = extractQuoted(text) || firstSentence(text);
  const links = extractLinks(text).map((url) => ({ label: "Link", url }));

  if (kind === "publication") {
    return {
      kind,
      item: normalizePublication({
        title,
        authors: extractAfter(text, /authors?\s*(?:are|:)\s*([^.\n]+)/i),
        venue: extractAfter(text, /venue\s*(?:is|:)\s*([^.\n]+)/i) || extractAfter(text, /\b(?:at|accepted by|accepted to)\s+([^.\n]+)/i),
        year: Number(date.slice(0, 4)),
        date,
        tags: extractTags(text),
        abstract: "",
        externalUrl: links[0]?.url || "",
        featured: /featured|首页|主页/.test(text),
        status: "published",
      }),
      warnings: ["Fallback parser used; please review all fields before publishing."],
    };
  }

  return {
    kind,
    item: normalizeUpdate({
      title,
      date,
      summary: firstSentence(text),
      content: text,
      links,
      category: /award|selected|scholarship|获奖|奖/.test(text) ? "award" : /present|talk|报告|发表/.test(text) ? "talk" : "event",
      pinned: /pin|pinned|置顶|首页|主页/.test(text),
      status: "published",
    }),
    warnings: ["Fallback parser used; please review all fields before publishing."],
  };
}

function normalizeKind(kind) {
  if (kind === "publication" || kind === "update" || kind === "auto") return kind;
  throw new HttpError(400, "Invalid kind. Use auto, publication, or update.");
}

function guessKind(text) {
  return /paper|publication|accepted|journal|conference|doi|arxiv|论文|发表|接收/i.test(text) ? "publication" : "update";
}

function normalizePublication(input) {
  const date = normalizeDate(input.date);
  const year = Number(input.year || date.slice(0, 4) || new Date().getFullYear());
  return {
    id: String(input.id || ""),
    title: String(input.title || "").trim(),
    authors: String(input.authors || "").trim(),
    venue: String(input.venue || "").trim(),
    year,
    date,
    tags: normalizeStringArray(input.tags),
    abstract: String(input.abstract || "").trim(),
    pdf: String(input.pdf || "").trim(),
    poster: String(input.poster || "").trim(),
    code: String(input.code || "").trim(),
    project: String(input.project || "").trim(),
    doi: String(input.doi || "").trim(),
    externalUrl: String(input.externalUrl || "").trim(),
    featured: Boolean(input.featured),
    status: input.status === "draft" ? "draft" : "published",
  };
}

function normalizeUpdate(input) {
  return {
    id: String(input.id || ""),
    title: String(input.title || "").trim(),
    date: normalizeDate(input.date),
    summary: String(input.summary || "").trim(),
    content: String(input.content || "").trim(),
    links: normalizeLinks(input.links),
    images: normalizeStringArray(input.images),
    category: ["event", "talk", "award", "paper", "job", "other"].includes(input.category) ? input.category : "event",
    pinned: Boolean(input.pinned),
    status: input.status === "draft" ? "draft" : "published",
  };
}

function normalizeDate(value) {
  const date = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : new Date().toISOString().slice(0, 10);
}

function normalizeStringArray(value) {
  if (Array.isArray(value)) return value.map((x) => String(x || "").trim()).filter(Boolean);
  if (typeof value === "string") return value.split(",").map((x) => x.trim()).filter(Boolean);
  return [];
}

function normalizeLinks(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((link) => ({
      label: String(link.label || "Link").trim(),
      url: String(link.url || "").trim(),
    }))
    .filter((link) => link.url);
}

function prepareUploadChange(kind, item, file, index) {
  if (!file || !file.base64 || !file.name) return null;
  if (Number(file.size || 0) > 24 * 1024 * 1024) {
    throw new HttpError(400, `${file.name} is larger than 24 MB.`);
  }

  const ext = extensionFor(file);
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  const titleSlug = slugify(item.title || item.summary || "upload");
  const date = item.date || new Date().toISOString().slice(0, 10);
  const isPdf = ext === ".pdf" || file.type === "application/pdf";
  const isImage = /^image\//.test(file.type || "");

  let path;
  let role;
  if (kind === "publication" && isPdf) {
    path = `assets/pdf/publications/${item.year || date.slice(0, 4)}-${titleSlug}-${stamp}${ext}`;
    role = "pdf";
  } else if (kind === "publication" && isImage) {
    path = `assets/img/publications/${item.year || date.slice(0, 4)}-${titleSlug}-${index + 1}-${stamp}${ext}`;
    role = "poster";
  } else if (kind === "update" && isImage) {
    path = `assets/img/news/${date}-${titleSlug}-${index + 1}-${stamp}${ext}`;
    role = "image";
  } else {
    throw new HttpError(400, `Unsupported file for ${kind}: ${file.name}`);
  }

  return {
    role,
    publicPath: `/${path}`,
    change: {
      path,
      content: cleanBase64(file.base64),
      encoding: "base64",
    },
  };
}

function extensionFor(file) {
  const match = String(file.name || "").toLowerCase().match(/\.[a-z0-9]+$/);
  if (match) return match[0] === ".jpeg" ? ".jpg" : match[0];
  if (file.type === "application/pdf") return ".pdf";
  if (file.type === "image/jpeg") return ".jpg";
  if (file.type === "image/png") return ".png";
  if (file.type === "image/webp") return ".webp";
  if (file.type === "image/gif") return ".gif";
  return ".bin";
}

function cleanBase64(value) {
  return String(value || "").replace(/^data:[^,]+,/, "").replace(/\s+/g, "");
}

function ensureUniqueId(kind, item, items) {
  const existing = new Set(items.map((x) => x.id).filter(Boolean));
  if (item.id && !existing.has(item.id)) return item.id;

  const prefix = kind === "publication" ? "pub" : "upd";
  const year = kind === "publication" ? String(item.year || new Date().getFullYear()) : String((item.date || "").slice(0, 4) || new Date().getFullYear());
  let max = 0;
  const re = new RegExp(`^${prefix}-${year}-(\\d+)$`);
  existing.forEach((id) => {
    const match = String(id).match(re);
    if (match) max = Math.max(max, Number(match[1]));
  });
  return `${prefix}-${year}-${String(max + 1).padStart(3, "0")}`;
}

function commitMessage(kind, item, login) {
  const label = kind === "publication" ? "publication" : "update";
  return `Add ${label}: ${item.title || item.id}\n\nSubmitted by ${login} via Smart Update.`;
}

async function getRepositoryFile({ token, cfg, path }) {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const data = await githubApi(`/repos/${cfg.owner}/${cfg.repo}/contents/${encodedPath}?ref=${encodeURIComponent(cfg.branch)}`, token);
  if (!data.content) throw new HttpError(502, `GitHub did not return content for ${path}.`);
  return {
    sha: data.sha,
    text: decodeBase64(data.content),
  };
}

async function commitChanges({ token, cfg, changes, message }) {
  if (!changes.length) throw new HttpError(400, "No changes to commit.");

  const ref = await githubApi(`/repos/${cfg.owner}/${cfg.repo}/git/ref/heads/${encodeURIComponent(cfg.branch)}`, token);
  const headSha = ref.object.sha;
  const headCommit = await githubApi(`/repos/${cfg.owner}/${cfg.repo}/git/commits/${headSha}`, token);

  const treeEntries = [];
  for (const change of changes) {
    const blob = await githubApi(`/repos/${cfg.owner}/${cfg.repo}/git/blobs`, token, {
      method: "POST",
      body: JSON.stringify({
        content: change.content,
        encoding: change.encoding,
      }),
    });
    treeEntries.push({
      path: change.path,
      mode: "100644",
      type: "blob",
      sha: blob.sha,
    });
  }

  const tree = await githubApi(`/repos/${cfg.owner}/${cfg.repo}/git/trees`, token, {
    method: "POST",
    body: JSON.stringify({
      base_tree: headCommit.tree.sha,
      tree: treeEntries,
    }),
  });

  const commit = await githubApi(`/repos/${cfg.owner}/${cfg.repo}/git/commits`, token, {
    method: "POST",
    body: JSON.stringify({
      message,
      tree: tree.sha,
      parents: [headSha],
    }),
  });

  await githubApi(`/repos/${cfg.owner}/${cfg.repo}/git/refs/heads/${encodeURIComponent(cfg.branch)}`, token, {
    method: "PATCH",
    body: JSON.stringify({
      sha: commit.sha,
      force: false,
    }),
  });

  return commit;
}

async function githubApi(path, token, options = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "user-agent": "haowei614-smart-update",
      "x-github-api-version": "2022-11-28",
      ...(options.headers || {}),
    },
  });

  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch (err) {
    data = { message: text };
  }

  if (!res.ok) {
    throw new HttpError(res.status, data.message || `GitHub API failed: ${res.status}`);
  }
  return data;
}

function decodeBase64(value) {
  const clean = String(value || "").replace(/\s+/g, "");
  const bytes = Uint8Array.from(atob(clean), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function slugify(value) {
  const slug = String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
  return slug || "item";
}

function extractDate(text) {
  const match = text.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (!match) return "";
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

function extractQuoted(text) {
  const match = text.match(/["“「『]([^"”」』]{6,})["”」』]/);
  return match ? match[1].trim() : "";
}

function firstSentence(text) {
  return String(text || "").split(/[.\n。]/).find(Boolean)?.trim() || "New update";
}

function extractAfter(text, pattern) {
  const match = text.match(pattern);
  return match ? match[1].trim() : "";
}

function extractLinks(text) {
  return String(text || "").match(/https?:\/\/[^\s)]+/g) || [];
}

function extractTags(text) {
  const match = text.match(/(?:tags?|keywords?|关键词)\s*(?:are|:|为)?\s*([^.\n]+)/i);
  return match ? match[1].split(/[,，、]/).map((x) => x.trim()).filter(Boolean) : [];
}
