// Gemini (Google AI Studio) via REST — plano grátis sem cartão. Usa os modelos Flash-Lite (mais rápidos
// e com mais cota grátis). A chave vem da env GEMINI_API_KEY ou do header x-gemini-key (configurações do app).
const BASE_PADRAO = "https://generativelanguage.googleapis.com/v1beta";
const base = () => process.env.GEMINI_BASE || BASE_PADRAO; // lido na hora (Cloudflare preenche o env por requisição)
const PREFERIDOS = [/^gemini-3\.\d+-flash-lite$/, /^gemini-2\.5-flash-lite$/, /^gemini-[\d.]+-flash-lite/, /^gemini-[\d.]+-flash$/];

// Aceita GEMINI_API_KEY ou qualquer variável com "gemini"/"geminina"/etc. no nome.
// Limpa aspas, espaços e um eventual "NOME=" colado junto do valor.
export const limparChave = (v) => String(v || "").trim().replace(/^[\w-]+\s*=\s*/, "").replace(/^["'`]+|["'`;]+$/g, "").trim();
const chaveEnv = () => {
  if (process.env.GEMINI_API_KEY) return limparChave(process.env.GEMINI_API_KEY);
  const achada = Object.entries(process.env).find(([k, v]) =>
    /gem[ei]n/i.test(k) && !/BASE|MODELO|TTS|PENSAMENTO/i.test(k) && !/^https?:/i.test(String(v)) && limparChave(v).length >= 20);
  return achada ? limparChave(achada[1]) : null;
};
export const chaveGemini = (req) => String(req.headers["x-gemini-key"] || "").trim() || chaveEnv();

// Lista de modelos candidatos (mais rápidos/baratos primeiro). Se um der "sem cota" (429), tenta o próximo.
let listaCache = null, modeloBom = null, buscaBloqueadaAte = 0;
async function listarModelos(chave) {
  if (process.env.GEMINI_MODELO) return [process.env.GEMINI_MODELO];
  if (listaCache && Date.now() - listaCache.em < 6 * 3600e3) return listaCache.nomes;
  const r = await fetch(`${base()}/models?pageSize=200`, { headers: { "x-goog-api-key": chave } });
  if (!r.ok) throw await erroGemini(r);
  const { models = [] } = await r.json();
  const nomes = models
    .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
    .map((m) => m.name.replace(/^models\//, ""))
    .filter((n) => !/preview|exp|tts|image|live|audio|embedding|robotics|computer/i.test(n));
  const ordem = [];
  for (const re of PREFERIDOS) for (const n of nomes.filter((n) => re.test(n)).sort().reverse()) if (!ordem.includes(n)) ordem.push(n);
  if (!ordem.length) throw Object.assign(new Error("Nenhum modelo Gemini Flash disponível pra essa chave."), { status: 404 });
  listaCache = { nomes: ordem.slice(0, 6), em: Date.now() };
  return listaCache.nomes;
}

async function erroGemini(r) {
  let msg = "";
  try { msg = (await r.json())?.error?.message || ""; } catch {}
  return Object.assign(new Error(msg || `Gemini ${r.status}`), { status: r.status, gemini: true });
}

export function respostaErroGemini(e, res, chave = "") {
  const msg = String(e.message || "").slice(0, 200);
  if (/^vck_/.test(chave)) return res.status(401).json({ erro: "Essa chave é da Vercel (vck_), não do Google. Pegue a do Gemini em aistudio.google.com/apikey." });
  if (e.status === 429) return res.status(429).json({ erro: "Limite grátis do Google atingido. Espera um pouco ou aumenta o intervalo. (" + msg.slice(0, 160) + ")" });
  if (e.status === 400 && /api key/i.test(msg)) return res.status(401).json({ erro: "Chave do Gemini inválida." });
  if (e.status === 403) return res.status(401).json({ erro: "Chave do Gemini sem permissão: " + msg });
  return res.status(502).json({ erro: "Erro no Gemini: " + msg });
}

// Pensamento BAIXO (padrão): o jogo é rápido, prioriza velocidade. Muda com a env GEMINI_PENSAMENTO
// (minimal | low | medium | high). Gemini 3 usa thinkingLevel; 2.5 usa thinkingBudget.
const nivel = () => process.env.GEMINI_PENSAMENTO || "low";
const ORCAMENTO_25 = { minimal: 0, low: 512, medium: 2048, high: 8192 };
const pensar = (m) => (/^gemini-2\./.test(m) ? { thinkingBudget: ORCAMENTO_25[nivel()] ?? 512 } : { thinkingLevel: nivel() });

// JSON Schema (o do Claude) -> schema OpenAPI que o Gemini aceita.
export function paraSchemaGemini(s) {
  const t = { type: String(s.type).toUpperCase() };
  if (s.description) t.description = s.description;
  if (s.properties) {
    t.properties = Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, paraSchemaGemini(v)]));
    if (s.required) t.required = s.required;
  }
  if (s.items) t.items = paraSchemaGemini(s.items);
  return t;
}

const imagemParte = (b64) => ({ inline_data: { mime_type: "image/jpeg", data: b64 } });

// Ferramenta de busca grátis (DuckDuckGo) que o Gemini pode chamar quando a busca do Google está sem cota.
const FERRAMENTA_BUSCA = {
  functionDeclarations: [{
    name: "pesquisar_web",
    description: "Pesquisa na internet. Use para fatos recentes do GTA VI (notas, patches, glitches, missões, datas, preços) que não estão no banco de conhecimento.",
    parameters: { type: "OBJECT", properties: { consulta: { type: "STRING", description: "Termos de busca curtos, de preferência em inglês e com 'GTA 6'." } }, required: ["consulta"] },
  }],
};

// Lê a resposta (stream SSE ou JSON) juntando texto, fontes do Google e chamadas de função.
async function lerResposta(r, aoTexto) {
  const out = { texto: "", fontes: [], pesquisou: false, chamadas: [] };
  const absorver = (j) => {
    const c = j.candidates?.[0];
    for (const p of c?.content?.parts || []) {
      if (p.functionCall) out.chamadas.push(p);           // guarda a parte inteira (inclui thoughtSignature)
      else if (p.text && !p.thought) { out.texto += p.text; aoTexto?.(p.text); }
    }
    const g = c?.groundingMetadata;
    if (g) {
      if (g.webSearchQueries?.length) out.pesquisou = true;
      for (const ch of g.groundingChunks || [])
        if (ch.web?.uri && out.fontes.length < 4 && !out.fontes.some((f) => f.url === ch.web.uri)) out.fontes.push({ titulo: ch.web.title, url: ch.web.uri });
    }
  };
  if (aoTexto) {
    const dec = new TextDecoder();
    let buf = "";
    for await (const pedaco of r.body) {
      buf += dec.decode(pedaco, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const linha = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (linha.startsWith("data:")) { try { absorver(JSON.parse(linha.slice(5))); } catch {} }
      }
    }
  } else absorver(await r.json());
  return out;
}

// Ordem: modelo que funcionou por último -> outros. Busca: 1) Google Search (se tiver cota); 2) busca grátis
// via função (DuckDuckGo); 3) sem busca, avisando pra não chutar. 429 = sem cota: próximo modelo.
export async function gerarGemini({ chave, system, historico = [], partes, schema, busca = false, maxTokens = 800, aoTexto }) {
  const { buscarWeb } = await import("./_busca.js");
  const lista = await listarModelos(chave);
  const modelos = modeloBom && lista.includes(modeloBom) ? [modeloBom, ...lista.filter((m) => m !== modeloBom)] : lista;
  const contents = [
    ...historico.map((h) => ({ role: h.role === "assistant" ? "model" : "user", parts: [{ text: h.content }] })),
    { role: "user", parts: partes.map((p) => (p.imagem ? imagemParte(p.imagem) : { text: p.texto })) },
  ];
  const AVISO_SEM_BUSCA = "\n\nATENÇÃO: a busca na internet está indisponível agora. NÃO chute números, notas, datas, preços ou fatos que não estão no banco. Se precisar disso, diga curto que não conseguiu pesquisar agora.";
  const AVISO_FUNCAO = "\n\nPra pesquisar na internet, chame a função pesquisar_web (só quando o banco não responde).";
  const montar = (modelo, opc, extra = []) => ({
    systemInstruction: { parts: [{ text: system + (opc.busca === "funcao" ? AVISO_FUNCAO : busca && !opc.busca ? AVISO_SEM_BUSCA : "") }] },
    contents: [...contents, ...extra],
    generationConfig: {
      maxOutputTokens: maxTokens,
      temperature: 0.7,
      ...(opc.pensar ? { thinkingConfig: pensar(modelo) } : {}),
      ...(schema ? { responseMimeType: "application/json", responseSchema: paraSchemaGemini(schema) } : {}),
    },
    ...(opc.busca === "google" ? { tools: [{ google_search: {} }] } : opc.busca === "funcao" ? { tools: [FERRAMENTA_BUSCA] } : {}),
  });
  const chamar = (modelo, opc, extra) =>
    fetch(`${base()}/models/${modelo}:${aoTexto ? "streamGenerateContent?alt=sse" : "generateContent"}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": chave },
      body: JSON.stringify(montar(modelo, opc, extra)),
    });

  const tentarGoogle = busca && Date.now() > buscaBloqueadaAte;
  const fases = [];
  if (tentarGoogle) fases.push([{ pensar: true, busca: "google" }, { pensar: false, busca: "google" }]);
  if (busca) fases.push([{ pensar: true, busca: "funcao" }, { pensar: false, busca: "funcao" }]);
  fases.push([{ pensar: true, busca: false }, { pensar: false, busca: false }]);

  let ultimoErro, erroBusca = busca && !tentarGoogle ? "busca do Google sem cota (pausada)" : null;
  for (const [fase, tentativas] of fases.entries()) for (const modelo of modelos) {
    if (tentarGoogle && fase === 1 && Date.now() > buscaBloqueadaAte) buscaBloqueadaAte = Date.now() + 10 * 60e3; // ninguém tinha Google Search
    let r = null, opcUsada = null;
    for (const opc of tentativas) {
      const resp = await chamar(modelo, opc);
      if (resp.ok) { r = resp; opcUsada = opc; break; }
      ultimoErro = await erroGemini(resp);
      ultimoErro.message = `[${modelo}] ${ultimoErro.message}`;
      if (opc.busca) erroBusca = `${resp.status}: ${ultimoErro.message.slice(0, 140)}`;
      if (resp.status === 400 && !/api key/i.test(ultimoErro.message)) continue; // parâmetro não suportado
      if (resp.status === 429 || resp.status === 404) break;                     // sem cota: próximo modelo
      throw ultimoErro;
    }
    if (!r) continue;
    modeloBom = modelo;
    let out = await lerResposta(r, aoTexto);

    // O modelo pediu pesquisa (busca grátis): pesquisa e pede a resposta final com os resultados.
    if (opcUsada.busca === "funcao" && out.chamadas.length) {
      const chamada = out.chamadas[0];
      const consulta = String(chamada.functionCall.args?.consulta || "").slice(0, 200);
      const achado = await buscarWeb(consulta);
      const fontesWeb = achado.resultados.slice(0, 4).map((x) => ({ titulo: x.titulo, url: x.url }));
      const extra = [
        { role: "model", parts: out.chamadas },
        { role: "user", parts: out.chamadas.map((c) => ({ functionResponse: { name: c.functionCall.name, response: c === chamada
          ? (achado.resultados.length ? { resultados: achado.resultados } : { erro: "busca não retornou nada; diga que não achou" })
          : { erro: "só uma busca por vez" } } })) },
      ];
      const r2 = await chamar(modelo, { pensar: opcUsada.pensar, busca: false }, extra);
      if (!r2.ok) throw await erroGemini(r2);
      const out2 = await lerResposta(r2, aoTexto);
      return { texto: (out.texto + out2.texto).trim(), fontes: fontesWeb, pesquisou: achado.resultados.length > 0, modelo,
        buscaIndisponivel: achado.resultados.length ? null : `busca grátis falhou (${achado.status || achado.erro || "0 resultados"})` };
    }
    return { texto: out.texto.trim(), fontes: out.fontes, pesquisou: out.pesquisou, modelo,
      buscaIndisponivel: busca && !opcUsada.busca ? erroBusca || "sem busca" : null };
  }
  throw ultimoErro;
}

// ---------- Voz de IA (Gemini TTS): fala quase humana em pt-BR ----------
export const VOZES_GEMINI = ["Puck", "Fenrir", "Charon", "Orus", "Kore", "Aoede", "Leda", "Zephyr"];
let ttsCache = null, ttsBom = null;
async function listarTTS(chave) {
  if (process.env.GEMINI_TTS) return [process.env.GEMINI_TTS];
  if (ttsCache && Date.now() - ttsCache.em < 6 * 3600e3) return ttsCache.nomes;
  const r = await fetch(`${base()}/models?pageSize=200`, { headers: { "x-goog-api-key": chave } });
  if (!r.ok) throw await erroGemini(r);
  const { models = [] } = await r.json();
  const nomes = models.map((m) => m.name.replace(/^models\//, "")).filter((n) => /tts/i.test(n));
  // Flash-Lite TTS primeiro (mais rápido / mais cota), depois Flash; versões novas antes.
  nomes.sort((a, b) => (/lite/.test(b) - /lite/.test(a)) || b.localeCompare(a));
  if (!nomes.length) throw Object.assign(new Error("Nenhum modelo de voz (TTS) disponível pra essa chave."), { status: 404 });
  ttsCache = { nomes: nomes.slice(0, 4), em: Date.now() };
  return ttsCache.nomes;
}

// PCM 16-bit mono -> WAV (o navegador toca direto).
function pcmParaWav(pcm, taxa = 24000) {
  const wav = new Uint8Array(44 + pcm.length);
  const v = new DataView(wav.buffer);
  const txt = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  txt(0, "RIFF"); v.setUint32(4, 36 + pcm.length, true); txt(8, "WAVE");
  txt(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, taxa, true); v.setUint32(28, taxa * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  txt(36, "data"); v.setUint32(40, pcm.length, true);
  wav.set(pcm, 44);
  return wav;
}

const b64ParaBytes = (b64) => {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

export async function falarGemini({ chave, texto, voz = "Puck" }) {
  texto = String(texto || "").replace(/\s+/g, " ").trim().slice(0, 800);
  if (!texto) throw Object.assign(new Error("texto vazio"), { status: 400 });
  const nomeVoz = VOZES_GEMINI.includes(voz) ? voz : "Puck";
  const lista = await listarTTS(chave);
  const modelos = ttsBom && lista.includes(ttsBom) ? [ttsBom, ...lista.filter((m) => m !== ttsBom)] : lista;
  const corpo = {
    contents: [{ role: "user", parts: [{ text: `Leia em português do Brasil, com sotaque brasileiro, voz de amigo animado e bem claro, ritmo natural: ${texto}` }] }],
    generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: nomeVoz } } } },
  };
  let ultimoErro;
  for (const modelo of modelos) {
    const r = await fetch(`${base()}/models/${modelo}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": chave },
      body: JSON.stringify(corpo),
    });
    if (!r.ok) {
      ultimoErro = await erroGemini(r);
      ultimoErro.message = `[${modelo}] ${ultimoErro.message}`;
      if (r.status === 429 || r.status === 404 || r.status === 400) continue;
      throw ultimoErro;
    }
    const j = await r.json();
    const parte = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData || p.inline_data);
    const dados = parte?.inlineData || parte?.inline_data;
    if (!dados?.data) { ultimoErro = new Error(`[${modelo}] veio sem áudio`); continue; }
    ttsBom = modelo;
    const taxa = Number(/rate=(\d+)/.exec(dados.mimeType || dados.mime_type || "")?.[1]) || 24000;
    const bytes = b64ParaBytes(dados.data);
    return /wav|mpeg|mp3|ogg/.test(dados.mimeType || "") ? { audio: bytes, tipo: dados.mimeType } : { audio: pcmParaWav(bytes, taxa), tipo: "audio/wav" };
  }
  throw ultimoErro || new Error("voz indisponível");
}
