// POST {consulta, fonte} -> resultados da busca grátis (TikTok primeiro). Usado pelo modo ao vivo.
import { buscarComFonte } from "./_busca.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ erro: "Use POST" });
  const { consulta = "", fonte = "tiktok" } = req.body || {};
  if (!String(consulta).trim()) return res.status(400).json({ erro: "consulta vazia" });
  return res.status(200).json(await buscarComFonte(consulta, fonte, 6));
}
