// Voz de IA: POST {texto, voz} -> áudio (WAV). Se falhar, o app usa a voz do próprio celular.
import { chaveGemini, falarGemini } from "./_gemini.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ erro: "Use POST" });
  const chave = chaveGemini(req);
  if (!chave) return res.status(401).json({ erro: "Sem chave do Gemini" });
  const { texto = "", voz = "Puck" } = req.body || {};
  try {
    const { audio, tipo } = await falarGemini({ chave, texto, voz });
    res.statusCode = 200;
    res.setHeader("Content-Type", tipo);
    res.setHeader("Cache-Control", "no-store");
    res.end(audio);
  } catch (e) {
    return res.status(e.status === 429 ? 429 : 502).json({ erro: String(e.message || e).slice(0, 200) });
  }
}
