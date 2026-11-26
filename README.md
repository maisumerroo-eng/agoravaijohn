# Copiloto IA (GTA VI) — agoravaijohn

**No ar (Cloudflare Workers, grátis):** https://agoravaijohn.maisumerroo.workers.dev
Deploy: `npm run deploy` (gera `static-files.js` com a pasta `public/` e publica com o wrangler).
Chave do Gemini: em Cloudflare → Workers → agoravaijohn → Settings → Variables and Secrets → Secret `geminina`
(ou cole em ⚙ no app).

Celular apontado pra TV → o "Parça" lê a tela, solta dicas e curiosidades e conversa por voz
("parça, …"). Banco com 170+ itens do GTA VI (regiões, história, glitches, cheats, segredos) e busca na internet.

## IA (escolhe sozinho, nesta ordem)
1. **Gemini grátis (sem cartão)**: chave do Google AI Studio (aistudio.google.com/apikey).
   Coloque em ⚙ no app *ou* na Vercel como env `GEMINI_API_KEY`. Usa o modelo Flash-Lite mais novo
   (o mais rápido e com mais cota grátis, ~15/min e ~500/dia), com pensamento baixo pra ser rápido (env `GEMINI_PENSAMENTO` muda).
2. Chave própria da Anthropic (sk-ant-…) em ⚙ ou env `ANTHROPIC_API_KEY` → Claude Haiku 5.5.
3. Vercel AI Gateway (crédito grátis da Vercel; exige cartão cadastrado na Vercel) → Claude Haiku 5.5.

## Voz
- Voz de IA quase humana (Gemini TTS, mesma chave), frase por frase, com o áudio da próxima já sendo
  preparado. Se faltar cota, cai pra melhor voz do celular (Google pt-BR). Vozes em ⚙ + botão "Testar voz".

## Busca na internet
- Google Search (se a chave tiver cota) → senão busca grátis via Bing (o Gemini chama quando precisa).

## Velocidade
- Conversa em streaming: começa a falar na 1ª frase.
- Respostas curtas, voz 1,25x (ajustável em ⚙), imagem reduzida.

## Rodar local
```
npm install
GEMINI_API_KEY=... npm run dev   # http://localhost:3000
```
