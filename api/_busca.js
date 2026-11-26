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

const BUSCADORES = {
  bing: async (q) => {
    const { status, html } = await pegar(`https://www.bing.com/search?q=${encodeURIComponent(q)}&setlang=pt-br&cc=br`);
    const res = [];
    for (const bloco of html.split('<li class="b_algo"').slice(1)) {
      const a = bloco.match(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
      const p = bloco.match(/<p[^>]*>([\s\S]*?)<\/p>/) || bloco.match(/class="b_lineclamp\d"[^>]*>([\s\S]*?)<\/(?:p|div)>/);
      if (a && /^https?:/.test(a[1])) res.push({ titulo: limpar(a[2]), url: a[1].replace(/&amp;/g, "&"), trecho: limpar(p?.[1]).slice(0, 300) });
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

let preferido = null; // o que funcionou por último vai primeiro

export async function buscarWeb(consulta, max = 5, { todos = false } = {}) {
  const ordem = Object.keys(BUSCADORES).sort((a, b) => (a === preferido ? -1 : b === preferido ? 1 : 0));
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
