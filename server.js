const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { URL } = require("url");

loadEnvFile(path.join(__dirname, ".env"));

const PORT = Number(process.env.PORT || 3000);
const VIDEO_ROOT = path.resolve(process.env.VIDEO_ROOT || path.join(__dirname, "videos"));
const PUBLIC_ROOT = path.join(__dirname, "public");
const USERNAME = process.env.APP_USERNAME || "admin";
const PASSWORD = process.env.APP_PASSWORD || "admin";
const PASSWORD_HASH = process.env.APP_PASSWORD_HASH || "";
const SESSION_SECRET = process.env.SESSION_SECRET || "change-me-in-production";
const SESSION_COOKIE = "video_play_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;
const TRUST_PROXY = process.env.TRUST_PROXY === "true";

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

const videoExtensions = new Set([
  ".mp4",
  ".m4v",
  ".webm",
  ".mov",
  ".mkv",
  ".avi",
  ".m3u8"
]);

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
  ".m3u8": "application/vnd.apple.mpegurl"
};

function safeCompare(a, b) {
  const first = Buffer.from(a);
  const second = Buffer.from(b);
  if (first.length !== second.length) return false;
  return crypto.timingSafeEqual(first, second);
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

function verifyPassword(password) {
  if (!PASSWORD_HASH) return safeCompare(password, PASSWORD);

  const [algorithm, salt, expected] = PASSWORD_HASH.split(":");
  if (algorithm !== "scrypt" || !salt || !expected) return false;

  const actual = crypto.scryptSync(password, salt, 64).toString("hex");
  return safeCompare(actual, expected);
}

function sign(value) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("hex");
}

function createSession(username) {
  const expires = Date.now() + SESSION_TTL_MS;
  const payload = Buffer.from(JSON.stringify({ username, expires })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim().split("="))
      .filter(([key, value]) => key && value)
      .map(([key, value]) => [key, decodeURIComponent(value)])
  );
}

function getSession(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;

  const [payload, signature] = token.split(".");
  if (!payload || !signature || !safeCompare(signature, sign(payload))) return null;

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (session.expires < Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}

function setSessionCookie(res, token) {
  const secure = TRUST_PROXY ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_MS / 1000}${secure}`
  );
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

function sendJson(res, status, payload) {
  send(res, status, JSON.stringify(payload), {
    "Content-Type": mimeTypes[".json"],
    "Cache-Control": "no-store"
  });
}

function sendRedirect(res, location) {
  send(res, 302, "", { Location: location });
}

function normalizeLibraryPath(input = "") {
  const decoded = decodeURIComponent(input).replace(/^\/+/, "");
  const target = path.resolve(VIDEO_ROOT, decoded);
  if (target !== VIDEO_ROOT && !target.startsWith(`${VIDEO_ROOT}${path.sep}`)) {
    throw new Error("Invalid path");
  }
  return { absolute: target, relative: path.relative(VIDEO_ROOT, target) };
}

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function listLibrary(relativePath = "") {
  const { absolute, relative } = normalizeLibraryPath(relativePath);
  const entries = await fs.promises.readdir(absolute, { withFileTypes: true });
  const folders = [];
  const videos = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const entryAbsolute = path.join(absolute, entry.name);
    const entryRelative = path.join(relative, entry.name);

    if (entry.isDirectory()) {
      folders.push({
        name: entry.name,
        path: entryRelative,
        url: `/api/library?path=${encodeURIComponent(entryRelative)}`
      });
      continue;
    }

    if (entry.isFile() && videoExtensions.has(path.extname(entry.name).toLowerCase())) {
      const stat = await fs.promises.stat(entryAbsolute);
      videos.push({
        name: path.basename(entry.name, path.extname(entry.name)),
        filename: entry.name,
        path: entryRelative,
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        streamUrl: `/video/${encodeURIComponent(entryRelative)}`
      });
    }
  }

  folders.sort((a, b) => a.name.localeCompare(b.name));
  videos.sort((a, b) => a.name.localeCompare(b.name));

  return {
    path: relative,
    breadcrumbs: buildBreadcrumbs(relative),
    folders,
    videos
  };
}

function buildBreadcrumbs(relativePath) {
  const parts = relativePath ? relativePath.split(path.sep).filter(Boolean) : [];
  const crumbs = [{ name: "Inicio", path: "" }];
  for (let index = 0; index < parts.length; index += 1) {
    crumbs.push({
      name: parts[index],
      path: parts.slice(0, index + 1).join(path.sep)
    });
  }
  return crumbs;
}

function serveStatic(req, res, pathname) {
  const filePath = pathname === "/" ? "/index.html" : pathname;
  const target = path.resolve(PUBLIC_ROOT, filePath.replace(/^\/+/, ""));
  if (target !== PUBLIC_ROOT && !target.startsWith(`${PUBLIC_ROOT}${path.sep}`)) {
    send(res, 403, "Forbidden");
    return;
  }

  fs.createReadStream(target)
    .on("error", () => send(res, 404, "Not found"))
    .on("open", () => {
      const isHtml = path.extname(target).toLowerCase() === ".html";
      res.writeHead(200, {
        "Content-Type": mimeTypes[path.extname(target).toLowerCase()] || "application/octet-stream",
        "Cache-Control": isHtml ? "no-store" : "public, max-age=3600"
      });
    })
    .pipe(res);
}

async function serveVideo(req, res, videoPath) {
  const { absolute } = normalizeLibraryPath(videoPath);
  const stat = await fs.promises.stat(absolute);
  const ext = path.extname(absolute).toLowerCase();
  const contentType = mimeTypes[ext] || "application/octet-stream";
  const range = req.headers.range;

  if (!range) {
    res.writeHead(200, {
      "Content-Length": stat.size,
      "Content-Type": contentType,
      "Accept-Ranges": "bytes"
    });
    fs.createReadStream(absolute).pipe(res);
    return;
  }

  const match = range.match(/bytes=(\d*)-(\d*)/);
  if (!match) {
    send(res, 416, "Invalid range", { "Content-Range": `bytes */${stat.size}` });
    return;
  }

  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Number(match[2]) : stat.size - 1;

  if (start >= stat.size || end >= stat.size || start > end) {
    send(res, 416, "Range not satisfiable", { "Content-Range": `bytes */${stat.size}` });
    return;
  }

  res.writeHead(206, {
    "Content-Range": `bytes ${start}-${end}/${stat.size}`,
    "Accept-Ranges": "bytes",
    "Content-Length": end - start + 1,
    "Content-Type": contentType
  });
  fs.createReadStream(absolute, { start, end }).pipe(res);
}

async function handleAuth(req, res, pathname) {
  if (pathname === "/api/login" && req.method === "POST") {
    const body = new URLSearchParams(await readRequestBody(req));
    const username = body.get("username") || "";
    const password = body.get("password") || "";

    if (safeCompare(username, USERNAME) && verifyPassword(password)) {
      console.log(`Login ok for ${username}`);
      setSessionCookie(res, createSession(username));
      sendJson(res, 200, { ok: true });
      return true;
    }

    console.warn(`Login failed for ${username || "(empty)"}`);
    sendJson(res, 401, { ok: false, message: "Usuario ou senha invalidos." });
    return true;
  }

  if (pathname === "/api/logout" && req.method === "POST") {
    clearSessionCookie(res);
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (pathname === "/api/me") {
    const session = getSession(req);
    sendJson(res, session ? 200 : 401, { authenticated: Boolean(session), username: session?.username });
    return true;
  }

  return false;
}

async function requestHandler(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = decodeURIComponent(url.pathname);

    if (await handleAuth(req, res, pathname)) return;

    const session = getSession(req);

    if (!session) {
      if (pathname.startsWith("/api/") || pathname.startsWith("/video/")) {
        sendJson(res, 401, { message: "Nao autenticado." });
        return;
      }
      if (pathname !== "/login.html") {
        sendRedirect(res, "/login.html");
        return;
      }
      serveStatic(req, res, "/login.html");
      return;
    }

    if (pathname === "/login.html") {
      sendRedirect(res, "/");
      return;
    }

    if (pathname === "/api/library") {
      sendJson(res, 200, await listLibrary(url.searchParams.get("path") || ""));
      return;
    }

    if (pathname.startsWith("/video/")) {
      await serveVideo(req, res, pathname.slice("/video/".length));
      return;
    }

    serveStatic(req, res, pathname);
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { message: "Erro interno.", detail: error.message });
  }
}

if (require.main === module) {
  fs.mkdirSync(VIDEO_ROOT, { recursive: true });

  http.createServer(requestHandler).listen(PORT, () => {
    console.log(`Video Play running on http://localhost:${PORT}`);
    console.log(`Video root: ${VIDEO_ROOT}`);
    if (SESSION_SECRET === "change-me-in-production") {
      console.warn("Set SESSION_SECRET before exposing this app on the internet.");
    }
    if (!PASSWORD_HASH && PASSWORD === "admin") {
      console.warn("Set APP_PASSWORD_HASH or APP_PASSWORD before exposing this app on the internet.");
    }
  });
}

module.exports = { hashPassword };
