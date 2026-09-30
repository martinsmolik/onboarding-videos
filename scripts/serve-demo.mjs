// Tiny static server for demo-app (stand-in for Sloneek FE) – no deps.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(new URL('../demo-app', import.meta.url).pathname);
const port = Number(process.env.PORT || 4173);
http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0].replace(/^\/$/, '/index.html')));
  fs.readFile(p, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': p.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream' });
    res.end(data);
  });
}).listen(port, () => console.log(`demo-app on http://localhost:${port}/index.html`));
