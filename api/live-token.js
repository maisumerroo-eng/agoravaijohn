// POST {nome, spoilers, voz} -> {token, modelo, url}: token temporário (30 min) pro modo ao vivo.
import { criarTokenLive, URL_LIVE } from "./_live.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ erro: "Use POST" });
  try {
    const { nome, spoilers, voz } = req.body || {};
    const t = await criarTokenLive(req, { nome: String(nome || "John").slice(0, 30), spoilers: !!spoilers, voz });
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ ...t, url: URL_LIVE });
  } catch (e) {
    return res.status(e.status === 429 ? 429 : e.status === 401 ? 401 : 502).json({ erro: String(e.message || e).slice(0, 200) });
  }
}
