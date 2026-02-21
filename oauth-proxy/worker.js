export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/auth") {
      return handleAuth(url, env);
    }
    if (url.pathname === "/callback") {
      return handleCallback(url, env);
    }

    return new Response("Decap OAuth proxy is running.");
  },
};

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
      };
      window.addEventListener('message', receiveMessage, false);
      window.opener.postMessage('authorizing:github', '*');
    </script>
    <p>Authorizing Decap...</p>
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
