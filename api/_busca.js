// Busca grátis na web (sem chave): DuckDuckGo HTML. Devolve [{titulo, url, trecho}].
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const limpar = (h) => h.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
function urlReal(href) {
  try {
    const u = new URL(href, "https://duckduckgo.com");
    return u.searchParams.get("uddg") || u.href;
  } catch { return href; }
}
export async function buscarWeb(consulta, max = 5) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 6000);
  try {
    const r = await fetch("https://html.duckduckgo.com/html/", {
      method: "POST",
      headers: { "user-agent": UA, "content-type": "application/x-www-form-urlencoded", "accept-language": "pt-BR,pt;q=0.9,en;q=0.8" },
      body: new URLSearchParams({ q: consulta, kl: "br-pt" }),
      signal: ctrl.signal,
    });
    const html = await r.text();
    const res = [];
    const bloco = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    let m;
    while ((m = bloco.exec(html)) && res.length < max) {
      const url = urlReal(m[1]);
      if (/duckduckgo\.com\/y\.js|ad_domain/.test(url)) continue; // anúncios
      res.push({ titulo: limpar(m[2]), url, trecho: limpar(m[3]).slice(0, 300) });
    }
    return { ok: r.ok, status: r.status, resultados: res };
  } catch (e) {
    return { ok: false, status: 0, erro: String(e.message || e), resultados: [] };
  } finally {
    clearTimeout(t);
  }
}
