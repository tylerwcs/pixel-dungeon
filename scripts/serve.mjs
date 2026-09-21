import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { handleAppApi } from "../worker/app-api.mjs";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const staticRoot = resolve(projectRoot, "dist");
const envFile = join(projectRoot, ".env.local");
if (existsSync(envFile)) for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
  const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
}
const requestedPort = Number.parseInt(process.env.PORT ?? "4173", 10);
const port = Number.isFinite(requestedPort) ? requestedPort : 4173;
const localCharacters = new Map();
const localLobbies = new Map();

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
]);

async function apiRequest(request, response) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 9 * 1024 * 1024) {
      response.writeHead(413, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: "This upload is too large." }));
      return;
    }
    chunks.push(chunk);
  }
  const webRequest = new Request(`http://127.0.0.1:${port}${request.url}`, {
    method: request.method,
    headers: request.headers,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : Buffer.concat(chunks),
  });
  const mockFetch = process.env.MOCK_CHARACTER_API === "1"
    ? async () => new Response(JSON.stringify({ data: [{ b64_json: readFileSync(join(staticRoot, "assets", "adventurer.png")).toString("base64") }] }), { status: 200, headers: { "content-type": "application/json" } })
    : undefined;
  const webResponse = await handleAppApi(webRequest, {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY || (mockFetch ? "local-mock" : ""),
    OPENAI_IMAGE_MODEL: process.env.OPENAI_IMAGE_MODEL,
  }, { store: localCharacters, lobbyStore: localLobbies, ...(mockFetch ? { fetchImpl: mockFetch } : {}) });
  response.writeHead(webResponse.status, Object.fromEntries(webResponse.headers));
  response.end(Buffer.from(await webResponse.arrayBuffer()));
}

function resolveRequestPath(requestUrl) {
  const url = new URL(requestUrl ?? "/", "http://127.0.0.1");
  const decodedPath = decodeURIComponent(url.pathname);
  const relativePath = normalize(decodedPath).replace(/^([/\\])+/, "");
  let candidate = resolve(staticRoot, relativePath || "index.html");

  if (candidate !== staticRoot && !candidate.startsWith(`${staticRoot}${sep}`)) {
    return null;
  }

  if (existsSync(candidate) && statSync(candidate).isDirectory()) {
    candidate = join(candidate, "index.html");
  }

  return candidate;
}

const server = createServer(async (request, response) => {
  if (new URL(request.url ?? "/", "http://127.0.0.1").pathname.startsWith("/api/")) {
    await apiRequest(request, response);
    return;
  }
  let filePath;
  try {
    filePath = resolveRequestPath(request.url);
  } catch {
    response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Bad request");
    return;
  }

  if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  response.writeHead(200, {
    "Cache-Control": "no-store",
    "Content-Type": contentTypes.get(extname(filePath).toLowerCase()) ?? "application/octet-stream",
  });
  createReadStream(filePath).pipe(response);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Pixel Dungeon Chase: http://127.0.0.1:${port}`);
});
