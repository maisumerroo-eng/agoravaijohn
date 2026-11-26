// Conversa por voz com o "Parça": amigo de jogo que vê a tela, sabe do banco e pesquisa na internet.
// Responde em streaming (NDJSON): {"t":"pedaço"} ... {"fim":true,"fontes":[...],"pesquisou":bool}
// pra o app começar a falar já na primeira frase.
import { criarCliente, bancoTexto, erroIA, limparImagem } from "./_ia.js";
import { chaveGemini, gerarGemini, respostaErroGemini } from "./_gemini.js";

const persona = (nome, spoilers) => `Você é o Parça, melhor amigo do ${nome} e parceiro de jogatina. Vocês jogam GTA VI juntos: ele joga, você vê a TV pela câmera do celular e conversa por voz.

Jeito de falar (MUITO importante, o jogo é rápido):
- Respostas CURTAS: 1 frase, no máximo 2, até uns 25 palavras. Comece pela ação ("Entra no beco à esquerda e troca de carro.").
- Só se ele pedir passo a passo ou detalhe, fale mais — e mesmo assim em frases curtas.
- Fala de amigo brasileiro, natural e animado. Chama ele de ${nome} às vezes. Zoa de leve, comemora junto.
- Vai ser lido em voz alta: sem markdown, sem listas, sem emoji, sem links, sem parênteses longos.
- Pode conversar sobre qualquer assunto, como amigo.

Conhecimento:
- Use o BANCO DE CONHECIMENTO abaixo primeiro. Itens "NÃO CONFIRMADO" só com aviso ("dizem que...").
- Se for sobre história, missões, finais, glitches, colecionáveis, patches ou algo que você não tem certeza e não está no banco: pesquise na web. Se o banco já responde, NÃO pesquise (é mais rápido).
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

  const { mensagem = "", historico = [], imagem, nome = "John", spoilers = false, local = "" } = req.body || {};
  const texto = String(mensagem).trim().slice(0, 1000);
  if (!texto) return res.status(400).json({ erro: "Mensagem vazia" });

  const nomeLimpo = String(nome).replace(/[^\p{L} '-]/gu, "").slice(0, 30) || "John";
  const system = persona(nomeLimpo, !!spoilers);
  const msgs = limparHistorico(historico);
  const img = limparImagem(imagem);
  const textoUsuario = (local ? `(Última leitura da tela: ${String(local).slice(0, 200)})\n` : "") + texto;

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
        partes: [...(img ? [{ imagem: img }] : []), { texto: textoUsuario }],
        busca: true,
        maxTokens: 3000,
        aoTexto: (t) => { if (!comecou) { iniciarStream(); comecou = true; } enviar({ t }); },
      });
      if (!comecou) { iniciarStream(); enviar({ t: r.texto || "Não consegui pensar em nada, repete aí?" }); }
      enviar({ fim: true, fontes: r.fontes, pesquisou: r.pesquisou });
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
