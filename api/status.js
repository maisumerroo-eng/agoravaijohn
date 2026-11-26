// Diagnóstico: qual IA o servidor está usando. Mostra só NOMES de variáveis, nunca valores.
export default function handler(req, res) {
  const nomes = Object.keys(process.env);
  const gem = nomes.filter((k) => /gem[ei]n/i.test(k));
  const chaveOk = gem.filter((k) => /^AIza[\w-]{20,}$/.test(String(process.env[k]).trim()));
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    versao: "2026-11-26b",
    ia: chaveOk.length ? "gemini" : process.env.ANTHROPIC_API_KEY ? "anthropic" : "vercel-ai-gateway",
    variaveis_gemini_encontradas: gem,
    com_formato_de_chave_google: chaveOk,
    ambiente: process.env.VERCEL_ENV || "local",
  });
}
