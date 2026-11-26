// Diagnóstico: qual IA o servidor está usando. Mostra só NOMES e formato (tamanho + 4 primeiros caracteres), nunca a chave.
import { limparChave, chaveGemini } from "./_gemini.js";
import { buscarWeb } from "./_busca.js";
import { criarTokenLive, URL_LIVE, MODELO_LIVE } from "./_live.js";
export default async function handler(req, res) {
  const gem = Object.keys(process.env).filter((k) => /gem[ei]n/i.test(k) && !/BASE|MODELO|TTS|PENSAMENTO/i.test(k));
  const formato = Object.fromEntries(gem.map((k) => {
    const bruto = String(process.env[k] || "");
    const v = limparChave(bruto);
    return [k, { tamanho: v.length, comeca_com: v.slice(0, 4), tinha_espaco_ou_aspas: bruto !== v }];
  }));
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    versao: "2026-11-27-live1",
    ia: gem.some((k) => limparChave(process.env[k]).length >= 20) ? "gemini" : process.env.ANTHROPIC_API_KEY ? "anthropic" : "vercel-ai-gateway",
    variaveis_gemini: formato,
    ambiente: process.env.VERCEL_ENV || "local",
    ...(req.query?.live ? { teste_live: await testarLive(req) } : {}),
    ...(req.query?.modelos ? { modelos: await listarNomes(chaveGemini(req)) } : {}),
    ...(req.query?.busca ? { teste_busca: (await buscarWeb(String(req.query.busca), 3, { todos: true })).relatorio } : {}),
  });
}

// Só nomes de modelos e métodos suportados (pra saber se a chave tem o modo ao vivo).
async function listarNomes(chave) {
  if (!chave) return "sem chave";
  const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { headers: { "x-goog-api-key": chave } });
  if (!r.ok) return `erro ${r.status}`;
  const { models = [] } = await r.json();
  return models
    .filter((m) => /live|native|audio|flash/i.test(m.name))
    .map((m) => `${m.name.replace("models/", "")} [${(m.supportedGenerationMethods || []).join(",")}]`);
}

// Teste ponta a ponta do modo ao vivo (só no Cloudflare): token -> websocket -> "diga oi" -> resposta.
async function testarLive(req) {
  const t0 = Date.now(), log = [];
  try {
    const modo = String(req.query.live);
    const { token } = await criarTokenLive(req, { nome: "John", semTrava: modo === "b" });
    log.push(`token ok ${Date.now() - t0}ms`);
    const r = await fetch(URL_LIVE.replace(/^wss:/, "https:") + "?access_token=" + encodeURIComponent(token), { headers: { Upgrade: "websocket" } });
    const ws = r.webSocket;
    if (!ws) return { log, erro: `upgrade falhou ${r.status}: ${(await r.text()).slice(0, 200)}` };
    ws.accept();
    let texto = "", bytesAudio = 0, mime = "", fim = null;
    const pronto = new Promise((ok) => {
      const tempo = setTimeout(() => ok("timeout"), 20000);
      ws.addEventListener("message", async (ev) => {
        const raw = typeof ev.data === "string" ? ev.data : new TextDecoder().decode(ev.data);
        if (log.length < 12) log.push("msg: " + raw.slice(0, 160));
        let m; try { m = JSON.parse(raw); } catch { return; }
        if (m.setupComplete) {
          log.push(`setupComplete ${Date.now() - t0}ms`);
          ws.send(JSON.stringify({ clientContent: { turns: [{ role: "user", parts: [{ text: "Diga só: oi John, tô na escuta." }] }], turnComplete: true } }));
        }
        const sc = m.serverContent;
        if (sc?.outputTranscription?.text) texto += sc.outputTranscription.text;
        for (const p of sc?.modelTurn?.parts || []) if (p.inlineData?.data) { bytesAudio += p.inlineData.data.length * 0.75; mime = p.inlineData.mimeType; if (!fim) fim = Date.now() - t0; }
        if (sc?.turnComplete) { clearTimeout(tempo); ok("turnComplete"); }
      });
      ws.addEventListener("close", (ev) => { clearTimeout(tempo); ok(`fechou ${ev.code} ${ev.reason || ""}`.slice(0, 200)); });
    });
    const { montarSetup } = await import("./_live.js");
    ws.send(JSON.stringify({ setup: modo === "b" ? montarSetup({ nome: "John" }) : { model: `models/${MODELO_LIVE()}` } }));
    log.push("setup enviado");
    const como = await pronto;
    try { ws.close(); } catch {}
    return { log, como, primeiro_audio_ms: fim, total_ms: Date.now() - t0, transcricao: texto, audio_kb: Math.round(bytesAudio / 1024), mime };
  } catch (e) {
    return { log, erro: String(e.message || e).slice(0, 300) };
  }
}
