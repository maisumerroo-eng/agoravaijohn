# Copiloto IA (GTA VI)

Celular apontado pra TV → a câmera tira um frame a cada X segundos → Claude (visão) lê a tela → mostra e fala:
local, dica do momento, o que fazer por perto, curiosidade. Dá pra fazer pergunta sobre a tela.

## Rodar local
```
npm install
ANTHROPIC_API_KEY=sk-ant-... npm run dev   # http://localhost:3000
```
No celular precisa HTTPS (câmera) → use o deploy da Vercel.

## Deploy (Vercel)
- Novo projeto apontando pra este repo, **Root Directory = `gta-copiloto`**.
- Env var `ANTHROPIC_API_KEY`.
- Sem env var, o app usa a chave colada em ⚙ Configurações (fica só no celular).

## Custo
Cada leitura = 1 imagem ~1280px pro Claude Opus 5.5 (effort low). Frame igual ao anterior é pulado.
Intervalo padrão 15 s; dá pra pôr manual em ⚙.
