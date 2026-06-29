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
(`~/Desktop/cye-demo`). El plan de arquitectura actual vive en [`PLAN_BBDD.md`](PLAN_BBDD.md).

---

## Stack

Electron 39 · React 19 · Vite 7 (electron-vite) · TypeScript 5.9 · better-sqlite3 ·
Gemini Flash / MiniMax (clasificación IA, fallback) ·
exceljs / docxtemplater (entregables) · unpdf / mammoth (ingesta).

## Arquitectura

Proceso **main** (Node) ↔ **preload** (puente IPC tipado) ↔ **renderer** (React). El renderer
nunca toca Node/DB directamente: todo pasa por `window.api` (definido en `src/preload/api.ts`).

El núcleo de generación de planes usa un **motor determinista** sobre una **base de datos curada**
(branch `Cye_BBDD`): el LLM solo extrae estructura del documento; todos los números (frecuencias,
lotes, precios) los calcula el motor a partir de reglas versionadas en JSON.

```
src/
├── main/                       # Proceso principal (Node)
│   ├── index.ts                # Arranque: .env, DB, IPC, ventana
│   ├── env.ts                  # Carga .env (GEMINI_API_KEY / MINIMAX_API_KEY) dev/empaquetado
│   ├── paths.ts                # Rutas de recursos (dev vs empaquetado)
│   ├── ipc.ts                  # Handlers IPC (único punto de entrada al backend)
│   ├── db/                     # SQLite (better-sqlite3) + migraciones por user_version
│   ├── services/
│   │   ├── pipeline.ts         # Orquesta ingesta y entregables
│   │   └── bbddPlan.ts         # Servicio: doc → extractor → motor BBDD → PlanLine[]
│   └── pipeline/               # Núcleo puro, testeable con tsx (sin Electron)
│       ├── extractor.ts        # PDF/DOCX/XLSX/TXT → texto
│       ├── classifier.ts       # Texto → materiales + datos de obra (LLM)
│       ├── ensayos.ts          # Motor de cálculo: densidad in situ, placa de carga
│       ├── informes.ts         # Generación Word/Excel de informes de ensayo
│       ├── llm/                # Proveedor LLM enchufable (Gemini → MiniMax fallback)
│       ├── formatter/          # Entregables del plan: Excel (exceljs) + Word (docxtemplater)
│       ├── kb/                 # Motor BBDD curada (núcleo)
│       │   ├── kb.ts           # Carga la KB en memoria + matchTest() + effectivePrice()
│       │   ├── engine.ts       # generatePlan(): SectionInput[] → PlanLine[] (determinista)
│       │   ├── kbExtractor.ts  # Documento → LLM → SectionInput[] (solo estructura)
│       │   ├── normative.ts    # Reglas normativas PG-3 (frecuencias por artículo)
│       │   └── types.ts        # Contratos TS: SectionInput, PlanLine, Provenance, KbTest…
│       └── harness/kb/         # Scripts de construcción y evaluación de la KB
│           ├── importAlagal.ts # Importa catálogo ALAGAL → alagal_catalog.json
│           ├── importCye.ts    # Importa 8 presupuestos CYE → reglas + precios + aliases
│           ├── buildKb.ts      # Construye kb.sqlite desde fuentes JSON
│           ├── evalAll.ts      # Eval end-to-end: Totalizados → extractor → motor vs CYE real
│           └── compareCategories.ts  # Eval categórico: App vs CYE por categoría y ensayo
├── preload/                    # api.ts (contrato window.api) + index.d.ts
└── renderer/src/               # UI React
    ├── App.tsx                 # Shell + navegación por estado
    ├── pages/                  # Dashboard · Proyectos · NuevaObra · Detalle
    │                           # Ensayos · Presupuestos · BbddPresupuesto
    ├── components/             # Sidebar · PlanTable (+ EditablePlanTable) · Icon
    └── lib/                    # api · tipos de dominio · formato · ensayoCalc

resources/
├── knowledge/
│   ├── test_rules.json         # Reglas de categoría → ensayos (legacy, para clasificador LLM)
│   └── curated/                # Fuentes versionadas de la KB curada (diff en git)
│       ├── alagal_catalog.json # 749 ensayos importados de ALAGAL
│       ├── cye_prices.json     # Precios históricos de presupuestos reales CYE
│       ├── frequency_rules.json# 119 reglas de frecuencia (categoría × ensayo × freqKind)
│       ├── aliases.json        # 316 aliases: descripción libre → testId canónico
│       ├── eval_projects.json  # 8 proyectos de referencia CYE (ground truth para eval)
│       └── kb.sqlite           # BBDD derivada (rebuildeable con kb:build)
└── templates/                  # plan_plantilla.docx · plantillas Word/Excel de informes
```

## Pipeline (documento → plan valorado)

```
Documento ─► extractor ─► classifier (Gemini→MiniMax) ─► motor BBDD ─► formatter
PDF/DOCX/XLSX  texto        SectionInput[]                PlanLine[]    Excel/Word
                             (solo estructura)             (determinista)
```

**Principio rector:** el LLM nunca produce un número que vaya al presupuesto. Produce
*estructura* (categoría, material, tramo, cantidad, unidad). Los números salen siempre
de la BBDD curada y de aritmética determinista.

**Motor BBDD — cadena de precios:**
- Prioridad 1: **tarifa_cye** — precios del histórico real de CYE por ensayo.
- Prioridad 2: **pricebook** — correcciones manuales del laboratorio.
- Prioridad 3: **catálogo ALAGAL** — 749 ensayos con precio de tarifa.
- Cada línea lleva su **provenance** completa (regla, frecuencia, fuente de precio, confianza),
  visible en la UI y exportada en Excel.

**KB curada — fuentes versionadas en git:**
- `frequency_rules.json` — reglas de frecuencia por categoría×ensayo (119 reglas, deduplicadas).
- `aliases.json` — 316 aliases que mapean descripciones libres al testId canónico.
- `alagal_catalog.json` — catálogo ALAGAL (749 ensayos, 17 secciones).
- `eval_projects.json` — 8 proyectos reales CYE usados como ground truth para evaluación.

## Modelo de datos (SQLite, migraciones por `user_version`)

| Tabla | Contenido |
|---|---|
| `obras` | Proyecto (obra, cliente, ref_lab, fecha, responsable, totales, status, iva_rate) |
| `plan_rows` | Filas del plan (FK→obras CASCADE), con provenance y flags needsReview |
| `ensayos` | Informes de campo (tipo, estado, veredicto, datos JSON, n_expediente) |
| `muestras` | Cadena de custodia de muestras, enlazada a ensayos y obras |

Migraciones acumulativas: v1 schema base → … → v6 muestras.

## Puesta en marcha

```bash
npm install        # instala deps y recompila módulos nativos para Electron
npm run dev        # arranca la app en desarrollo
```

### API keys (necesarias para la ingesta con IA)

Crea un `.env` en la raíz a partir de [`.env.example`](.env.example):

```
GEMINI_API_KEY=tu_clave      # clasificador principal
MINIMAX_API_KEY=tu_clave     # fallback automático
```

El resto de la app (proyectos, ensayos, descargas, motor BBDD) funciona sin claves; solo la
clasificación del documento de entrada las requiere.

## Scripts útiles

| Script | Qué hace |
|---|---|
| `npm run dev` | App en desarrollo (HMR) |
| `npm run build` | Typecheck + bundle de producción |
| `npm run build:mac` / `build:win` | Empaqueta `.dmg` / `.exe` (electron-builder) |
| `npm run lint` / `format` | ESLint / Prettier |
| `npm run kb:import-alagal` | Importa catálogo ALAGAL → `alagal_catalog.json` |
| `npm run kb:import-cye` | Importa presupuestos CYE → reglas + precios + aliases |
| `npm run kb:build` | Reconstruye `kb.sqlite` desde fuentes JSON |
| `npm run kb:plan` | Genera un plan de ejemplo con el motor BBDD |
| `npm run kb:extract` | End-to-end: documento → extractor → motor |
| `npm run kb:eval-all` | Eval completo (Totalizados LLM → motor vs total CYE) |
| `npm run template:build` | Regenera la plantilla Word base |

## Evaluación y calidad

El harness `compareCategories.ts` compara la salida del motor (por categoría) con los 8 proyectos
de referencia CYE. Métricas actuales (branch `Cye_BBDD`):

- HORMIGON: de 17 tests a 7 tras eliminar solados/bordillos/proyectado
- MEZCLA_BITUMINOSA: 11/13 coincidencias en E5 (partiendo de 5)
- ACERO: coincidencia exacta en E6 (6/6)
- MARCAS_VIALES: 8/11 en E6; 6/7 en E8

Los tests ⛔ (CYE propone, App no genera) y ➕ (App genera, CYE no propone) restantes se deben
principalmente a diferencias de clasificación en proyectos específicos o a la categoría SERVICIO,
que es inherentemente project-specific.

## Plantilla Word

El Word se genera rellenando `resources/templates/plan_plantilla.docx` con `docxtemplater`.
**Es editable en Word** (logos, estilos, portada) sin tocar código, mientras se conserven los
marcadores (`{obra}`, `{#rows}…{/rows}`, `{total_con_iva}`, etc.).

## Empaquetado y distribución

`npm run build:mac` produce un `.dmg` (en `dist/`). Para distribución profesional pendiente:
firma + notarización Apple (Developer ID), build de Windows vía CI, y opcionalmente universal/arm64.
