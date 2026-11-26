// Diagnóstico: qual IA o servidor está usando. Mostra só NOMES e formato (tamanho + 4 primeiros caracteres), nunca a chave.
import { limparChave, chaveGemini } from "./_gemini.js";
import { buscarWeb } from "./_busca.js";
export default async function handler(req, res) {
  const gem = Object.keys(process.env).filter((k) => /gem[ei]n/i.test(k) && !/BASE|MODELO|TTS|PENSAMENTO/i.test(k));
  const formato = Object.fromEntries(gem.map((k) => {
    const bruto = String(process.env[k] || "");
    const v = limparChave(bruto);
    return [k, { tamanho: v.length, comeca_com: v.slice(0, 4), tinha_espaco_ou_aspas: bruto !== v }];
  }));
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    versao: "2026-11-27-cf3",
    ia: gem.some((k) => limparChave(process.env[k]).length >= 20) ? "gemini" : process.env.ANTHROPIC_API_KEY ? "anthropic" : "vercel-ai-gateway",
    variaveis_gemini: formato,
    ambiente: process.env.VERCEL_ENV || "local",
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
