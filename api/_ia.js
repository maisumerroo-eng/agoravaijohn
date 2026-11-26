// Compartilhado: cliente da IA (Vercel AI Gateway ou chave própria) + banco do GTA VI.
import Anthropic from "@anthropic-ai/sdk";
import BANCO from "../public/gta6.json" with { type: "json" };

export { Anthropic };

const linha = (i) =>
  `[${i.tipo}] ${i.nome}${i.tags?.length ? ` (${i.tags.join(", ")})` : ""}: ${i.texto}` +
  `${i.confirmado === false ? " (NÃO CONFIRMADO)" : ""}${i.spoiler ? " (SPOILER)" : ""}`;
const TXT_SEM = BANCO.itens.filter((i) => !i.spoiler).map(linha).join("\n");
const TXT_COM = BANCO.itens.map(linha).join("\n");
export const bancoTexto = (spoilers) => "BANCO DE CONHECIMENTO GTA VI:\n" + (spoilers ? TXT_COM : TXT_SEM);

// Padrão: Claude Haiku 5.5 via Vercel AI Gateway (crédito grátis da Vercel, sem chave).
// Com chave própria da Anthropic (sk-ant-...) vai direto na Anthropic.
export function criarCliente(req) {
  const chaveUsuario = String(req.headers["x-user-key"] || "");
  const propria = chaveUsuario.startsWith("sk-ant-") ? chaveUsuario : process.env.ANTHROPIC_API_KEY;
  if (propria) return { client: new Anthropic({ apiKey: propria }), modelo: "claude-haiku-5-5" };
  const token = process.env.AI_GATEWAY_API_KEY || req.headers["x-vercel-oidc-token"] || process.env.VERCEL_OIDC_TOKEN;
  if (!token) return null;
  return {
    client: new Anthropic({ apiKey: token, baseURL: "https://ai-gateway.vercel.sh" }),
    modelo: process.env.MODELO || "anthropic/claude-haiku-5.5",
  };
}

export function erroIA(e, res) {
  if (e instanceof Anthropic.AuthenticationError) return res.status(401).json({ erro: "Acesso à IA inválido." });
  if (e instanceof Anthropic.RateLimitError) return res.status(429).json({ erro: "Muitas requisições. Espera um pouco." });
  if (e instanceof Anthropic.PermissionDeniedError || e?.status === 402) {
    const msg = String(e?.error?.error?.message || e?.message || "").slice(0, 300);
    console.error(e.status, msg);
    const credito = /credit|balance|quota|insufficient|billing/i.test(msg);
    return res.status(402).json({ erro: credito ? "Sem crédito na IA da Vercel: " + msg : "IA recusou o acesso: " + msg });
  }
  if (e instanceof Anthropic.APIError) {
    console.error(e.status, e.message);
    return res.status(502).json({ erro: `Erro da IA (${e.status ?? "rede"})` });
  }
  if (e instanceof SyntaxError) return res.status(502).json({ erro: "Resposta da IA veio quebrada." });
  console.error(e);
  return res.status(500).json({ erro: "Erro interno" });
}

export const limparImagem = (img) =>
  typeof img === "string" && img.length < 6_000_000 ? img.replace(/^data:image\/\w+;base64,/, "") : null;
