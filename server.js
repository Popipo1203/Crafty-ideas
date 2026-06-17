const http = require("http");
const fs = require("fs");
const path = require("path");

const port = Number(process.env.PORT || 8000);
const host = process.env.HOST || "0.0.0.0";
const publicDir = __dirname;
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

const server = http.createServer(async (request, response) => {
  if (request.method === "POST" && request.url === "/api/source") {
    await handleSourceRequest(request, response);
    return;
  }

  serveStatic(request, response);
});

async function handleSourceRequest(request, response) {
  try {
    const body = await readJsonBody(request);
    const query = buildSafeQuery(body);
    const source = await searchRelatedSource(query);

    sendJson(response, {
      title: source.title,
      url: source.url,
      summary: source.summary || `Related to: ${query}`,
    });
  } catch (error) {
    sendJson(
      response,
      {
        title: "Search related handcraft tutorials",
        url: buildSearchUrl("handcraft tutorial"),
        summary: "Open a focused web search related to the craft prompt.",
      },
      200,
    );
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

  return (query || [...materials, ...(promptWords || []), category, "handcraft tutorial"].join(" "))
    .replace(/[^a-z0-9 -]/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

async function searchRelatedSource(query) {
  if (process.env.BRAVE_SEARCH_API_KEY) {
    const result = await searchBrave(query);
    if (result) return result;
  }

  return {
    title: "Search related handcraft tutorials",
    url: buildSearchUrl(query),
    summary: "Open a focused web search based on the materials and request you typed.",
  };
}

async function searchBrave(query) {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=1`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": process.env.BRAVE_SEARCH_API_KEY,
    },
  });

  if (!response.ok) return null;

  const data = await response.json();
  const firstResult = data.web?.results?.[0];
  if (!firstResult?.url) return null;

  return {
    title: firstResult.title || "Open related handcraft link",
    url: firstResult.url,
    summary: firstResult.description || "A related handcraft source found from your prompt.",
  };
}

function serveStatic(request, response) {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);
  const safePath = path.normalize(decodeURIComponent(requestUrl.pathname)).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(publicDir, safePath === "/" ? "index.html" : safePath);

  if (!filePath.startsWith(publicDir)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    response.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream",
    });
    response.end(content);
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

function buildSearchUrl(query) {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

function sendJson(response, payload, status = 200) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

server.listen(port, host, () => {
  console.log(`Craftly Ideas running at http://${host}:${port}`);
});
