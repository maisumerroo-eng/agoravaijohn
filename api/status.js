// Diagnóstico: qual IA o servidor está usando. Mostra só NOMES e formato (tamanho + 4 primeiros caracteres), nunca a chave.
import { limparChave } from "./_gemini.js";
import { buscarWeb } from "./_busca.js";
export default async function handler(req, res) {
  const gem = Object.keys(process.env).filter((k) => /gem[ei]n/i.test(k));
  const formato = Object.fromEntries(gem.map((k) => {
    const bruto = String(process.env[k] || "");
    const v = limparChave(bruto);
    return [k, { tamanho: v.length, comeca_com: v.slice(0, 4), tinha_espaco_ou_aspas: bruto !== v }];
  }));
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    versao: "2026-11-26g",
    ia: gem.some((k) => limparChave(process.env[k]).length >= 20) ? "gemini" : process.env.ANTHROPIC_API_KEY ? "anthropic" : "vercel-ai-gateway",
    variaveis_gemini: formato,
    ambiente: process.env.VERCEL_ENV || "local",
    ...(req.query?.busca ? { teste_busca: await buscarWeb(String(req.query.busca)).then((b) => ({ ok: b.ok, status: b.status, erro: b.erro, qtd: b.resultados.length, primeiro: b.resultados[0] })) } : {}),
  });
}
