// Gemini (Google AI Studio) via REST — plano grátis sem cartão. Usa os modelos Flash-Lite (mais rápidos
// e com mais cota grátis). A chave vem da env GEMINI_API_KEY ou do header x-gemini-key (configurações do app).
const BASE = process.env.GEMINI_BASE || "https://generativelanguage.googleapis.com/v1beta";
const PREFERIDOS = [/^gemini-3\.\d+-flash-lite$/, /^gemini-2\.5-flash-lite$/, /^gemini-[\d.]+-flash-lite/, /^gemini-[\d.]+-flash$/];

// Aceita GEMINI_API_KEY ou qualquer variável com "gemini"/"geminina"/etc. no nome.
// Limpa aspas, espaços e um eventual "NOME=" colado junto do valor.
export const limparChave = (v) => String(v || "").trim().replace(/^[\w-]+\s*=\s*/, "").replace(/^["'`]+|["'`;]+$/g, "").trim();
const chaveEnv = () => {
  if (process.env.GEMINI_API_KEY) return limparChave(process.env.GEMINI_API_KEY);
  const achada = Object.entries(process.env).find(([k, v]) => /gem[ei]n/i.test(k) && limparChave(v).length >= 20);
  return achada ? limparChave(achada[1]) : null;
};
export const chaveGemini = (req) => String(req.headers["x-gemini-key"] || "").trim() || chaveEnv();

// Lista de modelos candidatos (mais rápidos/baratos primeiro). Se um der "sem cota" (429), tenta o próximo.
let listaCache = null, modeloBom = null;
async function listarModelos(chave) {
  if (process.env.GEMINI_MODELO) return [process.env.GEMINI_MODELO];
  if (listaCache && Date.now() - listaCache.em < 6 * 3600e3) return listaCache.nomes;
  const r = await fetch(`${BASE}/models?pageSize=200`, { headers: { "x-goog-api-key": chave } });
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

// Pensamento MÉDIO (padrão): respostas melhores sem ficar lento demais. Muda com a env GEMINI_PENSAMENTO
// (minimal | low | medium | high). Gemini 3 usa thinkingLevel; 2.5 usa thinkingBudget.
const NIVEL = process.env.GEMINI_PENSAMENTO || "medium";
const ORCAMENTO_25 = { minimal: 0, low: 512, medium: 2048, high: 8192 };
const pensar = (m) => (/^gemini-2\./.test(m) ? { thinkingBudget: ORCAMENTO_25[NIVEL] ?? 2048 } : { thinkingLevel: NIVEL });

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

// Tenta: modelo que funcionou por último -> outros da lista. Em cada um: com pensamento+busca -> sem pensamento
// -> sem busca. 429 (sem cota) pula pro próximo modelo; 400 de parâmetro tenta a versão mais simples.
export async function gerarGemini({ chave, system, historico = [], partes, schema, busca = false, maxTokens = 800, aoTexto }) {
  const lista = await listarModelos(chave);
  const modelos = modeloBom && lista.includes(modeloBom) ? [modeloBom, ...lista.filter((m) => m !== modeloBom)] : lista;
  const contents = [
    ...historico.map((h) => ({ role: h.role === "assistant" ? "model" : "user", parts: [{ text: h.content }] })),
    { role: "user", parts: partes.map((p) => (p.imagem ? imagemParte(p.imagem) : { text: p.texto })) },
  ];
  const AVISO_SEM_BUSCA = "\n\nATENÇÃO: a busca na internet está indisponível agora. NÃO chute números, notas, datas, preços ou fatos que não estão no banco. Se precisar disso, diga curto que não conseguiu pesquisar agora.";
  const montar = (modelo, opc) => ({
    systemInstruction: { parts: [{ text: system + (busca && !opc.busca ? AVISO_SEM_BUSCA : "") }] },
    contents,
    generationConfig: {
      maxOutputTokens: maxTokens,
      temperature: 0.7,
      ...(opc.pensar ? { thinkingConfig: pensar(modelo) } : {}),
      ...(schema ? { responseMimeType: "application/json", responseSchema: paraSchemaGemini(schema) } : {}),
    },
    ...(opc.busca ? { tools: [{ google_search: {} }] } : {}),
  });

  // Fase 1 (se pediu busca): tenta a busca em TODOS os modelos (no grátis às vezes só alguns têm cota de busca).
  // Fase 2: sem busca, no primeiro modelo com cota.
  const fases = busca
    ? [[{ pensar: true, busca: true }, { pensar: false, busca: true }], [{ pensar: true, busca: false }, { pensar: false, busca: false }]]
    : [[{ pensar: true, busca: false }, { pensar: false, busca: false }]];
  let ultimoErro, erroBusca = null;
  for (const tentativas of fases) for (const modelo of modelos) {
    let r = null, opcUsada = null;
    for (const opc of tentativas) {
      const url = `${BASE}/models/${modelo}:${aoTexto ? "streamGenerateContent?alt=sse" : "generateContent"}`;
      const resp = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": chave },
        body: JSON.stringify(montar(modelo, opc)),
      });
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
    let texto = "";
    const fontes = [];
    let pesquisou = false;
    const absorver = (j) => {
      const c = j.candidates?.[0];
      for (const p of c?.content?.parts || []) {
        if (p.text && !p.thought) { texto += p.text; aoTexto?.(p.text); }
      }
      const g = c?.groundingMetadata;
      if (g) {
        if (g.webSearchQueries?.length) pesquisou = true;
        for (const ch of g.groundingChunks || []) {
          if (ch.web?.uri && fontes.length < 4 && !fontes.some((f) => f.url === ch.web.uri)) fontes.push({ titulo: ch.web.title, url: ch.web.uri });
        }
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
    } else {
      absorver(await r.json());
    }
    return { texto: texto.trim(), fontes, pesquisou, modelo, buscaIndisponivel: busca && !opcUsada.busca ? erroBusca || "sem busca" : null };
  }
  throw ultimoErro;
}
