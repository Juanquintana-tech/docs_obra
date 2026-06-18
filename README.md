# CYE — Control y Estudios (Electron)

Aplicación de escritorio para laboratorios de control de calidad de obra civil (acreditados ENAC).
A partir de la **memoria, presupuesto o mediciones** de un proyecto (PDF, Word o Excel), genera
automáticamente el **plan de control de calidad valorado** según normativa española (UNE / PG-3),
lo valora con tarifas reales de laboratorio (catálogo ALAGAL + histórico propio) y produce los
entregables en Excel y Word. Incluye gestión de proyectos e **informes de ensayo de campo**
(densidad in situ ASTM D-6938, placa de carga NLT-357) con cálculo automático y veredicto.

> **Diferenciador:** ningún LIMS/CMT del mercado (Spectra QEST, MetaField, eFieldData…) genera el
> plan valorado desde el documento del proyecto con IA — todos asumen el plan ya hecho. CYE entra
> antes en la cadena.

Reescritura en **Electron + React + TypeScript** de la versión original en Streamlit/Python
(`~/Desktop/cye-demo`). El plan de migración y el roadmap viven en [`PLAN.md`](PLAN.md).

---

## Stack

Electron 39 · React 19 · Vite 7 (electron-vite) · TypeScript 5.9 · better-sqlite3 ·
MiniMax (clasificación IA) · transformers.js (embeddings locales, multilingual-e5-small) ·
exceljs / docxtemplater (entregables) · unpdf / mammoth (ingesta).

## Arquitectura

Proceso **main** (Node) ↔ **preload** (puente IPC tipado) ↔ **renderer** (React). El renderer
nunca toca Node/DB directamente: todo pasa por `window.api` (definido en `src/preload/api.ts`).

```
src/
├── main/                       # Proceso principal (Node)
│   ├── index.ts                # Arranque: .env, DB, IPC, ventana
│   ├── env.ts                  # Carga .env (MINIMAX_API_KEY) dev/empaquetado
│   ├── paths.ts                # Rutas de recursos (dev vs empaquetado)
│   ├── ipc.ts                  # Handlers IPC (único punto de entrada al backend)
│   ├── db/                     # SQLite (better-sqlite3) + migraciones por user_version
│   ├── services/
│   │   ├── pipeline.ts         # Orquesta ingesta, entregables y consultas RAG (cachea RAG/reglas)
│   │   ├── labPricer.ts        # Motor de precios: price_book.json + ALAGAL en cascada
│   │   └── embeddingsProcess.ts # UtilityProcess para embeddings locales (transformers.js)
│   └── pipeline/               # Núcleo puro, testeable con tsx (sin Electron)
│       ├── extractor.ts        # PDF/DOCX/XLSX/TXT → texto
│       ├── classifier.ts       # Texto → materiales + datos de obra (LLM)
│       ├── planner.ts          # Materiales + test_rules.json → plan de ensayos
│       ├── ensayos.ts          # Motor de cálculo: densidad in situ, placa de carga
│       ├── informes.ts         # Generación Word/Excel de informes de ensayo
│       ├── llm/                # Proveedor LLM enchufable (MiniMax + FallbackProvider)
│       ├── rag/                # Valoración de precios: TF-IDF char n-gram + embeddings híbrido
│       ├── formatter/          # Entregables del plan: Excel (exceljs) + Word (docxtemplater)
│       └── harness/            # Scripts de demo/evaluación (rag:eval, plan:demo, deliver:demo…)
├── preload/                    # api.ts (contrato window.api) + index.d.ts
└── renderer/src/               # UI React
    ├── App.tsx                 # Shell + navegación por estado
    ├── pages/                  # Dashboard · Proyectos · NuevaObra · Detalle
    │                           # Ensayos · Presupuestos · ValidacionRag
    ├── components/             # Sidebar · PlanTable (+ EditablePlanTable) · Icon
    └── lib/                    # api · tipos de dominio · formato · ensayoCalc

resources/
├── knowledge/                  # test_rules.json · tarifas_alagal.xlsx · price_book.json
└── templates/                  # plan_plantilla.docx · plantillas de informes Word/Excel
```

## Pipeline (documento → plan valorado)

```
Documento ─► extractor ─► classifier (MiniMax) ─► planner (reglas) ─► RAG pricer ─► formatter
PDF/DOCX/XLSX  texto        materiales + obra       plan de ensayos     precios      Excel/Word
```

**RAG de precios — híbrido TF-IDF + embeddings:**
- Prioridad 1: **price_book.json** — histórico de precios reales del laboratorio, con estadísticas
  por descripción (reciente / mediana / máximo). Umbral de acierto: 0.55.
- Prioridad 2: **catálogo ALAGAL** — búsqueda híbrida TF-IDF char n-gram (3-5) + embeddings locales
  (`multilingual-e5-small` vía transformers.js, UtilityProcess). Umbral: 0.45. Peso híbrido: 0.3.
- Cada fila del plan lleva su **nivel de confianza** (`price_source` + `rag_score`), visible en la UI.
- La pantalla **Validación RAG** permite buscar ensayos y ver los matches con puntuación en tiempo real.

## Modelo de datos (SQLite, migraciones por `user_version`)

| Tabla | Contenido |
|---|---|
| `obras` | Proyecto (obra, cliente, ref_lab, fecha, responsable, totales, status, price_strategy, iva_rate) |
| `plan_rows` | Filas del plan (FK→obras CASCADE), con price_source / rag_score / rag_desc / price_min / price_max |
| `ensayos` | Informes de campo (tipo, estado, veredicto, datos JSON) |
| `price_corrections` | Correcciones de precio del usuario (auditoría + futuro aprendizaje RAG) |

Migraciones acumulativas: v1 schema base → v2 price_min/max → v3 iva_rate → v4 unit_price_base/discount_pct.

## Puesta en marcha

```bash
npm install        # instala deps y recompila módulos nativos para Electron
npm run dev        # arranca la app en desarrollo
```

### API key de MiniMax (necesaria para la ingesta con IA)

Crea un `.env` en la raíz a partir de [`.env.example`](.env.example):

```
MINIMAX_API_KEY=tu_clave
```

El resto de la app (proyectos, ensayos, descargas, RAG) funciona sin clave; solo la clasificación
del documento la requiere.

## Scripts útiles

| Script | Qué hace |
|---|---|
| `npm run dev` | App en desarrollo (HMR) |
| `npm run build` | Typecheck + bundle de producción |
| `npm run build:mac` / `build:win` | Empaqueta `.dmg` / `.exe` (electron-builder) |
| `npm run lint` / `format` | ESLint / Prettier |
| `npm run rag:demo` | Mapea cada ensayo de las reglas al catálogo (ojear calidad del RAG) |
| `npm run rag:eval` | Métricas del RAG (precisión@1, acierto de precio) sobre casos etiquetados |
| `npm run rag:thresholds` | Ajusta umbrales PB/ALAGAL con el set de evaluación |
| `npm run plan:demo` | Genera un plan de ejemplo y lo valora |
| `npm run deliver:demo` | Genera Excel + Word de un plan de ejemplo |
| `npm run template:build` | Regenera la plantilla Word base |

## Plantilla Word

El Word se genera rellenando `resources/templates/plan_plantilla.docx` con `docxtemplater`.
**Es editable en Word** (logos, estilos, portada) sin tocar código, mientras se conserven los
marcadores (`{obra}`, `{#rows}…{/rows}`, `{total_con_iva}`, etc.).

## Empaquetado y distribución

`npm run build:mac` produce un `.dmg` (en `dist/`). Para distribución profesional pendiente:
firma + notarización Apple (Developer ID), build de Windows vía CI, y opcionalmente universal/arm64.
Ver [`PLAN.md`](PLAN.md).
# docs_obra
