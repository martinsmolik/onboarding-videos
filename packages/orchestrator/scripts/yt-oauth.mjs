#!/usr/bin/env node
// One-time helper: obtain a YouTube refresh token.
//   YT_CLIENT_ID=... YT_CLIENT_SECRET=... node packages/orchestrator/scripts/yt-oauth.mjs
// (or put them in the repo-root .env). Open the printed URL, log in as the channel owner, approve.
// Redirect URI to register in Google Cloud (OAuth client type "Web application"): http://localhost:8787/callback
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const envFile = path.join(root, ".env");
if (fs.existsSync(envFile)) for (const l of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Za-z_]\w*)\s*=\s*(.*?)\s*$/); if (m && process.env[m[1]] === undefined && m[2]) process.env[m[1]] = m[2].replace(/\s+#.*$/, "").replace(/^(["'])(.*)\1$/, "$2");
}
const { YT_CLIENT_ID: id, YT_CLIENT_SECRET: secret } = process.env;
if (!id || !secret) { console.error("Set YT_CLIENT_ID and YT_CLIENT_SECRET first (Google Cloud Console > APIs & Services > Credentials)."); process.exit(1); }

const PORT = 8787;
const redirect = `http://localhost:${PORT}/callback`;
const scope = ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.force-ssl"].join(" ");
const state = crypto.randomBytes(12).toString("hex");
const url = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
  client_id: id, redirect_uri: redirect, response_type: "code", scope,
  access_type: "offline", prompt: "consent", include_granted_scopes: "true", state,
});

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, redirect);
  if (u.pathname !== "/callback") { res.writeHead(404).end(); return; }
  const err = u.searchParams.get("error");
  const code = u.searchParams.get("code");
  if (err || !code || u.searchParams.get("state") !== state) {
    res.writeHead(400, { "content-type": "text/plain" }).end(`OAuth failed: ${err ?? "missing code / state mismatch"}`);
    console.error("OAuth failed:", err ?? "missing code / state mismatch"); process.exit(1);
  }
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: id, client_secret: secret, redirect_uri: redirect, grant_type: "authorization_code" }),
  });
  const j = await r.json();
  if (!j.refresh_token) {
    res.writeHead(500, { "content-type": "text/plain" }).end("No refresh_token returned – see terminal.");
    console.error("Token exchange response had no refresh_token:", JSON.stringify(j),
      "\nRevoke the app at https://myaccount.google.com/permissions and run this script again (prompt=consent is already set).");
    process.exit(1);
  }
  res.writeHead(200, { "content-type": "text/plain; charset=utf-8" }).end("Hotovo. Refresh token je v terminálu, toto okno můžete zavřít.");
  console.log("\nSuccess. Add this to .env (never commit it):\n\nYT_REFRESH_TOKEN=" + j.refresh_token + "\n");
  console.log("Granted scopes:", j.scope);
  server.close(); process.exit(0);
});
server.listen(PORT, "127.0.0.1", () => {
  console.log("1) Open this URL in a browser logged in as the YouTube channel owner:\n\n" + url + "\n");
  console.log(`2) Approve. The browser is redirected to ${redirect} (this script listens on 127.0.0.1:${PORT}).`);
  console.log("   Running on a remote box? Forward the port:  ssh -L 8787:localhost:8787 <host>");
});
