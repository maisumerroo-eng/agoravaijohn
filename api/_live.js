// Modo AO VIVO (Gemini Live API): o celular manda vídeo da TV + voz contínuos e o Parça responde falando na hora.
// O servidor só cria um token temporário (a chave nunca vai pro celular) com a configuração TRAVADA.
import { bancoTexto } from "./_ia.js";
import { chaveGemini, VOZES_GEMINI } from "./_gemini.js";
import { persona } from "./conversar.js";

export const MODELO_LIVE = () => process.env.GEMINI_LIVE || "gemini-3.8-live";

const FERRAMENTA_BUSCA = {
  functionDeclarations: [{
    name: "pesquisar_web",
    description: "Pesquisa na internet. Use pra fatos recentes do GTA VI (notas, patches, glitches, missões, segredos) que não estão no banco.",
    parameters: { type: "OBJECT", properties: {
      consulta: { type: "STRING", description: "Termos curtos, de preferência em inglês e com 'GTA 6'." },
      fonte: { type: "STRING", enum: ["geral", "tiktok", "reddit", "youtube"], description: "tiktok/youtube = vídeos de dicas; reddit = comunidade." },
    }, required: ["consulta"] },
  }],
};

const AO_VIVO = `

MODO AO VIVO:
- Você recebe o vídeo da TV (câmera do celular apontada pra tela, pode ter reflexo/listras) e o áudio do microfone ao vivo.
  O áudio tem o som do jogo e da TV misturado: só responda quando for o jogador falando com você.
- Fale SEMPRE em português do Brasil, com jeito de amigo brasileiro. Frases curtas e claras, explicando mastigado.
- Seja proativo, mas sem encher: quando acontecer algo importante na tela (procurado, missão nova, lugar novo, perigo,
  oportunidade de dinheiro), comente em 1 ou 2 frases úteis. Se nada mudou, fique quieto.
- Se ele digitar algo, responda do mesmo jeito (falando).
- Pra pesquisar na internet use a função pesquisar_web (só quando o banco não responde).`;

export function montarSetup({ nome = "John", spoilers = false, voz = "Puck" } = {}) {
  return {
    model: `models/${MODELO_LIVE()}`,
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOZES_GEMINI.includes(voz) ? voz : "Puck" } } },
    },
    systemInstruction: { parts: [{ text: persona(nome, spoilers) + AO_VIVO + "\n\n" + bancoTexto(spoilers) }] },
    tools: [FERRAMENTA_BUSCA],
    realtimeInputConfig: {
      automaticActivityDetection: {
        disabled: false,
        startOfSpeechSensitivity: "START_SENSITIVITY_LOW", // menos sensível: o som da TV não dispara à toa
        endOfSpeechSensitivity: "END_SENSITIVITY_LOW",
        prefixPaddingMs: 200,
        silenceDurationMs: 700,
      },
    },
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    contextWindowCompression: { slidingWindow: {} }, // sessão sem limite de tempo
  };
}

// Campos travados no token (o celular não consegue mudar). sessionResumption fica livre pra reconectar.
const CAMPOS_TRAVADOS = ["model", "generationConfig", "systemInstruction", "tools", "realtimeInputConfig",
  "inputAudioTranscription", "outputAudioTranscription", "contextWindowCompression"];

export async function criarTokenLive(req, opcoes) {
  const chave = chaveGemini(req);
  if (!chave) throw Object.assign(new Error("Sem chave do Gemini"), { status: 401 });
  const agora = Date.now();
  const corpo = {
    uses: 1,
    expireTime: new Date(agora + 30 * 60e3).toISOString(),
    newSessionExpireTime: new Date(agora + 2 * 60e3).toISOString(),
    ...(opcoes?.semTrava ? {} : { bidiGenerateContentSetup: montarSetup(opcoes), fieldMask: CAMPOS_TRAVADOS.join(",") }),
  };
  const r = await fetch("https://generativelanguage.googleapis.com/v1beta/auth_tokens", {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": chave },
    body: JSON.stringify(corpo),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.name) throw Object.assign(new Error(j?.error?.message || `token falhou (${r.status})`), { status: r.status || 502 });
  return { token: j.name, modelo: MODELO_LIVE() };
}

export const URL_LIVE = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained";
