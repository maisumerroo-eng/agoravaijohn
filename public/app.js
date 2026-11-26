// Copiloto IA — câmera do celular -> frame -> /api/analisar -> dicas na tela + voz.
const $ = (id) => document.getElementById(id);
const video = $("video"), canvas = $("canvas"), ctx = canvas.getContext("2d");

const LS = {
  get(k, d) { try { const v = localStorage.getItem("cop:" + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("cop:" + k, JSON.stringify(v)); } catch {} },
};

const cfg = {
  intervalo: LS.get("intervalo", 30),
  foco: LS.get("foco", "tudo"),
  spoilers: LS.get("spoilers", false),
  pular: LS.get("pular", true),
  chave: LS.get("chave", ""),
  voz: LS.get("voz", true),
  ouvir: LS.get("ouvir", true),
  ativacao: LS.get("ativacao", true),
  nome: LS.get("nome", "John"),
  gemini: LS.get("gemini", ""),
  velocidade: LS.get("velocidade", 1),
  vozIA: LS.get("vozIA", true),
  vozNome: LS.get("vozNome", "Puck"),
};

let historico = [];
let ultimaMiniatura = null;
let ocupado = false;
let pausado = false;
let timer = null;
let wakeLock = null;
let conversa = [];          // [{role, content}] do papo com o Parça
let ultimoLocal = "";
let janelaAte = 0;          // até quando ele ouve sem precisar da palavra de ativação
let ultimaConversa = 0;

function status(txt, tipo = "") {
  const el = $("status");
  el.className = "status " + tipo;
  el.querySelector("span").textContent = txt;
}

// ---------- Câmera ----------
async function ligarCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
    video.srcObject = stream;
    // foco contínuo e exposição automática ajudam a ler a TV
    stream.getVideoTracks()[0]?.applyConstraints({ advanced: [{ focusMode: "continuous" }, { exposureMode: "continuous" }] }).catch(() => {});
    await video.play();
    $("inicio").hidden = true;
    $("app").hidden = false;
    pedirWakeLock();
    agendar(1500);
    if (cfg.ouvir) ouvir();
    setTimeout(() => falarConversa(`E aí, ${cfg.nome}! Tô vendo a tela. É só chamar "parça" e falar comigo.`), 800);
  } catch (e) {
    alert("Não deu pra abrir a câmera. Libera a permissão e abre o site em HTTPS.\n\n" + e.message);
  }
}

async function pedirWakeLock() {
  try { wakeLock = await navigator.wakeLock?.request("screen"); } catch {}
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && !$("app").hidden) pedirWakeLock();
});

// ---------- Frame ----------
function capturar(max = 1024, qualidade = 0.65) {
  const w = video.videoWidth, h = video.videoHeight;
  if (!w || !h) return null;
  const escala = Math.min(1, max / Math.max(w, h));
  canvas.width = Math.round(w * escala);
  canvas.height = Math.round(h * escala);
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", qualidade);
}

// Miniatura 32x18 em cinza pra saber se a tela mudou.
const mini = document.createElement("canvas");
mini.width = 32; mini.height = 18;
const mctx = mini.getContext("2d", { willReadFrequently: true });
function mudouBastante() {
  mctx.drawImage(video, 0, 0, 32, 18);
  const px = mctx.getImageData(0, 0, 32, 18).data;
  const cinza = new Uint8Array(32 * 18);
  for (let i = 0; i < cinza.length; i++) cinza[i] = (px[i * 4] + px[i * 4 + 1] + px[i * 4 + 2]) / 3;
  if (!ultimaMiniatura) { ultimaMiniatura = cinza; return true; }
  let soma = 0;
  for (let i = 0; i < cinza.length; i++) soma += Math.abs(cinza[i] - ultimaMiniatura[i]);
  const diff = soma / cinza.length;
  if (diff > 10) { ultimaMiniatura = cinza; return true; }
  return false;
}

// ---------- Ciclo (leitura automática da tela) ----------
function agendar(ms) {
  clearTimeout(timer);
  if (pausado || cfg.intervalo === 0) return;
  timer = setTimeout(() => analisar(false), ms ?? cfg.intervalo * 1000);
}

const headersIA = () => {
  const h = { "Content-Type": "application/json" };
  if (cfg.chave) h["x-user-key"] = cfg.chave;
  if (cfg.gemini) h["x-gemini-key"] = cfg.gemini;
  return h;
};

async function analisar(forcado) {
  if (ocupado) return agendar();
  if (!forcado && cfg.pular && !mudouBastante()) {
    status(ouvindo ? "Ouvindo… chama \"parça\"" : "Tela parada", "ok");
    return agendar();
  }
  if (forcado) mudouBastante();
  const imagem = capturar(1600, 0.82);
  if (!imagem) return agendar(1000);
  const mini = $("miniatura"); if (mini) { mini.src = imagem; mini.hidden = false; }

  ocupado = true;
  status("Lendo a tela…", "lendo");
  try {
    const r = await fetch("/api/analisar", {
      method: "POST",
      headers: headersIA(),
      body: JSON.stringify({ imagem, historico, spoilers: cfg.spoilers, foco: cfg.foco }),
    });
    const dados = await r.json().catch(() => ({ erro: "Resposta inválida do servidor" }));
    if (!r.ok) throw new Error(dados.erro || "Erro " + r.status);
    mostrar(dados);
    historico.push(dados.dica, dados.curiosidade);
    historico = historico.slice(-12);
    if (dados.tela_de_jogo) ultimoLocal = [dados.local, dados.situacao].filter(Boolean).join(" — ");
    status(ouvindo ? "Ouvindo… chama \"parça\"" : "Atualizado", "ok");
  } catch (e) {
    status("Erro", "erro");
    mostrarErro(e.message);
  } finally {
    ocupado = false;
    agendar();
  }
}

// ---------- Conversa com o Parça (streaming: fala já a 1ª frase) ----------
let pensando = false;
async function conversar(texto, { audio = null, alternativas = [] } = {}) {
  texto = String(texto || "").trim();
  if ((!texto && !audio) || pensando) return;
  pensando = true;
  ultimaConversa = Date.now();
  pararFala();
  const rotulo = texto || "🎤 (sua voz)";
  mostrarConversa(rotulo, "…", []);
  status("Parça pensando…", "lendo");
  const imagem = capturar(1024, 0.72);
  let resposta = "", pendente = "", fontes = [], pesquisou = false, semBusca = "";
  const soltarFrases = (final) => {
    // fala cada frase assim que ela fecha (. ! ?) — não espera a resposta inteira
    const re = /[^.!?…]+[.!?…]+["')\]]*\s+/g;
    let m, corte = 0;
    while ((m = re.exec(pendente))) { falarFila(m[0]); corte = re.lastIndex; }
    pendente = pendente.slice(corte);
    if (final && pendente.trim()) { falarFila(pendente); pendente = ""; }
  };
  try {
    const r = await fetch("/api/conversar", {
      method: "POST",
      headers: headersIA(),
      body: JSON.stringify({ mensagem: texto, audio, alternativas, historico: conversa, imagem, nome: cfg.nome, spoilers: cfg.spoilers, local: ultimoLocal }),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      throw new Error(d.erro || "Erro " + r.status);
    }
    const leitor = r.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await leitor.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const linha = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!linha.trim()) continue;
        const d = JSON.parse(linha);
        if (d.t) { resposta += d.t; pendente += d.t; soltarFrases(false); mostrarConversa(rotulo, resposta, []); }
        if (d.erro) throw new Error(d.erro);
        if (d.fim) { fontes = d.fontes || []; pesquisou = !!d.pesquisou; semBusca = d.buscaIndisponivel || ""; }
      }
    }
    soltarFrases(true);
    resposta = resposta.trim() || "Não consegui pensar em nada, repete aí?";
    conversa.push({ role: "user", content: texto || "(falou por áudio)" }, { role: "assistant", content: resposta });
    conversa = conversa.slice(-16);
    mostrarConversa(rotulo, resposta, fontes, pesquisou);
    if (!cfg.voz) janelaAte = Date.now() + 12000;
    status(pesquisou ? "Pesquisou na internet" : semBusca ? "Sem busca na internet agora" : "Respondido", semBusca ? "pausado" : "ok");
    if (semBusca) console.warn("Busca indisponível:", semBusca);
  } catch (e) {
    mostrarConversa(rotulo, "Deu ruim: " + e.message, []);
    status("Erro", "erro");
  } finally {
    pensando = false;
    ultimaConversa = Date.now();
    if (!falando()) { janelaAte = Date.now() + 12000; if (cfg.ouvir) setTimeout(ouvir, 200); }
  }
}

function mostrarConversa(pergunta, resposta, fontes, pesquisou) {
  const box = $("conversa");
  box.hidden = false;
  const eu = card("voce", cfg.nome, pergunta);
  const ele = card("parca", pesquisou ? "Parça · pesquisou" : "Parça", resposta);
  if (fontes.length) {
    const small = document.createElement("small");
    small.className = "fontes";
    fontes.forEach((f, i) => {
      const a = document.createElement("a");
      a.href = f.url; a.target = "_blank"; a.rel = "noopener";
      a.textContent = f.titulo || new URL(f.url).hostname;
      small.append(i ? " · " : "Fontes: ", a);
    });
    ele.append(small);
  }
  box.replaceChildren(eu, ele);
  $("painel").scrollTop = 0;
}

// ---------- UI ----------
function card(tipo, titulo, conteudo) {
  const el = document.createElement("article");
  el.className = "card " + tipo;
  const b = document.createElement("b");
  b.textContent = titulo;
  el.append(b);
  if (Array.isArray(conteudo)) {
    const ul = document.createElement("ul");
    for (const item of conteudo) {
      const li = document.createElement("li");
      const strong = document.createElement("strong");
      strong.textContent = item.titulo;
      li.append(strong, " — " + item.detalhe);
      ul.append(li);
    }
    el.append(ul);
  } else {
    const p = document.createElement("p");
    p.textContent = conteudo;
    el.append(p);
  }
  return el;
}

function mostrar(d) {
  $("local").textContent = d.tela_de_jogo ? (d.local || "Local desconhecido") : "Não vi o jogo na tela";
  const cards = $("cards");
  cards.replaceChildren();
  if (d.situacao) cards.append(card("situacao", "Agora", d.situacao));
  if (d.dica) cards.append(card("dica", "Dica", d.dica));
  if (d.perto?.length) cards.append(card("perto", "Por perto", d.perto.slice(0, 3)));
  if (d.curiosidade) cards.append(card("curiosidade", "Curiosidade", d.curiosidade));
  $("painel").scrollTop = 0;
  falar(d.fala);
}

function mostrarErro(msg) {
  $("cards").replaceChildren(card("erro", "Ops", msg));
}

// ---------- Voz (fala) ----------
let vozPt = null;
function escolherVoz() {
  const vozes = speechSynthesis.getVoices().filter((v) => v.lang.replace("_", "-").startsWith("pt"));
  // Melhor voz do celular: Google/neural/online pt-BR (bem melhor que as vozes "offline" robóticas).
  vozPt = vozes.find((v) => /pt-BR/.test(v.lang) && /google/i.test(v.name))
    || vozes.find((v) => /pt-BR/.test(v.lang) && /natural|online|neural|enhanced|premium/i.test(v.name))
    || vozes.find((v) => /pt-BR/.test(v.lang)) || vozes[0] || null;
}
if ("speechSynthesis" in window) {
  escolherVoz();
  speechSynthesis.onvoiceschanged = escolherVoz;
}

// ---------- Motor de fala: voz de IA (Gemini) com reserva na voz do celular ----------
// Fila de frases; o áudio da próxima é buscado enquanto a atual toca.
const fila = [];               // [{texto, audio: Promise<Blob|null>}]
let tocando = null;            // item atual
let player = new Audio();
let vozIAPausadaAte = 0;       // se a voz de IA falhar (ex.: cota), usa a do celular por 5 min
let aoAcabarFila = null;

const usarVozIA = () => cfg.vozIA && Date.now() > vozIAPausadaAte;
const falando = () => !!tocando || fila.length > 0 || !!speechSynthesis?.speaking;

function buscarAudio(texto) {
  if (!usarVozIA()) return Promise.resolve(null);
  return fetch("/api/voz", { method: "POST", headers: headersIA(), body: JSON.stringify({ texto, voz: cfg.vozNome }) })
    .then(async (r) => {
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        vozIAPausadaAte = Date.now() + 5 * 60e3;
        console.warn("Voz de IA indisponível, usando a do celular:", e.erro || r.status);
        return null;
      }
      return r.blob();
    })
    .catch(() => null);
}

function falarNoCelular(texto) {
  return new Promise((ok) => {
    if (!("speechSynthesis" in window)) return ok();
    const u = new SpeechSynthesisUtterance(texto);
    u.lang = "pt-BR";
    if (vozPt) u.voice = vozPt;
    u.rate = Number(cfg.velocidade) || 1;
    u.onend = u.onerror = () => ok();
    speechSynthesis.speak(u);
  });
}

function tocarBlob(blob) {
  return new Promise((ok) => {
    const url = URL.createObjectURL(blob);
    player.src = url;
    player.playbackRate = Math.min(1.25, Math.max(0.9, Number(cfg.velocidade) || 1));
    player.onended = player.onerror = () => { URL.revokeObjectURL(url); ok(); };
    player.play().catch(() => { URL.revokeObjectURL(url); ok("falhou"); });
  });
}

let rodando = false, geracao = 0;
async function rodarFila() {
  if (rodando) return;
  rodando = true;
  const g = geracao;
  while (fila.length && g === geracao) {
    const item = fila.shift();
    tocando = item;
    pararOuvir(true);                          // não ouvir a própria voz
    const blob = await item.audio;
    if (g !== geracao) return;                 // interrompido: outro tocador assume
    const r = blob ? await tocarBlob(blob) : "sem-ia";
    if (g !== geracao) return;
    if (r) await falarNoCelular(item.texto);   // reserva: voz do celular
    if (g !== geracao) return;
  }
  tocando = null;
  rodando = false;
  const fim = aoAcabarFila; aoAcabarFila = null;
  fim?.();
  if (!pensando) {
    janelaAte = Date.now() + 12000;
    if (cfg.ouvir) setTimeout(ouvir, 200);
  }
}

function pararFala() {
  geracao++;
  fila.length = 0;
  tocando = null;
  rodando = false;
  aoAcabarFila = null;
  try { player.pause(); player.onended?.(); } catch {}
  try { speechSynthesis.cancel(); } catch {}
}

// Põe uma frase na fila (usado no streaming da conversa).
function falarFila(txt) {
  txt = String(txt || "").trim();
  if (!cfg.voz || !txt) return;
  fila.push({ texto: txt, audio: buscarAudio(txt) });
  rodarFila();
}
// Fala avulsa (interrompe o que estiver falando).
function falarBase(txt, aoTerminar) {
  if (!cfg.voz || !txt) return aoTerminar?.();
  pararFala();
  falarFila(txt);
  aoAcabarFila = aoTerminar;
}
// Dica automática: não atropela conversa recente.
function falar(txt) {
  if (pensando || falando() || Date.now() - ultimaConversa < 25000) return;
  falarBase(txt);
}
// Fala do Parça fora do streaming (ex.: "Fala, John!"): depois dela, 12 s pra responder sem dizer "parça".
function falarConversa(txt) {
  falarBase(txt, () => { janelaAte = Date.now() + 12000; });
  if (!cfg.voz) janelaAte = Date.now() + 12000;
}

// ---------- Microfone (reconhecimento automático) ----------
const Reconhecedor = window.SpeechRecognition || window.webkitSpeechRecognition;
const ATIVACAO = /\b(parça|parca|parceiro|parsa|passa|par[sç]a|copiloto)\b[,!.]?\s*/i;
let rec = null, ouvindo = false, apertouMic = false;
const btnMic = $("btnMic");
if (!Reconhecedor) btnMic.hidden = true;

function tratarFala(frase, alternativas = []) {
  frase = frase.trim();
  if (frase.length < 2) return;
  const livre = apertouMic || !cfg.ativacao || Date.now() < janelaAte;
  apertouMic = false;
  if (livre) return conversar(frase.replace(ATIVACAO, "") || frase, { alternativas });
  const m = frase.match(ATIVACAO) || alternativas.map((a) => a.match(ATIVACAO)).find(Boolean);
  if (!m) return; // barulho do jogo / conversa de fundo: ignora
  const resto = frase.slice(frase.search(ATIVACAO) >= 0 ? m.index + m[0].length : 0).trim();
  if (resto.length > 2) conversar(resto, { alternativas: alternativas.map((a) => a.replace(ATIVACAO, "")) });
  else falarBase(`Fala, ${cfg.nome}!`, () => gravarPergunta()); // só chamou: grava a pergunta e a IA escuta o áudio
}

function ouvir() {
  if (!Reconhecedor || ouvindo || falando()) return;
  rec = new Reconhecedor();
  rec.lang = "pt-BR";
  rec.interimResults = true;
  rec.continuous = true;
  rec.maxAlternatives = 3;
  rec.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      const t = r[0].transcript;
      // Mostra o que está ouvindo só quando é com ele.
      if (apertouMic || Date.now() < janelaAte || ATIVACAO.test(t) || !cfg.ativacao) $("inputPergunta").value = t;
      if (r.isFinal) {
        $("inputPergunta").value = "";
        const alts = Array.from({ length: r.length }, (_, k) => r[k]?.transcript).slice(1).filter(Boolean);
        tratarFala(t, alts);
      }
    }
  };
  rec.onend = () => {
    ouvindo = false; btnMic.setAttribute("aria-pressed", "false");
    if (cfg.ouvir && !falando()) setTimeout(ouvir, 300);
  };
  rec.onerror = (e) => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") {
      cfg.ouvir = false; LS.set("ouvir", false);
      status("Microfone bloqueado", "erro");
    }
  };
  try { rec.start(); ouvindo = true; btnMic.setAttribute("aria-pressed", "true"); } catch {}
}
function pararOuvir(temporario) {
  if (!temporario) { cfg.ouvir = false; LS.set("ouvir", false); }
  try { rec?.abort(); } catch {}
  ouvindo = false; btnMic.setAttribute("aria-pressed", "false");
}
// Toque no mic: grava sua pergunta e manda o ÁUDIO pra IA (entende bem melhor com o barulho do jogo).
// Tocar de novo enquanto grava = parar e enviar.
btnMic.addEventListener("click", () => {
  if (gravando) return gravando.parar();
  pararFala();
  gravarPergunta();
});

// ---------- Gravação da pergunta (áudio -> IA) ----------
let gravando = null;
function bip(freq = 880, ms = 120) {
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const o = ac.createOscillator(), g = ac.createGain();
    o.frequency.value = freq; g.gain.value = 0.08;
    o.connect(g); g.connect(ac.destination); o.start();
    setTimeout(() => { o.stop(); ac.close(); }, ms);
  } catch {}
}
function wavDe(amostras, taxa) {
  const buf = new ArrayBuffer(44 + amostras.length * 2), v = new DataView(buf);
  const txt = (o, t) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  txt(0, "RIFF"); v.setUint32(4, 36 + amostras.length * 2, true); txt(8, "WAVE"); txt(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, taxa, true);
  v.setUint32(28, taxa * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); txt(36, "data");
  v.setUint32(40, amostras.length * 2, true);
  for (let i = 0; i < amostras.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, amostras[i])) * 0x7fff, true);
  return new Uint8Array(buf);
}
const paraB64 = (bytes) => { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };

async function gravarPergunta() {
  if (gravando || pensando) return;
  pararOuvir(true);
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch {
    status("Microfone bloqueado", "erro");
    return;
  }
  const ac = new (window.AudioContext || window.webkitAudioContext)();
  const fonte = ac.createMediaStreamSource(stream);
  const proc = ac.createScriptProcessor(4096, 1, 1);
  const pedacos = [];
  let falou = false, silencioDesde = 0, ruido = 0.01, inicio = performance.now(), acabou;
  const fim = new Promise((r) => (acabou = r));
  proc.onaudioprocess = (e) => {
    const d = e.inputBuffer.getChannelData(0);
    pedacos.push(new Float32Array(d));
    let soma = 0; for (let i = 0; i < d.length; i++) soma += d[i] * d[i];
    const rms = Math.sqrt(soma / d.length), t = performance.now() - inicio;
    if (t < 300) { ruido = Math.max(ruido, rms); return; }      // mede o barulho do ambiente (TV/jogo)
    if (rms > ruido * 1.8 + 0.01) { falou = true; silencioDesde = 0; }
    else if (falou && !silencioDesde) silencioDesde = performance.now();
    if ((falou && silencioDesde && performance.now() - silencioDesde > 1100) || t > 9000 || (!falou && t > 5000)) acabou();
  };
  fonte.connect(proc); proc.connect(ac.destination);
  gravando = { parar: () => acabou() };
  btnMic.setAttribute("aria-pressed", "true");
  status("Gravando… fala agora", "lendo");
  bip();
  await fim;
  proc.disconnect(); fonte.disconnect(); stream.getTracks().forEach((t) => t.stop());
  const taxaOrig = ac.sampleRate; ac.close();
  gravando = null;
  btnMic.setAttribute("aria-pressed", "false");
  bip(660, 90);
  if (!falou) { status("Não ouvi nada", "pausado"); if (cfg.ouvir) setTimeout(ouvir, 300); return; }
  // junta e reduz pra 16 kHz mono (arquivo pequeno, sobe rápido)
  const total = pedacos.reduce((n, p) => n + p.length, 0), junto = new Float32Array(total);
  let pos = 0; for (const p of pedacos) { junto.set(p, pos); pos += p.length; }
  const passo = taxaOrig / 16000, saida = new Float32Array(Math.floor(total / passo));
  for (let i = 0; i < saida.length; i++) saida[i] = junto[Math.floor(i * passo)];
  conversar("", { audio: paraB64(wavDe(saida, 16000)) });
}

// ---------- Controles ----------
$("btnIniciar").addEventListener("click", () => {
  // Desbloqueia a voz no iOS (precisa de gesto do usuário).
  if ("speechSynthesis" in window) speechSynthesis.speak(new SpeechSynthesisUtterance(""));
  player.src = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=";
  player.play().catch(() => {});
  ligarCamera();
});

$("btnAgora").addEventListener("click", () => analisar(true));

$("formPergunta").addEventListener("submit", (e) => {
  e.preventDefault();
  const q = $("inputPergunta").value.trim();
  if (!q) return;
  $("inputPergunta").value = "";
  $("inputPergunta").blur();
  conversar(q);
});

const btnVoz = $("btnVoz");
function syncVoz() { btnVoz.setAttribute("aria-pressed", String(cfg.voz)); btnVoz.textContent = cfg.voz ? "🔊" : "🔇"; }
btnVoz.addEventListener("click", () => {
  cfg.voz = !cfg.voz; LS.set("voz", cfg.voz); syncVoz();
  if (!cfg.voz) pararFala();
});
syncVoz();

$("btnPausa").addEventListener("click", () => {
  pausado = !pausado;
  $("btnPausa").textContent = pausado ? "▶" : "⏸";
  $("btnPausa").setAttribute("aria-label", pausado ? "Continuar" : "Pausar");
  if (pausado) { clearTimeout(timer); status("Pausado", "pausado"); } else agendar(300);
});

const CAMPOS = { vozIA: "cfgVozIA", vozNome: "cfgVozNome", gemini: "cfgGemini", velocidade: "cfgVelocidade", intervalo: "cfgIntervalo", foco: "cfgFoco", spoilers: "cfgSpoilers", pular: "cfgPular", chave: "cfgChave", ouvir: "cfgOuvir", ativacao: "cfgAtivacao", nome: "cfgNome" };
const dlg = $("config");
$("btnConfig").addEventListener("click", () => {
  for (const [k, id] of Object.entries(CAMPOS)) {
    const el = $(id);
    if (el.type === "checkbox") el.checked = cfg[k]; else el.value = String(cfg[k]);
  }
  dlg.showModal();
});
dlg.addEventListener("close", () => {
  for (const [k, id] of Object.entries(CAMPOS)) {
    const el = $(id);
    cfg[k] = el.type === "checkbox" ? el.checked : k === "intervalo" || k === "velocidade" ? Number(el.value) : el.value.trim();
    LS.set(k, cfg[k]);
  }
  if (!cfg.nome) cfg.nome = "John";
  if (cfg.ouvir) ouvir(); else pararOuvir(false);
  agendar();
});

// ---------- Guia offline ----------
const NOMES_TIPO = { historia: "História", glitch: "Glitches", cheat: "Cheats", regiao: "Regiões", mecanica: "Mecânicas", atividade: "Atividades", personagem: "Personagens", curiosidade: "Curiosidades", dica: "Dicas" };
let banco = null, filtroTipo = "";
async function abrirGuia() {
  if (!banco) {
    try { banco = (await (await fetch("gta6.json")).json()).itens; } catch { banco = []; }
    const f = $("guiaFiltros");
    for (const t of ["", ...new Set(banco.map((i) => i.tipo))]) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = t ? NOMES_TIPO[t] || t : "Tudo";
      b.setAttribute("aria-pressed", String(t === filtroTipo));
      b.onclick = () => { filtroTipo = t; f.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); listarGuia(); };
      f.append(b);
    }
  }
  listarGuia();
  $("guia").showModal();
}
const semAcento = (t) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
function listarGuia() {
  const q = semAcento($("guiaBusca").value.trim());
  const itens = banco.filter((i) => (!filtroTipo || i.tipo === filtroTipo) &&
    (!q || semAcento(i.nome + " " + i.texto + " " + (i.tags || []).join(" ")).includes(q)));
  const lista = $("guiaLista");
  lista.replaceChildren(...itens.map((i) => {
    const c = card(i.tipo === "curiosidade" ? "curiosidade" : i.tipo === "regiao" ? "perto" : "dica", i.nome, i.texto);
    const aviso = [i.confirmado === false && "Não confirmado", i.spoiler && "Spoiler"].filter(Boolean).join(" · ");
    if (aviso) { const s = document.createElement("small"); s.textContent = aviso; c.append(s); }
    if (i.spoiler && !cfg.spoilers) { c.classList.add("borrado"); c.title = "Toque pra revelar"; c.onclick = () => c.classList.remove("borrado"); }
    return c;
  }));
  if (!itens.length) lista.append(card("erro", "Nada", "Nada encontrado."));
}
$("btnGuia").addEventListener("click", abrirGuia);
$("guiaBusca").addEventListener("input", listarGuia);

// Testar a voz nas configurações (usa a escolha atual do formulário, mesmo antes de salvar).
$("btnTestarVoz").addEventListener("click", () => {
  cfg.vozIA = $("cfgVozIA").checked;
  cfg.vozNome = $("cfgVozNome").value;
  cfg.velocidade = Number($("cfgVelocidade").value);
  cfg.gemini = $("cfgGemini").value.trim() || cfg.gemini;
  vozIAPausadaAte = 0;
  falarBase(`Fala, ${cfg.nome || "John"}! Essa é minha voz. Se tiver estrela de procurado, me chama que eu te explico o caminho certinho.`);
});
