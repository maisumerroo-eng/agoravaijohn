// Gemini (Google AI Studio) via REST — plano grátis sem cartão. Usa os modelos Flash-Lite (mais rápidos
// e com mais cota grátis). A chave vem da env GEMINI_API_KEY ou do header x-gemini-key (configurações do app).
const BASE = process.env.GEMINI_BASE || "https://generativelanguage.googleapis.com/v1beta";
const PREFERIDOS = [/^gemini-3\.\d+-flash-lite$/, /^gemini-2\.5-flash-lite$/, /^gemini-[\d.]+-flash-lite/, /^gemini-[\d.]+-flash$/];

// Aceita GEMINI_API_KEY ou qualquer variável com "gemini"/"gemenina"/etc. no nome cujo valor pareça chave do Google.
const chaveEnv = () =>
  process.env.GEMINI_API_KEY ||
  Object.entries(process.env).find(([k, v]) => /gem[ei]n/i.test(k) && /^AIza[\w-]{20,}$/.test(String(v).trim()))?.[1]?.trim() ||
  null;
export const chaveGemini = (req) => String(req.headers["x-gemini-key"] || "").trim() || chaveEnv();

let modeloCache = null;
async function escolherModelo(chave) {
  if (process.env.GEMINI_MODELO) return process.env.GEMINI_MODELO;
  if (modeloCache && Date.now() - modeloCache.em < 6 * 3600e3) return modeloCache.nome;
  const r = await fetch(`${BASE}/models?pageSize=200`, { headers: { "x-goog-api-key": chave } });
  if (!r.ok) throw await erroGemini(r);
  const { models = [] } = await r.json();
  const nomes = models
    .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
    .map((m) => m.name.replace(/^models\//, ""))
    .filter((n) => !/preview|exp|tts|image|live|audio|embedding/i.test(n));
  for (const re of PREFERIDOS) {
    const achados = nomes.filter((n) => re.test(n)).sort().reverse(); // versão mais nova primeiro
    if (achados.length) { modeloCache = { nome: achados[0], em: Date.now() }; return achados[0]; }
  }
  throw Object.assign(new Error("Nenhum modelo Gemini Flash disponível pra essa chave."), { status: 404 });
}

async function erroGemini(r) {
  let msg = "";
  try { msg = (await r.json())?.error?.message || ""; } catch {}
  return Object.assign(new Error(msg || `Gemini ${r.status}`), { status: r.status, gemini: true });
}

export function respostaErroGemini(e, res) {
  const msg = String(e.message || "").slice(0, 200);
  if (e.status === 429) return res.status(429).json({ erro: "Limite grátis do Google atingido (por minuto ou do dia). Espera um pouco ou aumenta o intervalo." });
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

// Chamada única (com retry sem thinkingConfig/busca se o modelo não aceitar).
export async function gerarGemini({ chave, system, historico = [], partes, schema, busca = false, maxTokens = 800, aoTexto }) {
  const modelo = await escolherModelo(chave);
  const contents = [
    ...historico.map((h) => ({ role: h.role === "assistant" ? "model" : "user", parts: [{ text: h.content }] })),
    { role: "user", parts: partes.map((p) => (p.imagem ? imagemParte(p.imagem) : { text: p.texto })) },
  ];
  const montar = (opc) => ({
    systemInstruction: { parts: [{ text: system }] },
    contents,
    generationConfig: {
      maxOutputTokens: maxTokens,
      temperature: 0.7,
      ...(opc.pensar ? { thinkingConfig: pensar(modelo) } : {}),
      ...(schema ? { responseMimeType: "application/json", responseSchema: paraSchemaGemini(schema) } : {}),
    },
    ...(opc.busca ? { tools: [{ google_search: {} }] } : {}),
  });

  const tentativas = [{ pensar: true, busca }, { pensar: false, busca }, ...(busca ? [{ pensar: false, busca: false }] : [])];
  let ultimoErro;
  for (const opc of tentativas) {
    const stream = !!aoTexto;
    const url = `${BASE}/models/${modelo}:${stream ? "streamGenerateContent?alt=sse" : "generateContent"}`;
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": chave },
      body: JSON.stringify(montar(opc)),
    });
    if (!r.ok) {
      ultimoErro = await erroGemini(r);
      if (r.status === 400 && !/api key/i.test(ultimoErro.message)) continue; // parâmetro não suportado: tenta mais simples
      throw ultimoErro;
    }
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
    if (stream) {
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
    return { texto: texto.trim(), fontes, pesquisou, modelo };
  }
  throw ultimoErro;
}
