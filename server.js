const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

const port = Number(process.env.PORT || 8000);
const host = process.env.HOST || "0.0.0.0";
const publicDir = __dirname;
const dataDir = path.join(__dirname, ".data");
const configuredDataDir = process.env.CRAFTLY_DATA_DIR?.trim();
const storageDir = configuredDataDir ? path.resolve(configuredDataDir) : dataDir;
const dataFile = path.join(storageDir, "craftly-store.json");
const databaseUrl = process.env.DATABASE_URL?.trim();
const databasePool = databaseUrl
  ? new (require("pg").Pool)({ connectionString: databaseUrl, max: 5 })
  : null;
const searchTimeoutMs = 7000;
const sessionTtlMs = 1000 * 60 * 60 * 24 * 30;
const maxIdeasPerUser = 48;
const maxSessionsPerUser = 5;
const cookieName = "craftly_session";
const authWindowMs = 1000 * 60 * 15;
const maxAuthAttempts = 12;
const authAttempts = new Map();
let storeMutationQueue = Promise.resolve();
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
};

const server = http.createServer((request, response) => {
  handleRequest(request, response).catch((error) => {
    console.error("Unhandled request failure:", error);
    if (!response.headersSent) sendJson(response, { error: "The server could not complete that request." }, 500);
    else response.end();
  });
});

async function handleRequest(request, response) {
  setSecurityHeaders(response);

  let requestUrl;
  try {
    requestUrl = new URL(request.url, "http://craftly.local");
  } catch (error) {
    sendJson(response, { error: "Invalid request URL." }, 400);
    return;
  }

  if (requestUrl.pathname.startsWith("/api/") && isCrossSiteRequest(request)) {
    sendJson(response, { error: "Cross-site requests are not allowed." }, 403);
    return;
  }

  if (requestUrl.pathname === "/api/health" && request.method === "GET") {
    sendJson(response, { ok: true, storage: "ready" });
    return;
  }

  if (requestUrl.pathname === "/api/auth/signup" && request.method === "POST") {
    await handleSignupRequest(request, response);
    return;
  }

  if (requestUrl.pathname === "/api/auth/login" && request.method === "POST") {
    await handleLoginRequest(request, response);
    return;
  }

  if (requestUrl.pathname === "/api/auth/logout" && request.method === "POST") {
    await handleLogoutRequest(request, response);
    return;
  }

  if (requestUrl.pathname === "/api/session" && request.method === "GET") {
    await handleSessionRequest(request, response);
    return;
  }

  if (requestUrl.pathname === "/api/ideas" && request.method === "GET") {
    await handleListIdeasRequest(request, response);
    return;
  }

  if (requestUrl.pathname === "/api/ideas" && request.method === "POST") {
    await handleSaveIdeaRequest(request, response);
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/source") {
    await handleSourceRequest(request, response);
    return;
  }

  serveStatic(request, response);
}

async function handleSignupRequest(request, response) {
  try {
    if (!consumeAuthAttempt(request, response)) return;
    const body = await readJsonBody(request);
    const email = normalizeEmail(body.email);
    const password = typeof body.password === "string" ? body.password : "";
    const name = cleanDisplayName(body.name, email);

    if (!email || password.length < 8 || password.length > 256) {
      sendJson(response, { error: "Use a valid email and a password with at least 8 characters." }, 400);
      return;
    }

    const passwordHash = await hashPassword(password);
    const result = await mutateStore((store) => {
      if (store.users.some((user) => user.email === email)) return { duplicate: true };

      const user = {
        id: crypto.randomUUID(),
        email,
        name,
        password: passwordHash,
        createdAt: new Date().toISOString(),
      };
      store.users.push(user);
      return { user, token: createSession(store, user.id) };
    });

    if (result.duplicate) {
      sendJson(response, { error: "An account already exists for that email." }, 409);
      return;
    }

    clearAuthAttempts(request);
    setSessionCookie(request, response, result.token);
    const user = result.user;
    sendJson(response, { user: publicUser(user) }, 201);
  } catch (error) {
    console.error("Signup failed:", error);
    sendJson(response, { error: "Could not create the account right now." }, 500);
  }
}

async function handleLoginRequest(request, response) {
  try {
    if (!consumeAuthAttempt(request, response)) return;
    const body = await readJsonBody(request);
    const email = normalizeEmail(body.email);
    const password = typeof body.password === "string" ? body.password : "";
    const store = await readStore();
    const user = store.users.find((item) => item.email === email);

    if (!user || password.length > 256 || !(await verifyPassword(password, user.password))) {
      sendJson(response, { error: "Email or password did not match." }, 401);
      return;
    }

    const token = await mutateStore((latestStore) => {
      const latestUser = latestStore.users.find((item) => item.id === user.id);
      return latestUser ? createSession(latestStore, latestUser.id) : null;
    });
    if (!token) {
      sendJson(response, { error: "Email or password did not match." }, 401);
      return;
    }

    clearAuthAttempts(request);
    setSessionCookie(request, response, token);
    sendJson(response, { user: publicUser(user) });
  } catch (error) {
    console.error("Login failed:", error);
    sendJson(response, { error: "Could not log in right now." }, 500);
  }
}

async function handleLogoutRequest(request, response) {
  try {
    const token = readSessionToken(request);
    if (token) {
      const tokenHash = hashSessionToken(token);
      await mutateStore((store) => {
        store.sessions = store.sessions.filter((session) => session.tokenHash !== tokenHash && session.token !== token);
      });
    }
    clearSessionCookie(request, response);
    sendJson(response, { ok: true });
  } catch (error) {
    console.error("Logout failed:", error);
    clearSessionCookie(request, response);
    sendJson(response, { ok: true });
  }
}

async function handleSessionRequest(request, response) {
  const auth = await getAuthenticatedUser(request);
  if (!auth) {
    if (readSessionToken(request)) clearSessionCookie(request, response);
    sendJson(response, { user: null });
    return;
  }

  sendJson(response, { user: publicUser(auth.user), ideas: getUserIdeas(auth.store, auth.user.id) });
}

async function handleListIdeasRequest(request, response) {
  const auth = await requireAuthenticatedUser(request, response);
  if (!auth) return;

  sendJson(response, { ideas: getUserIdeas(auth.store, auth.user.id) });
}

async function handleSaveIdeaRequest(request, response) {
  const auth = await requireAuthenticatedUser(request, response);
  if (!auth) return;

  try {
    const body = await readJsonBody(request);
    const idea = sanitizeIdea(body.idea || body);

    if (!idea) {
      sendJson(response, { error: "Save an idea after generating it." }, 400);
      return;
    }

    const ideas = await mutateStore((store) => {
      const user = findAuthenticatedUser(store, readSessionToken(request));
      if (!user) return null;

      store.ideas = store.ideas.filter((item) => item.userId !== user.id || item.title !== idea.title);
      store.ideas.unshift({
        ...idea,
        id: crypto.randomUUID(),
        userId: user.id,
        savedAt: new Date().toISOString(),
      });

      const userIdeas = getUserIdeas(store, user.id);
      const overflowIds = new Set(userIdeas.slice(maxIdeasPerUser).map((item) => item.id));
      store.ideas = store.ideas.filter((item) => !overflowIds.has(item.id));
      return getUserIdeas(store, user.id);
    });

    if (!ideas) {
      sendJson(response, { error: "Your session expired. Please log in again." }, 401);
      return;
    }
    sendJson(response, { ideas }, 201);
  } catch (error) {
    console.error("Save idea failed:", error);
    sendJson(response, { error: "Could not save that idea right now." }, 500);
  }
}

async function handleSourceRequest(request, response) {
  let query = "handcraft tutorial";

  try {
    const body = await readJsonBody(request);
    query = buildSafeQuery(body);
    const source = await searchRelatedSource(query);

    sendJson(response, {
      status: source.status,
      title: source.title,
      url: source.url,
      summary: source.summary || `Related to: ${query}`,
    });
  } catch (error) {
    console.error("Related inspiration request failed:", error);
    sendJson(response, buildFallbackSource(query, "error"));
  }
}

function buildSafeQuery(body) {
  const materials = Array.isArray(body.materials) ? body.materials : [];
  const category = typeof body.category === "string" ? body.category : "handcraft";
  const query = typeof body.query === "string" ? body.query : "";
  const prompt = typeof body.prompt === "string" ? body.prompt : "";
  const promptWords = prompt
    .toLowerCase()
    .match(/\b(gift|birthday|room|decor|desk|organizer|teen|adult|holiday|simple|easy)\b/g);

  const safeQuery = (query || [...materials, ...(promptWords || []), category, "handcraft tutorial"].join(" "))
    .replace(/[^a-z0-9 -]/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);

  return safeQuery || "handcraft tutorial";
}

async function searchRelatedSource(query) {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY?.trim();

  if (!apiKey) {
    return buildFallbackSource(query, "missing-key");
  }

  try {
    const result = await searchBrave(query, apiKey);
    if (result) return result;
  } catch (error) {
    console.error("Brave Search request failed:", error);
  }

  return buildFallbackSource(query, "error");
}

async function searchBrave(query, apiKey) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), searchTimeoutMs);
  const searchParams = new URLSearchParams({
    q: query,
    count: "5",
    safesearch: "moderate",
    search_lang: "en",
  });
  const url = `https://api.search.brave.com/res/v1/web/search?${searchParams.toString()}`;
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": apiKey,
      },
      signal: controller.signal,
    });

    if (!response.ok) return null;

    const data = await response.json();
    const firstResult = data.web?.results?.find((result) => isSafeHttpUrl(result?.url));
    if (!firstResult?.url) return null;

    return {
      status: "live",
      title: firstResult.title || "Open related handcraft link",
      url: firstResult.url,
      summary: firstResult.description || "A related handcraft source found from your prompt.",
    };
  } finally {
    clearTimeout(timeout);
  }
}

function buildFallbackSource(query, status) {
  const hasKeyIssue = status === "missing-key";

  return {
    status,
    title: "Search related handcraft tutorials",
    url: buildSearchUrl(query),
    summary: hasKeyIssue
      ? "Live related links need the Brave Search secret. This opens a focused search using your prompt instead."
      : "Live related links are temporarily unavailable. This opens a focused search using your prompt instead.",
  };
}

function serveStatic(request, response) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, "http://craftly.local").pathname);
  } catch (error) {
    response.writeHead(400);
    response.end("Bad request");
    return;
  }

  const publicFiles = new Map([
    ["/", "index.html"],
    ["/index.html", "index.html"],
    ["/styles.css", "styles.css"],
    ["/script.js", "script.js"],
  ]);
  const relativePath = publicFiles.get(pathname);
  if (!relativePath || (request.method !== "GET" && request.method !== "HEAD")) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }
  const filePath = path.join(publicDir, relativePath);

  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    response.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream",
    });
    response.end(request.method === "HEAD" ? undefined : content);
  });
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let rawBody = "";

    request.on("data", (chunk) => {
      rawBody += chunk;
      if (rawBody.length > 1_000_000) {
        request.destroy();
        reject(new Error("Request body too large"));
      }
    });

    request.on("end", () => {
      try {
        resolve(JSON.parse(rawBody || "{}"));
      } catch (error) {
        reject(error);
      }
    });
  });
}

async function readStore() {
  if (databasePool) {
    const result = await databasePool.query("SELECT data FROM craftly_store WHERE id = 1");
    if (result.rowCount !== 1) throw new Error("Craftly database store is not initialized");
    return normalizeStore(result.rows[0].data);
  }

  try {
    const raw = await fsp.readFile(dataFile, "utf8");
    return normalizeStore(JSON.parse(raw));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return { users: [], sessions: [], ideas: [] };
  }
}

async function writeStore(store) {
  const payload = compactStore(store);
  if (databasePool) {
    await databasePool.query("UPDATE craftly_store SET data = $1::jsonb, updated_at = NOW() WHERE id = 1", [
      JSON.stringify(payload),
    ]);
    return;
  }

  await fsp.mkdir(storageDir, { recursive: true, mode: 0o700 });
  const tempFile = `${dataFile}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  try {
    await fsp.writeFile(tempFile, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await fsp.rename(tempFile, dataFile);
  } finally {
    await fsp.rm(tempFile, { force: true }).catch(() => {});
  }
}

async function initializeStore() {
  if (databasePool) {
    await databasePool.query(`
      CREATE TABLE IF NOT EXISTS craftly_store (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await databasePool.query(
      "INSERT INTO craftly_store (id, data) VALUES (1, $1::jsonb) ON CONFLICT (id) DO NOTHING",
      [JSON.stringify({ users: [], sessions: [], ideas: [] })],
    );
    await readStore();
    return;
  }

  await fsp.mkdir(storageDir, { recursive: true, mode: 0o700 });
  try {
    await readStore();
  } catch (error) {
    error.message = `Craftly could not read its storage file at ${dataFile}: ${error.message}`;
    throw error;
  }

  try {
    await fsp.access(dataFile, fs.constants.F_OK);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await writeStore({ users: [], sessions: [], ideas: [] });
  }
}

function mutateStore(mutator) {
  if (databasePool) {
    const operation = storeMutationQueue.then(async () => {
      const client = await databasePool.connect();
      try {
        await client.query("BEGIN");
        const result = await client.query("SELECT data FROM craftly_store WHERE id = 1 FOR UPDATE");
        if (result.rowCount !== 1) throw new Error("Craftly database store is not initialized");
        const store = normalizeStore(result.rows[0].data);
        const mutationResult = await mutator(store);
        await client.query("UPDATE craftly_store SET data = $1::jsonb, updated_at = NOW() WHERE id = 1", [
          JSON.stringify(compactStore(store)),
        ]);
        await client.query("COMMIT");
        return mutationResult;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    });
    storeMutationQueue = operation.catch(() => {});
    return operation;
  }

  const operation = storeMutationQueue.then(async () => {
    const store = await readStore();
    const result = await mutator(store);
    await writeStore(store);
    return result;
  });
  storeMutationQueue = operation.catch(() => {});
  return operation;
}

function normalizeStore(value) {
  const parsed = value && typeof value === "object" ? value : {};
  return {
    users: Array.isArray(parsed.users) ? parsed.users : [],
    sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
    ideas: Array.isArray(parsed.ideas) ? parsed.ideas : [],
  };
}

function compactStore(store) {
  return {
    users: store.users,
    sessions: store.sessions
      .filter((session) => new Date(session.expiresAt).getTime() > Date.now())
      .map(({ token, ...session }) => ({
        ...session,
        tokenHash: session.tokenHash || hashSessionToken(token || ""),
      })),
    ideas: store.ideas,
  };
}

async function requireAuthenticatedUser(request, response) {
  const auth = await getAuthenticatedUser(request);
  if (!auth) {
    sendJson(response, { error: "Please log in to save and revisit ideas." }, 401);
    return null;
  }

  return auth;
}

async function getAuthenticatedUser(request) {
  const token = readSessionToken(request);
  if (!token) return null;

  const store = await readStore();
  const user = findAuthenticatedUser(store, token);
  if (!user) return null;

  return { store, user };
}

function createSession(store, userId) {
  const token = crypto.randomBytes(32).toString("base64url");
  const session = {
    tokenHash: hashSessionToken(token),
    userId,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + sessionTtlMs).toISOString(),
  };

  const activeSessions = store.sessions
    .filter((item) => new Date(item.expiresAt).getTime() > Date.now())
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const keptUserSessions = new Set(
    activeSessions.filter((item) => item.userId === userId).slice(0, maxSessionsPerUser - 1),
  );
  store.sessions = activeSessions.filter((item) => item.userId !== userId || keptUserSessions.has(item));
  store.sessions.push(session);
  return token;
}

function findAuthenticatedUser(store, token) {
  if (!token) return null;
  const tokenHash = hashSessionToken(token);
  const now = Date.now();
  const session = store.sessions.find(
    (item) =>
      (item.tokenHash === tokenHash || item.token === token) && new Date(item.expiresAt).getTime() > now,
  );
  return session ? store.users.find((item) => item.id === session.userId) || null : null;
}

function hashSessionToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function readSessionToken(request) {
  const cookies = parseCookies(request.headers.cookie || "");
  return cookies[cookieName] || "";
}

function parseCookies(cookieHeader) {
  return cookieHeader.split(";").reduce((cookies, cookie) => {
    const [rawName, ...rawValue] = cookie.trim().split("=");
    if (!rawName) return cookies;
    try {
      cookies[rawName] = decodeURIComponent(rawValue.join("="));
    } catch (error) {
      cookies[rawName] = "";
    }
    return cookies;
  }, {});
}

function setSessionCookie(request, response, token) {
  const secure = isSecureRequest(request) ? "; Secure" : "";
  response.setHeader(
    "Set-Cookie",
    `${cookieName}=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${Math.floor(sessionTtlMs / 1000)}; SameSite=Lax${secure}`,
  );
}

function clearSessionCookie(request, response) {
  const secure = isSecureRequest(request) ? "; Secure" : "";
  response.setHeader("Set-Cookie", `${cookieName}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax${secure}`);
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scryptPassword(password, salt);
  return `scrypt$16384$8$1$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

async function verifyPassword(password, storedValue) {
  const parts = String(storedValue || "").split("$");
  try {
    if (parts[0] === "scrypt" && parts.length === 6) {
      const [, n, r, p, salt, storedHash] = parts;
      if (Number(n) !== 16384 || Number(r) !== 8 || Number(p) !== 1) return false;
      const hash = await scryptPassword(password, Buffer.from(salt, "base64url"));
      const expected = Buffer.from(storedHash, "base64url");
      return expected.length === hash.length && crypto.timingSafeEqual(expected, hash);
    }

    if (parts[0] === "pbkdf2_sha256" && parts.length === 4) {
      const [, iterations, salt, storedHash] = parts;
      const rounds = Number(iterations);
      if (!Number.isInteger(rounds) || rounds < 100000 || rounds > 600000) return false;
      const hash = await pbkdf2Password(password, salt, rounds);
      const expected = Buffer.from(storedHash, "hex");
      return expected.length === hash.length && crypto.timingSafeEqual(expected, hash);
    }
  } catch (error) {
    return false;
  }
  return false;
}

function scryptPassword(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

function pbkdf2Password(password, salt, iterations) {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, iterations, 32, "sha256", (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

function normalizeEmail(email) {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
    ? email.trim().toLowerCase()
    : "";
}

function cleanDisplayName(name, email) {
  const fallback = email.split("@")[0] || "Creative maker";
  const cleaned = typeof name === "string" ? name.replace(/\s+/g, " ").trim().slice(0, 60) : "";
  return cleaned || fallback;
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: user.createdAt,
  };
}

function getUserIdeas(store, userId) {
  return store.ideas
    .filter((idea) => idea.userId === userId)
    .sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime())
    .map(({ userId, ...idea }) => idea);
}

function sanitizeIdea(idea) {
  if (!idea || typeof idea !== "object") return null;

  const title = sanitizeText(idea.title, 120);
  const intro = sanitizeText(idea.intro, 320);
  const category = sanitizeText(idea.category, 60);
  const prompt = sanitizeText(idea.prompt, 600);
  const finish = sanitizeText(idea.finish, 300);
  const searchQuery = sanitizeText(idea.searchQuery, 220);
  const supplies = sanitizeTextList(idea.supplies, 12, 60);
  const steps = sanitizeTextList(idea.steps, 10, 240);

  if (!title || supplies.length === 0 || steps.length === 0) return null;

  return {
    title,
    intro,
    category: category || "Custom craft",
    supplies,
    time: sanitizeText(idea.time, 40),
    difficulty: sanitizeText(idea.difficulty, 40),
    style: sanitizeText(idea.style, 60),
    prompt,
    searchQuery,
    steps,
    finish,
  };
}

function sanitizeText(value, maxLength) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, maxLength) : "";
}

function sanitizeTextList(value, maxItems, maxLength) {
  return Array.isArray(value) ? value.map((item) => sanitizeText(item, maxLength)).filter(Boolean).slice(0, maxItems) : [];
}

function buildSearchUrl(query) {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

function isSafeHttpUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch (error) {
    return false;
  }
}

function isSecureRequest(request) {
  const forwardedProto = String(request.headers["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  return request.socket.encrypted || forwardedProto === "https";
}

function isCrossSiteRequest(request) {
  const fetchSite = String(request.headers["sec-fetch-site"] || "").toLowerCase();
  if (fetchSite === "cross-site") return true;

  const origin = request.headers.origin;
  if (!origin) return false;

  try {
    const forwardedHost = String(request.headers["x-forwarded-host"] || request.headers.host || "")
      .split(",")[0]
      .trim()
      .toLowerCase();
    const expectedProtocol = isSecureRequest(request) ? "https:" : "http:";
    const parsedOrigin = new URL(origin);
    return parsedOrigin.protocol !== expectedProtocol || parsedOrigin.host.toLowerCase() !== forwardedHost;
  } catch (error) {
    return true;
  }
}

function requestIp(request) {
  return String(request.headers["x-forwarded-for"] || request.socket.remoteAddress || "unknown")
    .split(",")[0]
    .trim();
}

function consumeAuthAttempt(request, response) {
  const key = requestIp(request);
  const now = Date.now();
  const current = authAttempts.get(key);
  const entry = !current || current.resetAt <= now ? { count: 0, resetAt: now + authWindowMs } : current;
  entry.count += 1;
  authAttempts.set(key, entry);

  if (entry.count <= maxAuthAttempts) return true;
  response.setHeader("Retry-After", String(Math.ceil((entry.resetAt - now) / 1000)));
  sendJson(response, { error: "Too many login attempts. Please wait a few minutes and try again." }, 429);
  return false;
}

function clearAuthAttempts(request) {
  authAttempts.delete(requestIp(request));
}

function setSecurityHeaders(response) {
  response.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' https: data:; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
}

function sendJson(response, payload, status = 200) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

initializeStore()
  .then(() => {
    server.listen(port, host, () => {
      console.log(`Craftly Ideas running at http://${host}:${port}`);
      console.log(databasePool ? "Craftly database storage ready" : `Craftly file storage ready at ${dataFile}`);
      if (!databasePool && !configuredDataDir && (process.env.REPLIT_DEPLOYMENT || process.env.NODE_ENV === "production")) {
        console.warn("WARNING: DATABASE_URL is not set. Accounts will be lost if the deployment filesystem resets.");
      }
    });
  })
  .catch((error) => {
    console.error("Craftly could not initialize storage:", error);
    process.exitCode = 1;
  });
