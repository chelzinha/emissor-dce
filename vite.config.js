import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
const rootDir=fileURLToPath(new URL(".",import.meta.url));
export default defineConfig({build:{rollupOptions:{input:{dce:resolve(rootDir,"index.html"),eleicoes:resolve(rootDir,"eleicoes.html"),portal:resolve(rootDir,"portal.html")}}},server:{port:5173}});
