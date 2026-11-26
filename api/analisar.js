// Recebe um frame da câmera (foto da TV com o jogo) e devolve dicas em JSON.
import { criarCliente, bancoTexto, erroIA, limparImagem } from "./_ia.js";
import { chaveGemini, gerarGemini, respostaErroGemini } from "./_gemini.js";

const SYSTEM = `Você é o "Copiloto", um parceiro de jogo que assiste a partida de GTA VI junto com o jogador.
O jogador apontou a câmera do celular para a TV/monitor. A imagem pode estar torta, com reflexo, moiré ou desfocada.

Como ler a tela:
- Use minimapa/radar, ícones, placas de rua, letreiros de lojas, praias, pântanos, skyline, veículo, roupa, horário e clima.
- O jogo se passa no estado de Leonida (inspirado na Flórida), com Vice City e regiões ao redor. Protagonistas: Lucia e Jason.
- Se não der pra ler algo, diga "parece" ou "não deu pra ver". NUNCA invente nome de missão, local exato ou mecânica que você não tem certeza. Prefira dicas gerais e verdadeiras a dicas específicas inventadas.

O que entregar:
- dica: 1 dica prática pro momento exato (combate, fuga da polícia, direção, missão, economia).
- curiosidade: 1 fato curto e interessante ligado ao que aparece (lugar real que inspirou, cultura da Flórida, detalhe da série GTA). Sem spoiler de história, a menos que o jogador permita.
- perto: até 3 coisas pra fazer por perto, baseadas no que aparece no minimapa/cenário (ícones, lojas, praia, água, estrada, eventos). Se não houver pistas, sugira atividades típicas do tipo de área.
- fala: 1 frase CURTA (máx 12 palavras), direto ao ponto, tom de parceiro de jogo, pra ser lida em voz alta rápido.
- dica/curiosidade/detalhe: frases curtas, sem enrolação (o jogo é rápido).
- Não repita dicas já dadas (lista em "já falei").
- Se a imagem não for uma tela de jogo (ou for menu/carregamento), marque tela_de_jogo=false e use os campos pra uma dica curta geral.
- Use o BANCO DE CONHECIMENTO abaixo como fonte principal. Itens "NÃO CONFIRMADO" só com aviso.
Responda em português do Brasil, direto, sem enrolação. Responda SOMENTE com o JSON pedido.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["tela_de_jogo", "local", "situacao", "dica", "curiosidade", "perto", "fala"],
  properties: {
    tela_de_jogo: { type: "boolean" },
    local: { type: "string", description: "Onde o jogador parece estar. Curto." },
    situacao: { type: "string", description: "O que está acontecendo. Curto." },
    dica: { type: "string" },
    curiosidade: { type: "string" },
    perto: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["titulo", "detalhe"],
        properties: { titulo: { type: "string" }, detalhe: { type: "string" } },
      },
    },
    fala: { type: "string" },
  },
};

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ erro: "Use POST" });

  const { imagem, historico = [], pergunta = "", spoilers = false, foco = "tudo" } = req.body || {};
  const data = limparImagem(imagem);
  if (!data) return res.status(400).json({ erro: "Faltou a imagem (ou é grande demais)" });

  const contexto = [
    `Foco do jogador: ${foco}.`,
    `Spoilers de história: ${spoilers ? "permitidos" : "proibidos"}.`,
    historico.length ? `Já falei: ${historico.slice(-8).map((h) => `- ${h}`).join("\n")}` : "Já falei: nada ainda.",
    pergunta ? `Pergunta do jogador (responda na dica e na fala): ${pergunta}` : "",
  ].filter(Boolean).join("\n");

  const gkey = chaveGemini(req);
  if (gkey && !String(req.headers["x-user-key"] || "").startsWith("sk-ant-")) {
    try {
      const r = await gerarGemini({
        chave: gkey,
        system: SYSTEM + "\n\n" + bancoTexto(spoilers),
        partes: [{ imagem: data }, { texto: contexto }],
        schema: SCHEMA,
        maxTokens: 4000,
      });
      return res.status(200).json(JSON.parse(r.texto.slice(r.texto.indexOf("{"), r.texto.lastIndexOf("}") + 1)));
    } catch (e) {
      if (e instanceof SyntaxError) return res.status(502).json({ erro: "Resposta do Gemini veio quebrada." });
      return respostaErroGemini(e, res);
    }
  }

  const ia = criarCliente(req);
  if (!ia) return res.status(401).json({ erro: "Sem acesso à IA. Publique na Vercel (AI Gateway) ou cole uma chave nas configurações." });

  try {
    const response = await ia.client.messages.create({
      model: ia.modelo,
      max_tokens: 2000,
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      system: [
        { type: "text", text: SYSTEM },
        { type: "text", text: bancoTexto(spoilers), cache_control: { type: "ephemeral" } },
      ],
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data } },
            { type: "text", text: contexto },
          ],
        },
      ],
    });

    if (response.stop_reason === "refusal") return res.status(422).json({ erro: "A IA recusou esse frame. Tenta de novo." });
    if (response.stop_reason === "max_tokens") return res.status(502).json({ erro: "Resposta cortada. Tenta de novo." });

    const texto = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    const json = JSON.parse(texto.slice(texto.indexOf("{"), texto.lastIndexOf("}") + 1));
    return res.status(200).json(json);
  } catch (e) {
    return erroIA(e, res);
  }
}

export const config = { api: { bodyParser: { sizeLimit: "8mb" } } };
