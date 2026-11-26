// POST {consulta, fonte} -> resultados da busca grátis (usado pelo modo ao vivo quando o Parça pesquisa).
import { buscarWeb } from "./_busca.js";

const SITES = { tiktok: " site:tiktok.com", reddit: " site:reddit.com", youtube: " site:youtube.com" };
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ erro: "Use POST" });
  const { consulta = "", fonte = "geral" } = req.body || {};
  const q = String(consulta).slice(0, 200) + (SITES[fonte] || "");
  if (!q.trim()) return res.status(400).json({ erro: "consulta vazia" });
  const r = await buscarWeb(q, 5);
  return res.status(200).json({ consulta: q, resultados: r.resultados, ok: r.ok });
}
