# Notas — Exportar CYE a Windows / Linux (memoria para Claude)

Estado: el **código ya es multiplataforma** (path.join, app.getPath, utilityProcess.fork('.js'),
loadFile(join), guardas process.platform). `electron-builder.yml` ya tiene targets win(nsis)/mac(dmg)/linux(AppImage,snap,deb).
El trabajo está en **build + módulos nativos**, no en el código de la app.

## Lo crítico
1. **Compilar en cada SO.** Nativos: `better-sqlite3`, `sharp`, `onnxruntime-node` (vía `@xenova/transformers`).
   No se cross-compilan fiable desde Mac → usar **GitHub Actions matriz** (macos/windows/ubuntu-latest):
   `npm ci` + `npm run build:win|mac|linux` en cada runner. (NO existe `.github/workflows/` aún → crearlo.)
2. **Install limpio por SO.** Binarios opcionales por plataforma (`@rollup/rollup-*`, `esbuild`, `sharp`, `onnxruntime-node`).
   **Nunca copiar node_modules entre SO** (= el error `@rollup/rollup-linux-x64-gnu` que vimos). `node_modules` ya en .gitignore.
3. **Asar unpack de nativos.** Verificar que `better-sqlite3`/`sharp`/`onnxruntime-node` quedan en `app.asar.unpacked`
   (electron-builder suele hacerlo; si falla, añadir a `asarUnpack`). `postinstall: electron-builder install-app-deps` los reconstruye p/Electron.

## Offline / modelo embeddings (ZONA RAG — no tocar sin permiso explícito)
- `localEmbeddings.ts` / `embeddingsWorker.ts`: `pipeline('feature-extraction', MODEL)` sin `env.localModelPath`
  → descarga modelo de HuggingFace en 1er arranque (necesita internet). Para offline idéntico en 3 SO:
  bundlear modelo en resources/ + apuntar `env.localModelPath`. Es config de carga, no de scoring, pero es RAG → pedir permiso.

## Detalles menores (rápidos, no bloquean)
- Fuente: `--font-num` en base.css empieza por 'SF Mono' (solo Mac); cae bien a monospace. Añadir `Consolas` p/Windows.
- `build:mac` se salta typecheck (`electron-vite build && ...`) vs build:win/linux que sí (`npm run build`). Homogeneizar.
- Rutas hardcodeadas `/Users/usuario/...` SOLO en `pipeline/harness/budgetParser.ts` (dev tool, no se empaqueta). Parametrizar si se corre harness en otros SO.
- `snap`/`deb` requieren snapcraft/dpkg en runner Linux; simplificar a solo `AppImage` si se quiere.
- Auto-update apunta a `https://example.com` (placeholder); en Linux solo AppImage soporta auto-update.

## Restricción permanente del usuario
- **NO TOCAR EL RAG** (pipeline/rag/*, services/labPricer.ts, embeddings*, price_book, umbrales, ragCompare lógica).
  El RAG por fin da valores aceptables. Cambios solo fuera de esa zona salvo permiso explícito.

## Verificación recomendada
- `npm run typecheck` (debe quedar limpio). `npm run build` real solo en cada SO (en sandbox Linux falla por rollup nativo Mac).
