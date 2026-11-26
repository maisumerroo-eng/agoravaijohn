// Gera static-files.js com o conteúdo de public/ embutido (pro Cloudflare Worker servir sem "assets").
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json" };
const arquivos = {};
for (const nome of readdirSync("public")) {
  const ext = nome.slice(nome.lastIndexOf("."));
  arquivos["/" + nome] = { tipo: TIPOS[ext] || "application/octet-stream", corpo: readFileSync("public/" + nome, "utf8") };
}
arquivos["/"] = arquivos["/index.html"];
writeFileSync("static-files.js", "// GERADO por gerar-static.mjs — não editar.\nexport default " + JSON.stringify(arquivos) + ";\n");
console.log("static-files.js:", Object.keys(arquivos).join(" "));
