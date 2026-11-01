const http = require("node:http"),
  fs = require("node:fs"),
  path = require("node:path");
const { randomBytes } = require("node:crypto");
const { Store } = require("./store");
function createServer(store) {
  const attempts = new Map();
  return http.createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; style-src 'self'; script-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'",
    );
    res.setHeader("Cache-Control", "no-store");
    const send = (code, data) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    };
    const url = new URL(req.url, "http://localhost");
    const cookies = Object.fromEntries(
      (req.headers.cookie || "")
        .split(";")
        .map((s) => s.trim().split("="))
        .filter((a) => a.length === 2),
    );
    const user = store.user(cookies.session);
    try {
      if (req.method === "GET" && url.pathname === "/api/session") {
        const csrf = randomBytes(32).toString("hex");
        res.setHeader(
          "Set-Cookie",
          `csrf=${csrf}; HttpOnly; SameSite=Strict; Path=/`,
        );
        return send(200, { csrf, user });
      }
      if (req.method === "GET" && url.pathname === "/api/movies")
        return send(200, store.movies());
      if (req.method === "GET" && url.pathname === "/api/bookings") {
        if (!user) return send(401, { error: "Sign in required" });
        return send(200, store.bookings(user.id));
      }
      if (req.method === "POST" && url.pathname.startsWith("/api/")) {
        if (req.headers["content-type"] !== "application/json")
          return send(415, { error: "JSON required" });
        if (!cookies.csrf || req.headers["x-csrf-token"] !== cookies.csrf)
          return send(403, { error: "Refresh and retry" });
        if (
          req.headers.origin &&
          req.headers.origin !== `http://${req.headers.host}`
        )
          return send(403, { error: "Same-origin request required" });
        let size = 0,
          chunks = [];
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 16384) return send(413, { error: "Request too large" });
          chunks.push(chunk);
        }
        let body;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString());
        } catch {
          return send(400, { error: "Invalid JSON" });
        }
        if (!body || Array.isArray(body) || typeof body !== "object")
          return send(400, { error: "JSON object required" });
        if (["/api/register", "/api/login"].includes(url.pathname)) {
          const now = Date.now(),
            key = req.socket.remoteAddress;
          for (const [k, v] of attempts)
            if (now - v.start > 300000) attempts.delete(k);
          const item = attempts.get(key) || { start: now, count: 0 };
          if (item.count >= 20)
            return send(429, { error: "Too many attempts; wait five minutes" });
          item.count++;
          attempts.set(key, item);
          if (url.pathname === "/api/register") {
            store.register(body.email, body.password);
            return send(201, { ok: true });
          }
          const token = store.login(body.email, body.password);
          res.setHeader(
            "Set-Cookie",
            `session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600`,
          );
          return send(200, { ok: true });
        }
        if (!user) return send(401, { error: "Sign in required" });
        if (url.pathname === "/api/logout") {
          store.logout(cookies.session);
          res.setHeader(
            "Set-Cookie",
            "session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
          );
          return send(200, { ok: true });
        }
        if (url.pathname === "/api/bookings")
          return send(201, store.book(user.id, body));
        return send(404, { error: "Not found" });
      }
      const files = {
        "/": ["index.html", "text/html"],
        "/app.js": ["app.js", "text/javascript"],
        "/style.css": ["style.css", "text/css"],
      };
      if (req.method === "GET" && files[url.pathname]) {
        const [name, type] = files[url.pathname];
        res.writeHead(200, { "Content-Type": type });
        return res.end(fs.readFileSync(path.join(__dirname, "static", name)));
      }
      send(404, { error: "Not found" });
    } catch (e) {
      send(400, {
        error: e.message.startsWith("FOREIGN KEY")
          ? "Invalid account"
          : e.message,
      });
    }
  });
}
if (require.main === module) {
  const store = new Store(
    process.env.MOVIE_DB || path.join(__dirname, "demo.sqlite3"),
  );
  const server = createServer(store);
  server.listen(Number(process.env.PORT || 8795), "127.0.0.1", () =>
    console.log("Movie demo: http://127.0.0.1:" + (process.env.PORT || 8795)),
  );
}
module.exports = { createServer };
