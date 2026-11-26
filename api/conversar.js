// Conversa por voz com o "Parça": amigo de jogo que vê a tela, sabe do banco e pesquisa na internet.
// Responde em streaming (NDJSON): {"t":"pedaço"} ... {"fim":true,"fontes":[...],"pesquisou":bool}
// pra o app começar a falar já na primeira frase.
import { criarCliente, bancoTexto, erroIA, limparImagem } from "./_ia.js";
import { chaveGemini, gerarGemini, respostaErroGemini } from "./_gemini.js";

export const persona = (nome, spoilers) => `Você é o Parça, melhor amigo do ${nome} e parceiro de jogatina. Vocês jogam GTA VI juntos: ele joga, você vê a TV pela câmera do celular e conversa por voz.

Jeito de falar (MUITO importante — vai ser falado em voz alta durante o jogo):
- Explica MASTIGADO, como amigo que manja: o que fazer, onde fica e como fazer. Ex.: "Pega a moto e vai pro norte pela avenida da praia. O galpão vermelho fica do lado direito, perto das três piscinas. Entra pelos fundos."
- 2 a 4 frases curtas e claras, uma ideia por frase. Palavras simples, sem gíria difícil, sem siglas sem explicar.
- Comece pela ação principal. Se tiver passo a passo, fale em ordem: "Primeiro... Depois... Por último...".
- Só se ele pedir detalhe completo, fale mais — e mesmo assim em frases curtas.
- Fala de amigo brasileiro, natural e animado. Chama ele de ${nome} às vezes. Zoa de leve, comemora junto.
- Vai ser lido em voz alta: sem markdown, sem listas, sem emoji, sem links, sem parênteses longos.
- Pode conversar sobre qualquer assunto, como amigo.

Entendendo o que ele fala:
- A mensagem vem do microfone, com o barulho do jogo e da TV ao fundo. Se vier ÁUDIO, escute e entenda você mesmo.
- Se vier texto de reconhecimento de voz, pode ter palavras trocadas ("parça" vira "passa", "estrela" vira "estela"...). Interprete pela
  intenção, pensando no contexto do GTA. Se não fizer sentido nenhum, peça pra ele repetir, em uma frase curta.

Conhecimento (MUITO importante):
- GTA VI saiu em 19/11/2026, DEPOIS do seu treino: o que você "lembra" do jogo é velho ou errado. Só confie no BANCO abaixo e na pesquisa.
- Se a pergunta for sobre algo do jogo que NÃO está no banco: PESQUISE antes de responder (função pesquisar_web, fonte principal "tiktok").
- NUNCA diga que algo "não existe" ou "não tem no jogo" sem pesquisar antes. O jogo é enorme e tem muita coisa escondida.
- Itens "NÃO CONFIRMADO" do banco só com aviso ("dizem que...").
- Se o banco já responde, NÃO pesquise (é mais rápido). Se não responde ou você tem dúvida, pesquise.
- A fonte principal é o TikTok (fonte "tiktok"): é onde mais tem dica, segredo e glitch do GTA VI. Use "youtube"/"reddit"/"geral" se precisar.
- Ao responder com base na pesquisa, diga de onde veio ("vi no TikTok que...").
- Glitches: diga se já foi corrigido e o risco.
- Spoilers da história: ${spoilers ? "liberados." : "PROIBIDOS. Se a pergunta entrega a história, avisa que é spoiler e pergunta se ele quer saber."}
- Se vier imagem da tela, use pra entender onde ele está. Se não ajudar, ignore.
- Nunca invente nome de missão, local ou mecânica. Se não souber, fala que não achou.`;

function limparHistorico(historico) {
  const msgs = [];
  for (const t of (Array.isArray(historico) ? historico : []).slice(-12)) {
    if ((t?.role === "user" || t?.role === "assistant") && typeof t.content === "string" && t.content.trim()) {
      if (msgs.length && msgs.at(-1).role === t.role) msgs.at(-1).content += "\n" + t.content;
      else msgs.push({ role: t.role, content: t.content.slice(0, 2000) });
    }
  }
  while (msgs.length && msgs[0].role !== "user") msgs.shift();
  if (msgs.length && msgs.at(-1).role === "user") msgs.pop();
  return msgs;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ erro: "Use POST" });

  const { mensagem = "", historico = [], imagem, audio, alternativas = [], nome = "John", spoilers = false, local = "" } = req.body || {};
  const audioB64 = typeof audio === "string" && audio.length < 4_000_000 ? audio.replace(/^data:audio\/\w+;base64,/, "") : null;
  const alts = (Array.isArray(alternativas) ? alternativas : []).map(String).filter(Boolean).slice(0, 3);
  const texto = String(mensagem).trim().slice(0, 1000) ||
    (audioB64 ? "(O jogador falou no áudio anexo. Entenda e responda.)" : "");
  if (!texto) return res.status(400).json({ erro: "Mensagem vazia" });

  const nomeLimpo = String(nome).replace(/[^\p{L} '-]/gu, "").slice(0, 30) || "John";
  const system = persona(nomeLimpo, !!spoilers);
  const msgs = limparHistorico(historico);
  const img = limparImagem(imagem);
  const textoUsuario = (local ? `(Última leitura da tela: ${String(local).slice(0, 200)})\n` : "") + texto +
    (alts.length ? `\n(O reconhecimento de voz também ouviu: ${alts.map((a) => `"${a.slice(0, 200)}"`).join(" ou ")})` : "");

  const iniciarStream = () => {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("X-Accel-Buffering", "no");
  };
  const enviar = (obj) => res.write(JSON.stringify(obj) + "\n");

  // ---- Gemini (grátis, sem cartão) ----
  const gkey = chaveGemini(req);
  if (gkey && !String(req.headers["x-user-key"] || "").startsWith("sk-ant-")) {
    let comecou = false;
    try {
      const r = await gerarGemini({
        chave: gkey,
        system: system + "\n\n" + bancoTexto(spoilers),
        historico: msgs,
        partes: [...(img ? [{ imagem: img }] : []), ...(audioB64 ? [{ audio: audioB64 }] : []), { texto: textoUsuario }],
        busca: true,
        maxTokens: 3000,
        aoTexto: (t) => { if (!comecou) { iniciarStream(); comecou = true; } enviar({ t }); },
      });
      if (!comecou) { iniciarStream(); enviar({ t: r.texto || "Não consegui pensar em nada, repete aí?" }); }
      enviar({ fim: true, fontes: r.fontes, pesquisou: r.pesquisou, modelo: r.modelo, buscaIndisponivel: r.buscaIndisponivel });
      return res.end();
    } catch (e) {
      if (comecou) { enviar({ erro: "Caiu no meio da resposta." }); return res.end(); }
      return respostaErroGemini(e, res, gkey);
    }
  }

  // ---- Claude (Vercel AI Gateway ou chave própria) ----
  const ia = criarCliente(req);
  if (!ia) return res.status(401).json({ erro: "Sem acesso à IA. Coloque a chave grátis do Gemini nas configurações." });

  const conteudo = [];
  if (img) conteudo.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: img } });
  conteudo.push({ type: "text", text: textoUsuario });
  msgs.push({ role: "user", content: conteudo });

  try {
    let resposta;
    // pause_turn = a busca na web ainda não terminou; continua do ponto onde parou.
    for (let i = 0; i < 3; i++) {
      resposta = await ia.client.messages.create({
        model: ia.modelo,
        max_tokens: 1500,
        output_config: { effort: "low" },
        system: [
          { type: "text", text: system },
          { type: "text", text: bancoTexto(spoilers), cache_control: { type: "ephemeral" } },
        ],
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 2 }],
        messages: msgs,
      });
      if (resposta.stop_reason !== "pause_turn") break;
      msgs.push({ role: "assistant", content: resposta.content });
    }

    const fala = resposta.stop_reason === "refusal"
      ? "Opa, essa eu não posso responder, mano."
      : resposta.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
    const fontes = [];
    for (const b of resposta.content) {
      if (b.type === "web_search_tool_result" && Array.isArray(b.content)) {
        for (const r of b.content) if (r.url && fontes.length < 4 && !fontes.some((f) => f.url === r.url)) fontes.push({ titulo: r.title, url: r.url });
      }
    }
    iniciarStream();
    enviar({ t: fala || "Não consegui pensar em nada agora, repete aí?" });
    enviar({ fim: true, fontes, pesquisou: resposta.content.some((b) => b.type === "server_tool_use") });
    return res.end();
  } catch (e) {
    return erroIA(e, res);
  }
}

export const config = { api: { bodyParser: { sizeLimit: "8mb" } } };
