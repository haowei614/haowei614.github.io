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
      if (url.pathname === "/items" && request.method === "GET") {
        return jsonResponse(await handleListItems(url, request, env), request, env);
      }
      if ((url.pathname === "/save" || url.pathname === "/publish") && request.method === "POST") {
        return jsonResponse(await handleSave(request, env), request, env);
      }
      if (url.pathname === "/delete" && request.method === "POST") {
        return jsonResponse(await handleDelete(request, env), request, env);
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

async function handleListItems(url, request, env) {
  await requireAuthorizedUser(request, env);
  const kind = normalizeKind(url.searchParams.get("kind") || "publication");
  const cfg = repoConfig(env);
  const items = await loadItemsForKind({ token: bearerToken(request), cfg, kind });
  return {
    kind,
    items: sortItems(items, kind),
  };
}

async function handleSave(request, env) {
  const { token, user } = await requireAuthorizedUser(request, env);
  const body = await request.json();
  const kind = normalizeKind(body.kind);
  if (kind === "auto") throw new HttpError(400, "Publish requires a concrete kind.");

  const cfg = repoConfig(env);
  const files = Array.isArray(body.files) ? body.files : [];
  const item = normalizeItem(kind, body.item || {});
  const existing = await loadItemsForKind({ token, cfg, kind });
  const previous = findExistingItem(existing, item, kind);
  const priorAttachments = previous ? attachmentPathsByKind(previous, kind) : {};
  if (!item.id) {
    item.id = ensureUniqueId(kind, item, existing);
  }
  if (kind === "project" && !item.slug) {
    item.slug = slugify(item.title || item.id || "project");
  }

  const uploadChanges = [];
  const uploadedPaths = [];
  const replacementDeletes = [];
  files.forEach((file, index) => {
    const uploaded = prepareUploadChange(kind, item, file, index);
    if (!uploaded) return;
    uploadChanges.push(uploaded.change);
    uploadedPaths.push(uploaded.publicPath);

    if (kind === "publication") {
      if (uploaded.role === "pdf") item.pdf = uploaded.publicPath;
      if (uploaded.role === "poster") item.poster = uploaded.publicPath;
    } else if (kind === "update") {
      item.images = [...(item.images || []), uploaded.publicPath];
    } else if (kind === "profile") {
      if (uploaded.role === "avatar") item.avatarUrl = uploaded.publicPath;
      if (uploaded.role === "cv") item.cvUrl = uploaded.publicPath;
    } else if (kind === "project") {
      if (uploaded.role === "image") item.image = uploaded.publicPath;
    }

    const previousPath = previousAttachmentPath(priorAttachments, uploaded.role);
    if (previousPath && previousPath !== uploaded.publicPath && !replacementDeletes.includes(previousPath)) {
      replacementDeletes.push(previousPath);
    }
  });

  const { dataPath, payload, finalizedItem } = buildSavePayload(kind, existing, previous, item);
  const deleteChanges = replacementDeletes.map((path) => ({ path, delete: true }));

  const commit = await commitChanges({
    token,
    cfg,
    changes: [...uploadChanges, ...deleteChanges, payload],
    message: commitMessage(previous ? "updated" : "added", finalizedItem, user.login),
  });

  return {
    ok: true,
    kind,
    mode: previous ? "updated" : "added",
    id: finalizedItem.id,
    item: finalizedItem,
    uploadedPaths,
    commitUrl: commit.html_url,
    commitSha: commit.sha,
  };
}

async function handleDelete(request, env) {
  const { token, user } = await requireAuthorizedUser(request, env);
  const body = await request.json();
  const kind = normalizeKind(body.kind);
  if (kind === "auto") throw new HttpError(400, "Delete requires a concrete kind.");
  if (kind === "profile") throw new HttpError(400, "The home profile is a single record and cannot be deleted.");

  const cfg = repoConfig(env);
  const targetId = String(body.id || "").trim();
  if (!targetId) throw new HttpError(400, "Missing item id.");

  const items = await loadItemsForKind({ token, cfg, kind });
  const item = items.find((entry) => entry.id === targetId);
  if (!item) throw new HttpError(404, `Item ${targetId} not found.`);

  const remaining = items.filter((entry) => entry.id !== targetId);
  const dataPath = dataPathForKind(kind);
  const changes = [{
    path: dataPath,
    content: buildDataPayload(kind, remaining),
    encoding: "utf-8",
  }];

  for (const path of attachmentPathsForItem(item, kind)) {
    changes.push({ path, delete: true });
  }

  const commit = await commitChanges({
    token,
    cfg,
    changes,
    message: commitMessage("deleted", item, user.login),
  });

  return {
    ok: true,
    kind,
    id: targetId,
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
            "Return only JSON with this top-level shape: {\"kind\":\"publication|update|profile|project\",\"item\":{},\"warnings\":[]}.",
            "If requested kind is auto, choose publication for papers, accepted manuscripts, DOI/arXiv/publisher links, journals, conferences, or workshops with paper metadata. Choose update for activities, talks, awards, visits, jobs, and general news. Choose profile for homepage resume / bio / CV updates. Choose project for open project cards and project pages.",
            "Publication item fields: id, title, authors, venue, year, date, tags, abstract, pdf, poster, code, project, doi, externalUrl, featured, status.",
            "Update item fields: id, title, date, summary, content, links, images, category, pinned, status.",
            "Profile item fields: id, heroMeta, heroDescHtml, chips, cvUrl, email, githubUrl, location, avatarUrl, status.",
            "Project item fields: id, slug, title, subtitle, summary, overview, bodyHtml, image, demoUrl, highlights, links, featured, status.",
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
    item: normalizeItem(kind, parsed.item || {}),
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

  if (kind === "profile") {
    return {
      kind,
      item: normalizeProfile({
        heroMeta: extractAfter(text, /(hero meta|headline|title)\s*(?:is|:)\s*([^.\n]+)/i) || "",
        heroDescHtml: text,
        chips: extractTags(text),
        cvUrl: links[0]?.url || "",
        email: extractAfter(text, /email\s*(?:is|:)\s*([^\s,;]+)/i) || "",
        githubUrl: extractAfter(text, /github\s*(?:is|:)\s*([^\s,;]+)/i) || "",
        location: extractAfter(text, /location\s*(?:is|:)\s*([^.\n]+)/i) || "",
        avatarUrl: "",
        status: "published",
      }),
      warnings: ["Fallback parser used; please review all fields before publishing."],
    };
  }

  if (kind === "project") {
    const slug = slugify(extractAfter(text, /slug\s*(?:is|:)\s*([^.\n]+)/i) || title);
    return {
      kind,
      item: normalizeProject({
        slug,
        title,
        subtitle: extractAfter(text, /subtitle\s*(?:is|:)\s*([^.\n]+)/i) || "",
        summary: firstSentence(text),
        overview: text,
        bodyHtml: splitTextToHtml(text),
        image: "",
        demoUrl: links[0]?.url || "",
        highlights: extractTags(text),
        links,
        featured: /featured|pin|首页|主页/.test(text),
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
  if (kind === "publication" || kind === "update" || kind === "profile" || kind === "project" || kind === "auto") return kind;
  throw new HttpError(400, "Invalid kind. Use auto, publication, update, profile, or project.");
}

function itemKind(item) {
  if (!item) return "item";
  if (item.slug !== undefined || item.overview !== undefined || item.highlights !== undefined || item.image !== undefined) return "project";
  if (item.heroMeta !== undefined || item.heroDescHtml !== undefined || item.cvUrl !== undefined || item.avatarUrl !== undefined) return "profile";
  if (item.year !== undefined || item.tags !== undefined || item.abstract !== undefined) return "publication";
  return "update";
}

function guessKind(text) {
  if (/resume|cv|profile|简历|主页简介|about me|hero/i.test(text)) return "profile";
  if (/project|projects|项目|open projects/i.test(text)) return "project";
  return /paper|publication|accepted|journal|conference|doi|arxiv|论文|发表|接收/i.test(text) ? "publication" : "update";
}

function normalizeItem(kind, input) {
  if (kind === "publication") return normalizePublication(input);
  if (kind === "update") return normalizeUpdate(input);
  if (kind === "profile") return normalizeProfile(input);
  if (kind === "project") return normalizeProject(input);
  throw new HttpError(400, `Unsupported kind: ${kind}`);
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

function normalizeProfile(input) {
  return {
    id: String(input.id || "site-profile"),
    heroMeta: String(input.heroMeta || "").trim(),
    heroDescHtml: String(input.heroDescHtml || "").trim(),
    chips: normalizeStringArray(input.chips),
    cvUrl: String(input.cvUrl || "").trim(),
    email: String(input.email || "").trim(),
    githubUrl: String(input.githubUrl || "").trim(),
    location: String(input.location || "").trim(),
    avatarUrl: String(input.avatarUrl || "").trim(),
    status: input.status === "draft" ? "draft" : "published",
  };
}

function normalizeProject(input) {
  const slug = String(input.slug || "").trim() || slugify(input.title || input.id || "project");
  return {
    id: String(input.id || `proj-${slug}`),
    slug,
    title: String(input.title || "").trim(),
    subtitle: String(input.subtitle || "").trim(),
    summary: String(input.summary || "").trim(),
    overview: String(input.overview || "").trim(),
    bodyHtml: String(input.bodyHtml || "").trim(),
    image: String(input.image || "").trim(),
    demoUrl: String(input.demoUrl || "").trim(),
    highlights: normalizeStringArray(input.highlights),
    links: normalizeLinks(input.links),
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

function splitTextToHtml(text) {
  return String(text || "")
    .trim()
    .split(/\n{2,}/)
    .filter(Boolean)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function sortProfile(items) {
  return (items || []).map((item) => normalizeProfile(item));
}

function matchesItem(entry, item, kind) {
  if (kind === "profile") return true;
  if (kind === "project") return entry.id === item.id || entry.slug === item.slug;
  return entry.id === item.id;
}

function findExistingItem(items, item, kind) {
  if (kind === "profile") return items[0] || null;
  return items.find((entry) => matchesItem(entry, item, kind)) || null;
}

function dataPathForKind(kind) {
  if (kind === "publication") return "data/publications.json";
  if (kind === "update") return "data/updates.json";
  if (kind === "profile") return "data/profile.json";
  if (kind === "project") return "data/projects.json";
  throw new HttpError(400, `Unsupported kind: ${kind}`);
}

function buildDataPayload(kind, items) {
  if (kind === "profile") {
    return JSON.stringify(sortProfile(items)[0] || normalizeProfile({}), null, 2) + "\n";
  }
  return JSON.stringify({ items: sortItems(items, kind) }, null, 2) + "\n";
}

function buildSavePayload(kind, existing, previous, item) {
  const dataPath = dataPathForKind(kind);
  if (kind === "profile") {
    const nextItem = normalizeProfile({ ...(previous || {}), ...item, id: "site-profile" });
    return {
      dataPath,
      finalizedItem: nextItem,
      payload: {
        path: dataPath,
        content: JSON.stringify(nextItem, null, 2) + "\n",
        encoding: "utf-8",
      },
    };
  }

  const nextItems = previous ? existing.map((entry) => (matchesItem(entry, item, kind) ? item : entry)) : [...existing, withGeneratedId(kind, item, existing)];
  const finalizedItem = previous ? item : nextItems[nextItems.length - 1];
  return {
    dataPath,
    finalizedItem,
    payload: {
      path: dataPath,
      content: JSON.stringify({ items: sortItems(nextItems, kind) }, null, 2) + "\n",
      encoding: "utf-8",
    },
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

function nextAttachmentSequence(existingImages, index) {
  const base = Array.isArray(existingImages) ? existingImages.length : 0;
  return base + index + 1;
}

function prepareUploadChange(kind, item, file, index) {
  if (!file || !file.base64 || !file.name) return null;
  if (Number(file.size || 0) > 24 * 1024 * 1024) {
    throw new HttpError(400, `${file.name} is larger than 24 MB.`);
  }

  const ext = extensionFor(file);
  const date = normalizeDate(item.date);
  const year = String(item.year || date.slice(0, 4) || new Date().getFullYear());
  const folderId = slugify(item.id || item.slug || item.title || item.summary || "upload");
  const slug = slugify(item.slug || item.title || folderId);
  const isPdf = ext === ".pdf" || file.type === "application/pdf";
  const isImage = /^image\//.test(file.type || "");

  let path;
  let role;
  if (kind === "publication" && isPdf) {
    path = `assets/pdf/publications/${year}/${folderId}/paper${ext}`;
    role = "pdf";
  } else if (kind === "publication" && isImage) {
    path = `assets/img/publications/${year}/${folderId}/poster-${String(index + 1).padStart(2, "0")}${ext}`;
    role = "poster";
  } else if (kind === "update" && isImage) {
    const nextSeq = nextAttachmentSequence(item.images, index);
    path = `assets/img/news/${year}/${folderId}/${String(nextSeq).padStart(2, "0")}${ext}`;
    role = "image";
  } else if (kind === "profile" && isPdf) {
    path = `assets/pdf/profile/site-profile/cv${ext}`;
    role = "cv";
  } else if (kind === "profile" && isImage) {
    path = `assets/img/profile/site-profile/avatar${ext}`;
    role = "avatar";
  } else if (kind === "project" && isImage) {
    path = `assets/img/projects/${slug}/hero${ext}`;
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

  if (kind === "profile") return "site-profile";
  if (kind === "project") {
    const slug = slugify(item.slug || item.title || "project");
    const base = `proj-${slug}`;
    if (!existing.has(base)) return base;
    let suffix = 2;
    while (existing.has(`${base}-${suffix}`)) suffix += 1;
    return `${base}-${suffix}`;
  }

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

function withGeneratedId(kind, item, items) {
  return { ...item, id: ensureUniqueId(kind, item, items) };
}

function sortItems(items, kind) {
  if (kind === "profile") {
    return sortProfile(items);
  }
  const normalized = [...items].map((item) => normalizeItem(kind, item));
  if (kind === "project") {
    return normalized.sort((a, b) => {
      if (a.featured !== b.featured) return a.featured ? -1 : 1;
      return String(a.title || "").localeCompare(String(b.title || ""));
    });
  }
  return normalized.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
}

function attachmentPathsForItem(item, kind) {
  if (kind === "publication") {
    return [item.pdf, item.poster].filter(isRepoAttachmentPath);
  }
  if (kind === "update") {
    return normalizeStringArray(item.images).filter(isRepoAttachmentPath);
  }
  if (kind === "profile") {
    return [item.cvUrl, item.avatarUrl].filter(isRepoAttachmentPath);
  }
  if (kind === "project") {
    return [item.image].filter(isRepoAttachmentPath);
  }
  return [];
}

function attachmentPathsByKind(item, kind) {
  if (kind === "publication") {
    return { pdf: item.pdf || "", poster: item.poster || "" };
  }
  if (kind === "update") {
    return { images: normalizeStringArray(item.images) };
  }
  if (kind === "profile") {
    return { cv: item.cvUrl || "", avatar: item.avatarUrl || "" };
  }
  if (kind === "project") {
    return { image: item.image || "" };
  }
  return {};
}

function previousAttachmentPath(snapshot, role) {
  if (!snapshot) return "";
  if (role === "pdf") return snapshot.pdf || "";
  if (role === "poster") return snapshot.poster || "";
  if (role === "cv") return snapshot.cv || "";
  if (role === "avatar") return snapshot.avatar || "";
  if (role === "image") {
    if (Array.isArray(snapshot.images) && snapshot.images.length) return "";
    return snapshot.image || "";
  }
  return "";
}

function isRepoAttachmentPath(path) {
  return typeof path === "string" && path.startsWith("/assets/");
}

function commitMessage(action, item, login) {
  return `${action === "deleted" ? "Delete" : action === "updated" ? "Update" : "Add"} ${itemKind(item)}: ${item.title || item.id}\n\nSubmitted by ${login} via Smart Update.`;
}

async function loadItemsForKind({ token, cfg, kind }) {
  const dataPath = dataPathForKind(kind);
  const dataFile = await getRepositoryFile({ token, cfg, path: dataPath });
  const data = JSON.parse(dataFile.text || (kind === "profile" ? "{}" : "{\"items\":[]}"));
  if (kind === "profile") return data && typeof data === "object" ? [data] : [];
  return Array.isArray(data.items) ? data.items : [];
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
    if (change.delete) {
      treeEntries.push({
        path: change.path,
        mode: "100644",
        type: "blob",
        sha: null,
      });
      continue;
    }

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
