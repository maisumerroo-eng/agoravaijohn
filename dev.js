// Servidor local: node dev.js  ->  http://localhost:3000
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import handler from "./api/analisar.js";
import conversar from "./api/conversar.js";

const TIPOS = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".webmanifest": "application/manifest+json" };
const PUB = join(import.meta.dirname, "public");

http.createServer(async (req, res) => {
  const rota = req.url.match(/^\/api\/(analisar|conversar)/);
  if (rota) {
    let raw = "";
    for await (const c of req) raw += c;
    try { req.body = JSON.parse(raw || "{}"); } catch { req.body = {}; }
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (o) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(o)); };
    return (rota[1] === "analisar" ? handler : conversar)(req, res);
  }
  const caminho = normalize(join(PUB, req.url === "/" ? "index.html" : req.url.split("?")[0]));
  if (!caminho.startsWith(PUB)) return res.writeHead(403).end();
  try {
    const dados = await readFile(caminho);
    res.writeHead(200, { "Content-Type": TIPOS[extname(caminho)] || "application/octet-stream" }).end(dados);
  } catch { res.writeHead(404).end("404"); }
}).listen(3000, () => console.log("http://localhost:3000"));
