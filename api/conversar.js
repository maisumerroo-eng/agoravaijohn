// Conversa por voz com o "Parça": amigo de jogo que vê a tela, sabe do banco e pesquisa na internet.
import { criarCliente, bancoTexto, erroIA, limparImagem } from "./_ia.js";

const persona = (nome) => `Você é o Parça, melhor amigo do ${nome} e parceiro de jogatina. Vocês estão jogando GTA VI juntos: ele joga, você assiste pela câmera do celular apontada pra TV e conversa por voz.

Jeito de ser:
- Fala como amigo brasileiro, natural e animado, chama ele de ${nome} de vez em quando. Zoa de leve quando ele erra, comemora quando ele manda bem.
- Sua resposta vai ser FALADA em voz alta: frases curtas, sem markdown, sem listas, sem emoji, sem links. Normalmente 1 a 3 frases. Só fala mais se ele pedir detalhe ou passo a passo.
- Pode conversar sobre qualquer assunto, não só o jogo, como um amigo faria.

Conhecimento:
- Use o BANCO DE CONHECIMENTO abaixo primeiro. Itens "NÃO CONFIRMADO" só com aviso ("dizem que...").
- Se a pergunta for sobre história, missões, finais, escolhas, glitches, colecionáveis, patches, preços ou algo que você não tem certeza: PESQUISE na web antes de responder. GTA VI saiu em 19/11/2026, então coisa nova muda rápido.
- Glitches: explique como funcionam, avise se já foi corrigido e o risco (perder save, ban online).
- Spoilers da história: ${"{SPOILERS}"}
- Se receber a imagem da tela, use pra entender onde ele está e o que está acontecendo. Se a imagem não ajudar, ignore.
- Nunca invente nome de missão, local ou mecânica. Se não souber e a busca não ajudar, fala que não achou.`;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ erro: "Use POST" });
  const ia = criarCliente(req);
  if (!ia) return res.status(401).json({ erro: "Sem acesso à IA. Publique na Vercel ou cole uma chave nas configurações." });

  const { mensagem = "", historico = [], imagem, nome = "John", spoilers = false, local = "" } = req.body || {};
  const texto = String(mensagem).trim().slice(0, 1000);
  if (!texto) return res.status(400).json({ erro: "Mensagem vazia" });

  const nomeLimpo = String(nome).replace(/[^\p{L} '-]/gu, "").slice(0, 30) || "John";
  const system = persona(nomeLimpo).replace(
    "{SPOILERS}",
    spoilers ? "liberados, pode contar." : "PROIBIDOS. Se ele perguntar algo que entrega a história, avisa que é spoiler e pergunta se ele quer saber mesmo."
  );

  // Histórico: só turnos válidos, alternando user/assistant, últimos 12.
  const msgs = [];
  for (const t of historico.slice(-12)) {
    if ((t?.role === "user" || t?.role === "assistant") && typeof t.content === "string" && t.content.trim()) {
      if (msgs.length && msgs.at(-1).role === t.role) msgs.at(-1).content += "\n" + t.content;
      else msgs.push({ role: t.role, content: t.content.slice(0, 2000) });
    }
  }
  while (msgs.length && msgs[0].role !== "user") msgs.shift();
  if (msgs.length && msgs.at(-1).role === "user") msgs.pop();

  const conteudo = [];
  const img = limparImagem(imagem);
  if (img) conteudo.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: img } });
  conteudo.push({ type: "text", text: (local ? `(Última leitura da tela: ${String(local).slice(0, 200)})\n` : "") + texto });
  msgs.push({ role: "user", content: conteudo });

  try {
    let resposta;
    // pause_turn = a busca na web ainda não terminou; continua do ponto onde parou.
    for (let i = 0; i < 3; i++) {
      resposta = await ia.client.messages.create({
        model: ia.modelo,
        max_tokens: 3000,
        output_config: { effort: "low" },
        system: [
          { type: "text", text: system },
          { type: "text", text: bancoTexto(spoilers), cache_control: { type: "ephemeral" } },
        ],
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
        messages: msgs,
      });
      if (resposta.stop_reason !== "pause_turn") break;
      msgs.push({ role: "assistant", content: resposta.content });
    }

    if (resposta.stop_reason === "refusal") return res.status(200).json({ fala: "Opa, essa eu não posso responder, mano.", fontes: [] });

    const fala = resposta.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
    const fontes = [];
    for (const b of resposta.content) {
      if (b.type === "web_search_tool_result" && Array.isArray(b.content)) {
        for (const r of b.content) if (r.url && fontes.length < 4 && !fontes.some((f) => f.url === r.url)) fontes.push({ titulo: r.title, url: r.url });
      }
    }
    const pesquisou = resposta.content.some((b) => b.type === "server_tool_use");
    return res.status(200).json({ fala: fala || "Não consegui pensar em nada agora, repete aí?", fontes, pesquisou });
  } catch (e) {
    return erroIA(e, res);
  }
}

export const config = { api: { bodyParser: { sizeLimit: "8mb" } } };
