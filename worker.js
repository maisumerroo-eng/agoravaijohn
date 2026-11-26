// Entrada pro Cloudflare Workers: serve os arquivos de public/ e as rotas /api/* reaproveitando
// os mesmos handlers (estilo Node req/res) via um adaptador com streaming.
import analisar from "./api/analisar.js";
import conversar from "./api/conversar.js";
import voz from "./api/voz.js";
import status from "./api/status.js";
import liveToken from "./api/live-token.js";
import buscar from "./api/buscar.js";
import ARQUIVOS from "./static-files.js";

const ROTAS = { "/api/analisar": analisar, "/api/conversar": conversar, "/api/voz": voz, "/api/status": status, "/api/live-token": liveToken, "/api/buscar": buscar };

async function executar(handler, request, env, ctx) {
  // Variáveis/segredos do Worker -> process.env (os handlers leem de lá).
  for (const [k, v] of Object.entries(env)) if (typeof v === "string") process.env[k] = v;

  const url = new URL(request.url);
  let body = {};
  if (request.method === "POST") { try { body = await request.json(); } catch {} }
  const req = {
    method: request.method,
    headers: Object.fromEntries([...request.headers].map(([k, v]) => [k.toLowerCase(), v])),
    body,
    query: Object.fromEntries(url.searchParams),
    url: url.pathname + url.search,
  };

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  const cab = new Headers();
  let comecou = false, liberar;
  const cabecalhoPronto = new Promise((r) => (liberar = r));
  const res = {
    statusCode: 200,
    setHeader(k, v) { cab.set(k, v); },
    status(c) { this.statusCode = c; return this; },
    json(o) { cab.set("content-type", "application/json; charset=utf-8"); this.end(JSON.stringify(o)); return this; },
    write(p) { comecou = true; liberar(); writer.write(typeof p === "string" ? enc.encode(p) : p).catch(() => {}); return true; },
    end(p) { if (p != null) this.write(p); comecou = true; liberar(); writer.close().catch(() => {}); },
  };
  const rodando = Promise.resolve()
    .then(() => handler(req, res))
    .catch((e) => {
      console.error(e);
      if (!comecou) res.status(500).json({ erro: "Erro interno" });
      else writer.close().catch(() => {});
    });
  ctx.waitUntil(rodando);
  await Promise.race([cabecalhoPronto, rodando]);
  if (!comecou) res.end();
  return new Response(readable, { status: res.statusCode, headers: cab });
}

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    const handler = ROTAS[pathname];
    if (handler) return executar(handler, request, env, ctx);
    const arq = ARQUIVOS[pathname];
    if (!arq) return new Response("Não encontrado", { status: 404 });
    return new Response(arq.corpo, { headers: { "content-type": arq.tipo, "cache-control": "no-cache" } });
  },
};
