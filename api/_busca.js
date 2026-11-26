// Busca grátis na web (sem chave). Tenta vários buscadores e usa o primeiro que responder.
// Devolve { ok, fonte, status, resultados: [{titulo, url, trecho}] }.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const limpar = (h) =>
  String(h || "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;|&ensp;|&#\d+;/g, " ").replace(/\s+/g, " ").trim();

async function pegar(url, opcoes = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 5000);
  try {
    const r = await fetch(url, {
      ...opcoes,
      headers: { "user-agent": UA, "accept-language": "pt-BR,pt;q=0.9,en;q=0.8", accept: "text/html", ...(opcoes.headers || {}) },
      signal: ctrl.signal,
    });
    return { status: r.status, html: r.ok ? await r.text() : "" };
  } finally {
    clearTimeout(t);
  }
}

// Link do Bing vem embrulhado (bing.com/ck/a?...&u=a1<base64url>): desembrulha pro site real.
function linkBing(href) {
  try {
    const u = new URL(href.replace(/&amp;/g, "&"));
    const enc = u.searchParams.get("u");
    if (/bing\.com$/.test(u.hostname) && enc?.startsWith("a1")) {
      const b64 = enc.slice(2).replace(/-/g, "+").replace(/_/g, "/");
      return atob(b64 + "===".slice((b64.length + 3) % 4));
    }
    return u.href;
  } catch { return href; }
}

const BUSCADORES = {
  fandom: async (q) => {
    const termo = q.replace(/\b(gta ?(6|vi)|tiktok|youtube|reddit)\b/gi, "").trim() || q;
    const r = await fetch(`https://gta.fandom.com/api.php?action=query&list=search&format=json&srlimit=8&srprop=snippet&srwhat=text&srsearch=${encodeURIComponent(termo + " GTA VI")}`, { headers: { "user-agent": UA } });
    const status = r.status;
    const j = r.ok ? await r.json() : {};
    const res = (j.query?.search || []).map((x) => ({ titulo: x.title + " (GTA Wiki)", url: "https://gta.fandom.com/wiki/" + encodeURIComponent(x.title.replace(/ /g, "_")), trecho: limpar(x.snippet).slice(0, 300) }));
    return { status, res };
  },
  youtube: async (q) => {
    const { status, html } = await pegar(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&hl=pt-BR`);
    const res = [];
    const re = /"videoRenderer":\{"videoId":"([\w-]{11})"[\s\S]*?"title":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"[\s\S]*?(?:"detailedMetadataSnippets":\[\{"snippetText":\{"runs":\[([\s\S]*?)\]\}|"lengthText")/g;
    let m;
    while ((m = re.exec(html)) && res.length < 8) {
      const trecho = m[3] ? [...m[3].matchAll(/"text":"((?:[^"\\]|\\.)*)"/g)].map((x) => x[1]).join("") : "";
      const dec = (t) => { try { return JSON.parse('"' + t + '"'); } catch { return t; } };
      res.push({ titulo: dec(m[2]) + " (YouTube)", url: "https://www.youtube.com/watch?v=" + m[1], trecho: dec(trecho).slice(0, 300) });
    }
    return { status, res };
  },
  reddit: async (q) => {
    const r = await fetch(`https://www.reddit.com/search.json?q=${encodeURIComponent(q)}&limit=8&sort=relevance`, { headers: { "user-agent": "agoravaijohn/1.0 (copiloto de jogo)" } });
    const status = r.status;
    const j = r.ok ? await r.json().catch(() => ({})) : {};
    const res = (j.data?.children || []).map((c) => ({ titulo: c.data.title + " (Reddit)", url: "https://www.reddit.com" + c.data.permalink, trecho: String(c.data.selftext || "").slice(0, 300) }));
    return { status, res };
  },
  bing: async (q) => {
    const { status, html } = await pegar(`https://www.bing.com/search?q=${encodeURIComponent(q)}&setlang=en-us&cc=us&count=10`);
    const res = [];
    for (const bloco of html.split('<li class="b_algo"').slice(1)) {
      const a = bloco.match(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
      const p = bloco.match(/<p[^>]*>([\s\S]*?)<\/p>/) || bloco.match(/class="b_lineclamp\d"[^>]*>([\s\S]*?)<\/(?:p|div)>/);
      if (a && /^https?:/.test(a[1])) res.push({ titulo: limpar(a[2]), url: linkBing(a[1]), trecho: limpar(p?.[1]).slice(0, 300) });
    }
    return { status, res };
  },
  mojeek: async (q) => {
    const { status, html } = await pegar(`https://www.mojeek.com/search?q=${encodeURIComponent(q)}`);
    const res = [];
    for (const bloco of html.split("<li class=").slice(1)) {
      const a = bloco.match(/<a[^>]+class="title"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/) || bloco.match(/<h2>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
      const p = bloco.match(/<p class="s">([\s\S]*?)<\/p>/);
      if (a && /^https?:/.test(a[1])) res.push({ titulo: limpar(a[2]), url: a[1], trecho: limpar(p?.[1]).slice(0, 300) });
    }
    return { status, res };
  },
  ddglite: async (q) => {
    const { status, html } = await pegar("https://lite.duckduckgo.com/lite/", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ q, kl: "br-pt" }),
    });
    const res = [];
    const re = /<a[^>]+href="([^"]+)"[^>]+class=['"]result-link['"][^>]*>([\s\S]*?)<\/a>[\s\S]*?class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/g;
    let m;
    while ((m = re.exec(html))) {
      let url = m[1];
      try { const u = new URL(url, "https://duckduckgo.com"); url = u.searchParams.get("uddg") || u.href; } catch {}
      if (!/duckduckgo\.com\/y\.js/.test(url)) res.push({ titulo: limpar(m[2]), url, trecho: limpar(m[3]).slice(0, 300) });
    }
    return { status, res };
  },
};

let preferido = "ddglite"; // o que funcionou por último vai primeiro

export async function buscarWeb(consulta, max = 5, { todos = false, so = null } = {}) {
  const ordem = so ? [so].flat().filter((n) => BUSCADORES[n]) : Object.keys(BUSCADORES).sort((a, b) => (a === preferido ? -1 : b === preferido ? 1 : 0));
  const relatorio = {};
  for (const nome of ordem) {
    try {
      const { status, res } = await BUSCADORES[nome](consulta);
      relatorio[nome] = { status, qtd: res.length };
      if (res.length && !todos) { preferido = nome; return { ok: true, fonte: nome, status, resultados: res.slice(0, max), relatorio }; }
      if (res.length && todos && !relatorio._primeiro) relatorio._primeiro = { fonte: nome, exemplo: res[0] };
    } catch (e) {
      relatorio[nome] = { erro: String(e.message || e).slice(0, 80) };
    }
  }
  return { ok: false, status: 0, resultados: [], relatorio };
}

// Pesquisa principal: TikTok primeiro (via DuckDuckGo com site:tiktok.com), depois a wiki do GTA (Fandom),
// YouTube e web geral — tudo em paralelo. Resultado marcado com a origem.
const ate = (p, ms) => Promise.race([p, new Promise((ok) => setTimeout(() => ok({ resultados: [] }), ms))]);
export async function buscarComFonte(consulta, fonte = "tiktok", max = 8) {
  const q = String(consulta || "").replace(/\s*site:\S+/g, "").replace(/\btiktok\b/gi, "").trim().slice(0, 200);
  if (!q) return { consulta: "", resultados: [], ok: false };
  const comGta = /gta|grand theft/i.test(q) ? q : q + " GTA 6";
  const [tiktok, wiki, yt, web] = await Promise.all([
    ate(buscarWeb(comGta + " site:tiktok.com", 5, { so: "ddglite" }), 6000),
    ate(buscarWeb(comGta, 3, { so: "fandom" }), 6000),
    ate(buscarWeb(comGta, 4, { so: "youtube" }), 6000),
    ate(buscarWeb(comGta, 5, { so: ["ddglite", "bing"] }), 6000),
  ]);
  const marcar = (lista, origem) => lista.map((x) => ({ ...x, origem }));
  const ordem = fonte === "youtube" ? [yt, tiktok, wiki, web] : fonte === "geral" || fonte === "reddit" ? [web, wiki, tiktok, yt] : [tiktok, wiki, yt, web];
  const nomes = new Map([[tiktok, "tiktok"], [wiki, "wiki do GTA"], [yt, "youtube"], [web, "web"]]);
  const lista = [];
  for (const r of ordem) for (const x of marcar(r.resultados || [], nomes.get(r))) {
    if (x.origem === "tiktok" && !/tiktok\.com/.test(x.url)) x.origem = "web";
    if (!lista.some((y) => y.url === x.url)) lista.push(x);
  }
  return { consulta: comGta, resultados: lista.slice(0, max), ok: lista.length > 0 };
}
