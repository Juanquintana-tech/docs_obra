# CYE — Reescritura del núcleo: de RAG a BBDD curada + motor determinista

> **Branch:** `Cye_BBDD` · **Inicio:** 2026-06-26
> **Documento estrella polar.** Se actualiza al cerrar cada etapa (sección "Bitácora").
> Si en algún momento se pierde el contexto, **este archivo es la fuente de verdad** de objetivos,
> arquitectura y estado.

---

## 1. Objetivo

Sustituir por completo el sistema RAG (TF-IDF + embeddings + `plannerLLM` generativo) por una
**base de datos curada** sobre la que se ejecutan **consultas estructuradas deterministas**.

**Resultado buscado:** dado el mismo proyecto de entrada, el mismo presupuesto de salida
(reproducible), con precisión equiparable o superior al presupuesto real de CYE, y con
**trazabilidad total** de cada cifra (qué regla, qué frecuencia, qué precio y de dónde sale).

### Por qué (dolor actual, de `PLAN.md` §104)
- Resultado **no determinista** (el LLM genera el plan libremente sección a sección).
- Desviación **+13,9%** vs presupuesto real CYE (E8 mejoró a −3,9% tras parches, pero frágil).
- **Desajuste de granularidad**: la App agrupa por categoría global; CYE real desglosa por **tramo/sección** (219 líneas reales vs 124 de la App).
- Divergencias de **precio** y de **número de lotes**; matching difuso que prioriza mal.

---

## 2. Decisiones de arquitectura (cerradas 2026-06-26)

| Decisión | Elección | Implicación |
|---|---|---|
| **Rol del LLM** | LLM mapea → **motor determinista** | El LLM solo extrae intención estructurada y ayuda en el chat. Todo cálculo (ensayos, frecuencias, lotes, precios) lo hace un motor de reglas/SQL. Mismo input → mismo output. |
| **Alcance** | **BBDD-first con fallback marcado** | La BBDD curada manda. Lo no cubierto se **marca visiblemente** (nunca se inventa precio en silencio). El RAG antiguo solo se borra tras probar paridad (Etapa 7). |
| **Granularidad** | **Por tramo/sección** (como CYE real) | El modelo de datos y el extractor trabajan a nivel de tramo, no de categoría global. Es la palanca principal para cerrar el gap de precisión. |
| **Proveedor LLM** | **Gemini Flash primario, MiniMax fallback** | Solo capa de extracción/agente. Núcleo de cálculo agnóstico de proveedor. Claves ya en `.env`. |

### Principio rector
> **El LLM nunca produce un número que vaya al presupuesto.** Produce *estructura*
> (categoría, material, tramo, cantidad, unidad, código de norma). Los números (frecuencias,
> lotes, precios, totales) salen siempre de la BBDD y de aritmética determinista.

---

## 3. Arquitectura objetivo

```
Documento de proyecto (PDF/XLSX/DOCX)
        │
        ▼
┌─────────────────────────┐   LLM (Gemini→MiniMax)   solo ESTRUCTURA, validado por schema
│  Extractor de mediciones │ ───────────────────────────────────────────────┐
│  → MedicionEstructurada[]│   {tramo, categoría, material, cantidad, unidad} │
└─────────────────────────┘                                                   │
        │                                                                     │
        ▼ (aliasing canónico: texto → test_id / categoría canónica)           │
┌─────────────────────────────────────────────┐                              │
│  MOTOR DETERMINISTA DE VALORACIÓN (sin LLM)   │ ◀──── consultas ──── BBDD CURADA (SQLite)
│  · selecciona ensayos aplicables por regla     │                     · categorías + aliases
│  · calcula nº de lotes y nº de ensayos          │                     · ensayos canónicos
│  · aplica precio canónico (estrategia)          │                     · reglas de frecuencia
│  · adjunta PROVENANCE a cada línea              │                     · precios (hist. + fuente)
└─────────────────────────────────────────────┘                     · estructura de tramos
        │                                                            · proyectos históricos (eval)
        ▼
  PlanLine[] (con provenance + flags de fallback)
        │
        ├──▶ UI Detalle (presupuesto por tramo, trazabilidad por línea)
        ├──▶ Exportación Word/Excel
        └──▶ Agente conversacional / edición NL (tool-calling sobre el motor)
```

### Componentes
- **BBDD curada (SQLite):** se *construye* desde archivos fuente versionados (YAML/JSON en repo) mediante un build script reproducible. Editar el conocimiento = editar fuente + rebuild (diffable en git). Tablas con prefijo `kb_`.
- **Motor determinista:** funciones puras, testeables con `tsx`, **cero dependencia de red/LLM**.
- **Capa de extracción LLM:** estrecha, con salida validada por JSON Schema; Gemini primario, MiniMax fallback, reintentos.
- **Eval harness:** mide desviación vs históricos reales y cobertura de matching. Se ejecuta al cerrar **cada** etapa (guardia anti-regresión).

---

## 4. Modelo de datos curado (propuesta inicial — se afina en Etapa 1 con tus fuentes)

> Fuente de verdad = archivos versionados en `resources/knowledge/curated/` (YAML/JSON).
> El SQLite es un artefacto **derivado** y rebuildeable.

```
kb_categories
  code            TEXT PK        -- TERRAPLEN_RELLENOS, HORMIGON, ...
  name            TEXT
  default_unit    TEXT           -- m3, m2, ml, ud, t...
  keywords        JSON           -- aliases para clasificación
  norm_refs       JSON           -- PG-3 Art.330, etc.

kb_tests                          -- catálogo CANÓNICO de ensayos (identidad única)
  id              TEXT PK        -- T-0001
  canonical_desc  TEXT
  norm_codes      JSON           -- ["UNE 103501:94", ...]
  subcategory     TEXT           -- Caracterización, Compactación, ...
  unit_of_test    TEXT

kb_test_aliases                   -- mapea texto libre → ensayo canónico (sustituye al fuzzy)
  alias           TEXT
  test_id         TEXT FK
  source          TEXT           -- de dónde vino el alias

kb_frequency_rules                -- lógica normativa de "cuántos ensayos"
  id              INTEGER PK
  category_code   TEXT FK
  test_id         TEXT FK
  freq_qty        REAL           -- 1
  freq_unit       TEXT           -- "10000 m3"
  tests_per_lot   REAL
  min_tests       INTEGER        -- piso (p.ej. siempre ≥1 si aplica)
  conditions      JSON           -- {material:"...", capa:"...", solo_si:...}
  priority        INTEGER
  norm_ref        TEXT

kb_prices                         -- precio por ensayo (con histórico y fuente)
  test_id         TEXT FK
  reciente        REAL
  mediana         REAL
  min             REAL
  max             REAL
  n               INTEGER
  source          TEXT           -- pricebook | tarifa_cye | alagal | manual
  valid_from      TEXT

kb_section_templates              -- cómo desglosar una categoría en tramos/secciones
  category_code   TEXT FK
  rule            JSON           -- criterio de partición por tramo/capa

kb_hist_projects / kb_hist_lines  -- proyectos reales (calibración + EVAL, no runtime fuzzy)
```

### Contratos TypeScript (núcleo, estables entre etapas)
```ts
// Salida del extractor (lo único que produce el LLM)
interface MedicionEstructurada {
  tramo: string | null
  categoryCode: string          // canónica
  material: string
  quantity: number
  unit: string
  confidence: number            // 0..1
  source: { page?: number; cell?: string }  // trazabilidad al documento
}

// Procedencia de cada línea del plan (clave para confianza y debug)
interface Provenance {
  ruleId: number | null         // qué regla de frecuencia
  freq: string | null           // "1 / 10000 m3"
  priceSource: 'pricebook' | 'tarifa_cye' | 'alagal' | 'manual' | 'fallback'
  matchConfidence: number       // alias exacto = 1.0
  notes?: string
}

interface PlanLine {
  tramo: string | null
  testId: string | null         // null si fallback no resuelto
  description: string
  nLots: number | null
  nTests: number
  unitPrice: number | null      // null = pendiente de preciar (fallback)
  total: number | null
  provenance: Provenance
  needsReview: boolean          // true para fallback / baja confianza
}
```

---

## 5. Plan por etapas

> Cada etapa tiene **Definición de Hecho (DoD)** y se cierra ejecutando el eval harness.
> No se avanza a la siguiente sin DoD verde.

### Etapa 0 — Fundamentos y línea base *(este documento + andamiaje)*
- [x] Branch `Cye_BBDD`.
- [x] `PLAN_BBDD.md` (este doc): objetivos, arquitectura, contratos, métricas.
- [ ] Glosario de dominio (sección 8) consensuado.
- [ ] Esqueleto de migraciones `kb_*` y layout `resources/knowledge/curated/`.
- [ ] Contratos TS (`MedicionEstructurada`, `PlanLine`, `Provenance`) en código.
- [ ] **Eval harness + línea base**: medir desviación del sistema ACTUAL sobre los 6 históricos (held-out) → número "antes" que hay que batir.
- **DoD:** existe un número de baseline reproducible y los contratos compilan.

### Etapa 1 — Curación e ingesta de la BBDD ✅ *(núcleo hecho 2026-06-26)*
- [x] Esquema canónico (`src/main/pipeline/kb/types.ts`) + layout `resources/knowledge/curated/`.
- [x] Importador **ALAGAL** (`kb:import-alagal`) → 749 ensayos, 17 secciones, 656 con norma → `alagal_catalog.json`.
- [x] Importador **presupuestos CYE** (`kb:import-cye`) → 8 proyectos, 4 esquemas de columnas, **226 reglas de frecuencia**, 207 precios `tarifa_cye`, 196 aliases, 103 ensayos CYE-específicos.
- [x] Build `kb:build` → `kb.sqlite` reproducible (node:sqlite; 7 tablas `kb_*`, 852 tests, 956 precios, 707 líneas eval).
- [x] **Informe de cobertura**: preciado **100%** (toda línea tiene precio); reutilización ALAGAL **77%**; resto = ensayos CYE-específicos (93 sin norma = eléctricos/saneamiento/edificación, legítimos; ~10 con norma a revisar).
- [x] **Pulido de curación (2026-06-26):** ditto (`"`) heredado; `freq_unit` estructurado en `{freqKind, freqQty, freqMagUnit}`; fusión de variantes (`5.000`/`5000 m3`, `Por material`/`Por tipo`) → reglas 226→**176**. Clasificadas: 106 per_quantity, 44 per_type, 6 per_element, 5 fixed, 1 per_lot, **13 other** (condicionales legítimas: "Si procede", "Informe"… correctamente marcadas para revisión).
- [x] Verificado: los ~10 norm-coded no emparejados **no están en ALAGAL** (NLT-329/336/251, UNE 41240…) → CYE-específicos correctos, no hay matching que recuperar.
- **DoD:** ✅ `kb:build` reproducible + preciado 100% + frecuencias estructuradas y deduplicadas.

### Etapa 2 — Motor determinista de valoración ✅ *(hecho 2026-06-26, sin LLM)*
- [x] `src/main/pipeline/kb/kb.ts`: carga la KB curada en memoria (JSON, sin deps nativas) + dedup de reglas (1 por categoría×ensayo) + `effectivePrice` (tarifa_cye > pricebook > alagal).
- [x] `src/main/pipeline/kb/engine.ts`: `generatePlan(sections, kb)` por tramo; `computeTests` por `freqKind` (per_quantity → `ceil(qty/freqQty)×muestreo`; per_type/element → muestreo; fixed; other→flag).
- [x] Conversión de unidades (kg↔t, m↔ml, ud↔u); unidad incompatible → `needsReview` (no inventa).
- [x] `provenance` por línea (regla, freq legible, fuente de precio, confianza) + `needsReview` para fallback.
- [x] Validación `kb:plan`: caso controlado + **determinismo verificado** (mismo input → salida byte-idéntica, sale ≠0 si falla).
- **DoD:** ✅ motor corre, determinista, con provenance y fallback marcado.

> **Política de frecuencia — CORREGIDA con normativa (2026-06-26).** La hipótesis "por volumen"
> (umbral 500.000 m³) resultó **errónea**: la investigación normativa (verificada vs BOE, ver
> [`NORMATIVA_FRECUENCIAS.md`](NORMATIVA_FRECUENCIAS.md)) demuestra que el 5.000/10.000 son
> **superficies (m²) del lote** y el conmutador es la **altura del terraplén** (<5 m / ≥5 m),
> no el volumen. El `VOLUME_THRESHOLD` de `engine.ts` queda **superado**. Modelo correcto = **dos
> controles**: FABRICACIÓN (por volumen, escalones 1.000/5.000/20.000 m³) y RECEPCIÓN/EJECUCIÓN
> (por **lote** = menor de 500 m / superficie m² / fracción diaria × batería fija por lote).
> **Implica rehacer el motor a "por lote"** y que el extractor (Etapa 3) aporte superficie,
> longitud, altura y nº de tongadas — no solo volumen. La frecuencia es **autoridad normativa**;
> los presupuestos CYE solo calibran el **precio**.

> **Limitación conocida (la resuelve Etapa 3).** Muchas secciones eval no tienen cantidad, y
> ensayos por área/tongada (m²) no se calculan en secciones medidas en m³ → se marcan. Por eso
> en `kb:plan (c)` la desviación vs real aún es grande; la paridad fina es Etapa 4.

### Etapa 3 — Capa de extracción LLM ✅ *(hecho 2026-06-26, bordes)*
- [x] `kb/kbExtractor.ts`: documento (PDF/XLSX/…) → texto → `classifyMaterials` (Gemini→MiniMax, reusa el classifier) → `SectionInput[]`, con inferencia de **capa** (rodadura/intermedia/base) y **altura ≥5 m**. El LLM solo produce estructura.
- [x] `engine.ts`: manejo de **SERVICIO** (facturación directa cantidad × precio).
- [x] Harness `kb:extract`: end-to-end documento→extractor→motor vs total real de CYE.
- **DoD:** ✅ extracción estructurada estable y validada (E8: 20 secciones, **Δ −6,6%**; E6: 21 secciones).

> **Validación end-to-end (Totalizados → presupuesto):** E8 (movimiento de tierras) **−6,6%**;
> E6 (estructura) **−50%**. La extracción/clasificación es buena en ambos; el infraconteo de E6 se
> concentra en categorías con **datos normativos incompletos**: hormigón (valores de lote pendientes
> de verificar) y acero_activo/acero_laminado/escollera (sin reglas). Es **brecha de datos, no del
> extractor** → se cierra en Etapa 1bis (completar hormigón/acero) + Etapa 4 (paridad fina).

### Etapa 4 — Integración end-to-end + paridad
- [ ] Cablear extractor → motor → plan en `pipeline.ts`/IPC, **tras feature flag** (motor nuevo vs `plannerLLM` viejo) para A/B.
- [ ] Correr sobre los 6 históricos (held-out) y medir desviación vs CYE real.
- [ ] **Objetivo de precisión acordado** (propuesta: ±5% total de obra y cobertura de líneas ≥95%).
- **DoD:** paridad alcanzada (bate el baseline de Etapa 0 y cumple el objetivo).

### Etapa 5 — UI: presupuesto por tramo + trazabilidad ✅ *(hecho 2026-06-26)*
- [x] Página **"Presupuesto BBDD"** (`/bbdd`, menú Herramientas): elegir documento → plan por tramo.
- [x] Por línea: nº ensayos, precio, importe y **provenance** (normativa+artículo o "presupuesto CYE" + fuente de precio). Líneas `needsReview` resaltadas. KPIs (base/IVA/total) + banner de avisos (sanity-check).
- [x] `services/bbddPlan.ts` + IPC `bbdd:generateFromDoc` + `api.bbddGenerate`.
- [ ] (Diferido) UI de curación de la KB / edición por el cliente con persistencia de correcciones.
- **DoD:** ✅ build+typecheck verdes; render/clic en vivo pendiente de `npm run dev` (entorno de desarrollo headless).

### Etapa 6 — Chat "¿por qué este ensayo?" + bucle de aprendizaje *(sobre el motor)*
- [x] **"¿por qué este ensayo?" (determinista)**: en Presupuesto BBDD, clic en línea → explicación citada desde la provenance (motivo/artículo, cálculo de lotes, fuente de precio, confianza). Sin LLM → sin alucinación.
- [ ] (Opcional) chat en lenguaje natural (LLM con tool-calling sobre el motor) para preguntas libres.
- [ ] Bucle de correcciones del cliente (precio/regla → realimenta la BBDD curada).
- [ ] Agente tool-calling para "¿por qué este ensayo?" y edición NL — **las herramientas son las consultas deterministas del motor** (respuestas fundamentadas, no inventadas).
- [ ] Correcciones de precio/regla desde la UI → realimentan las fuentes curadas (bucle de aprendizaje).
- **DoD:** el chat responde citando regla+fuente; una corrección persiste y cambia el siguiente cálculo.

### Etapa 7 — Retirada del RAG antiguo + limpieza
- [ ] Eliminar embeddings (49 MB + 23 MB), TF-IDF, `ragPricer`, `plannerLLM`, `embeddingsProcess/Worker`.
- [ ] Quitar archivos grandes de `resources/`, actualizar build y `.gitignore`.
- [ ] Eval final + actualización de `PLAN.md` y este doc.
- **DoD:** build limpio sin el RAG viejo, eval final ≥ objetivo, tamaño del bundle reducido.

---

## 6. Cómo NO perder contexto ni objetivos entre etapas

1. **Este documento es la estrella polar.** Sección "Bitácora" al final: al cerrar cada etapa se anota qué se hizo, decisiones tomadas, métricas y preguntas abiertas.
2. **Eval harness en cada cierre de etapa** con tabla de métricas histórica → guardia anti-regresión (si una etapa empeora el número, no se mergea).
3. **Provenance obligatoria en cada línea** → toda cifra es explicable y depurable. La trazabilidad *es* la confianza.
4. **Glosario de dominio** (sección 8) para terminología estable.
5. **Criterios de aceptación (DoD) explícitos** por etapa; no se avanza sin verde.
6. **Fuentes curadas versionadas** → el conocimiento es diffable en git, no opaco en un binario.

---

## 7. Métricas y objetivos (se rellenan al avanzar)

| Métrica | Baseline (sistema actual) | Objetivo | Etapa 4 | Final |
|---|---|---|---|---|
| Desviación total vs CYE real (media |%|) | _(medir en Etapa 0)_ | ≤ ±5% | — | — |
| Cobertura de matching (líneas → canónico) | — | ≥ 95% | — | — |
| Determinismo (mismo input→output) | ❌ (LLM libre) | ✅ 100% | — | — |
| Líneas en fallback sin preciar | — | minimizar/visible | — | — |

---

## 8. Glosario de dominio

- **Ensayo:** prueba de control de calidad (p.ej. Proctor Modificado UNE 103501).
- **Categoría:** familia de material/obra (TERRAPLEN_RELLENOS, HORMIGON…).
- **Tramo / sección:** subdivisión de obra; CYE real presupuesta por tramo.
- **Lote:** unidad de medición que dispara un conjunto de ensayos según frecuencia.
- **Frecuencia:** regla normativa "1 ensayo por cada X unidades" (PG-3 / UNE).
- **price_book / tarifa CYE / ALAGAL:** fuentes de precio (prioridad: CYE > pricebook > ALAGAL).
- **Provenance:** procedencia auditable de cada línea (regla, frecuencia, fuente de precio, confianza).
- **Fallback marcado:** ensayo no cubierto por la BBDD; se muestra pero no se inventa precio.

---

## 9. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Cobertura insuficiente de la BBDD curada | Informe de cobertura en Etapa 1; fallback marcado; curación iterativa. |
| El extractor LLM clasifica mal el tramo/categoría | Validación por schema + confianza + revisión humana de baja confianza; aliasing curado. |
| Reglas de frecuencia incompletas para categorías nuevas | `kb_frequency_rules` versionado y ampliable; tests golden por categoría. |
| Pérdida de cobertura al borrar el RAG | Borrado solo en Etapa 7, tras paridad demostrada. |
| Conflictos de precio entre fuentes | Prioridad explícita (CYE>pricebook>ALAGAL) + resolución en curación. |

---

## 10. Bitácora

- **2026-06-26** — Etapa 0 iniciada. Branch creada, decisiones de arquitectura cerradas, este documento redactado.
- **2026-06-26** — Fuentes analizadas → [`INVENTARIO_FUENTES.md`](INVENTARIO_FUENTES.md). Hallazgos clave:
  - Distinguir **presupuesto de obra (input)** de **presupuesto de ensayos CYE (oro)**: los sueltos (`G2156C`, `Orbital`, `pres3012`) son de obra → solo input de prueba.
  - Catálogo canónico de precios = **ALAGAL** (749 ensayos, 17 categorías, 705 con norma).
  - Oro = **8 presupuestos CYE** (E1–E6 ya conocidos + **E7/E8 nuevos**), mayoría formato A (con frecuencia MUESTREO+UD).
  - Prioridad de precio: `tarifa_cye` > `price_book` > `alagal`.
  - Discriminador de exclusión: hoja **`Plan de Ensaios`** = generado por la app (inválido). Excluidos ~20 planes + `tmp_obra/*.ppm`.
  - **Ambigüedades pendientes:** hoja definitiva de E5 (`P-1339-20`); confirmar `0414.26 P.xls` como válido de E7; ¿hay más presupuestos CYE fuera de la carpeta?
- **2026-06-26** — Ambigüedades resueltas (E5→`BASE`, E7→`0414.26 P.xls`, cerrado con 8+ALAGAL) y **Etapa 1 construida**: módulo `src/main/pipeline/kb/` + harness `kb/{importAlagal,importCye,buildKb}.ts`, scripts `kb:import-alagal`/`kb:import-cye`/`kb:build`, fuentes curadas en `resources/knowledge/curated/` y `kb.sqlite` (gitignored). Typecheck verde.
- **2026-06-26** — **Pulido de datos**: `freq_unit` estructurado (`freqKind/freqQty/freqMagUnit`), ditto resuelto, variantes fusionadas (176 reglas). El motor ya calcula lotes vía SQL (`ceil(qty/freqQty)`).
- **2026-06-26** — **Etapa 2 completada**: motor determinista (`kb/kb.ts` + `kb/engine.ts`), validación `kb:plan` con determinismo verificado.
- **2026-06-26** — **Política de frecuencia afinada con datos** (umbral volumen 500.000 m³) — *luego corregida, ver siguiente*.
- **2026-06-26** — **Investigación normativa 1ª tanda (deep-research, verificada vs BOE)** → [`NORMATIVA_FRECUENCIAS.md`](NORMATIVA_FRECUENCIAS.md). **Corrige el modelo:** 5.000/10.000 = superficies de lote por altura de terraplén, NO volumen. Dos controles: fabricación (por m³) y recepción (por lote). Verificado: terraplén (330/332), zahorra (510), suelo estab. recepción (512.9.3), bituminosa recepción (542.9.4).
- **2026-06-26** — **Trazabilidad en Detalle.** `rag_desc` lleva la procedencia completa (artículo · control · cálculo de lotes); como PlanTable agrupa por material (=tramo), el plan BBDD se ve por tramo con fuente de precio y confianza, sin migración de esquema. La integración BBDD queda usable de extremo a extremo (Nueva Obra → guardar → Detalle → exportar).
- **2026-06-26** — **Motor BBDD integrado en Nueva Obra.** Selector de motor (BBDD por defecto / RAG) en modo generar; `ingestDocumentBBDD` devuelve el mismo `IngestResult` (PlanLine→PlanRowInput, tramo→material, provenance→rag_desc/price_source) → encaja en revisar/guardar/Detalle/exportar sin tocar el flujo. Typecheck+build verdes. (Mapeo al esquema viejo es algo lossy: tramo en columna material, provenance completa no se persiste — pendiente extender esquema si se quiere trazabilidad total en Detalle.)
- **2026-06-26** — **E7 (extracción flaky) arreglado**: `extractSections` reintenta hasta 3× cuando la clasificación LLM vuelve vacía (último intento fuerza MiniMax) + guarda contra docs sin texto; aviso propagado a UI. E7 pasa de 0 a 11-15 secciones. Validación final: bien-dotados E1 −5%, E5 +15%, E6 −26%, E8 −3%; pequeños sobre-cuentan (E2 +42%, E4 +110%, E7 +265% —su real es una oferta reducida). Sobre-conteo de pequeños = residuo aceptado (decisión usuario: sin cambios drásticos), a resolver con el bucle de correcciones del cliente.
- **2026-06-26** — **Validación con los 8 ejemplos** (`kb:eval-all`, referencia = suma de importes reales). Bien-dotados: E1 −5%, E5 +15%, E6 −26%, E8 −4%. **Errores residuales detectados:** (1) sobre-conteo en proyectos pequeños (E2 +42%, E4 +108%) — el gap-fill aplica muchas reglas con piso ≥1; (2) extracción LLM flaky (E7 dio 0 secciones en una pasada) — falta retry/validación; (3) E3 referencia incompleta (2 líneas parseadas) — re-parsear o excluir.
- **2026-06-26** — **Etapa 5 — UI "Presupuesto BBDD".** Página `/bbdd` (por tramo, trazabilidad por línea, needsReview, KPIs, avisos) + `services/bbddPlan.ts` + IPC + preload. Build electron-vite y typecheck verdes; verificación visual en vivo pendiente de `npm run dev`.
- **2026-06-26** — **Hormigón/acero arreglados + calibración empírica.** El gap-fill ahora calcula por la magnitud correcta (m³/t/m²/m), kg→t, y SERVICIO se factura directo. Calibración desde ejemplos reales: ensayos que NO escalan con el volumen (caracterización: penetración, geométrica de acero…) reclasificados per_quantity→per_type (11 reglas) → corrige la sobre-extrapolación. Sanity-check por categoría (avisa de cantidades inusuales, p.ej. acero 61.380 t). **End-to-end: E8 −4,7%, E6 −38%** (residuo E6 = acero_activo/laminado sin reglas). Resuelto con **fallback de categoría** (acero_activo/laminado → acero, replica ejemplos): **E8 −2,9%, E6 −26%**. Escollera sigue sin reglas (frecuencia PPTP, impacto menor) — pendiente opcional.
- **2026-06-26** — **Etapa 3 — extractor LLM hecho.** `kbExtractor` (doc→`classifyMaterials`→`SectionInput[]`, capa/altura inferidas) + SERVICIO en el motor + harness `kb:extract`. End-to-end: E8 **Δ −6,6%**, E6 −50% (infraconteo por datos de hormigón/acero incompletos, no por el extractor). **Siguiente: completar hormigón/acero (Etapa 1bis) y paridad (Etapa 4).**
- **2026-06-26** — **Motor integrado (Etapa 2 cerrada en lo esencial).** `generatePlan` reescrito al modelo por lote + gap-fill (normativa manda, presupuesto rellena); `kb.matchTest` mapea batería→ensayo canónico para precio. Validado vs total real de los 8 proyectos: corregido el sobreconteo catastrófico (regla "1/10 lotes" inflaba a 440.000 ensayos → 6,6M€). Estado: E5 −16%, E8 −51% (infraconteo por secciones sin cantidad/superficie). **Refinamiento pendiente:** dedup de ensayos de control duplicados (densidad normativa vs presupuesto). **Paridad fina = Etapa 4** (necesita extractor con superficie/longitud/altura/capa).
- **2026-06-26** — **Modelo "por lote" — núcleo implementado y validado.** `kb/normative.ts` + `kb/lotEngine.ts` (+ `kb:lote`): dos controles (fabricación por escalones m³/t; recepción/ejecución por lote = volumen/(espesor×superficie_lote) × batería). Superficie estimada de volumen/espesor de tongada cuando no se conoce. **Valida vs E8 real:** terraplén 4,4M m³ → densidad 7335 (real 7350), placa 1467 (real 1470). Falta: integrar en `generatePlan` (mapear batería→ensayo canónico para precio, gap-fill con frecuencia de presupuestos donde no hay norma, PlanLine con provenance).
- **2026-06-26** — **3ª tanda** (enfocada, completa). Confirmado 3-0: riegos imprimación (530, mín 500 g/m², ±15%) y adherencia (531, mín 200/250 g/m², +15%/−10%); tabla fabricación bituminosa 542.16 (600/300/150 y 1.000/500/250 t/ensayo por NCF); marcas viales (700, dotación por bandejas; comportamiento por PPTP). **Escollera (658): sin frecuencia normativa — es PPTP/práctica.** `normative_rules.json` = **13 reglas, todas verificadas**. Cuadro normativo cerrado. **Siguiente: rehacer el motor a "por lote".**
- **2026-06-26** — **2ª tanda** (parcial; cortada por límite de sesión, reset 13:00). **Confirmado 3-0:** hormigón (Código Estructural Art. 57 / EHE-08 86.5.4.2: N amasadas × 2 probetas), acero (EHE-08 Art. 87: lote ≤40 t), y **suelo estabilizado ejecución 512.9.2 (Proctor 1/10.000 m³ o semanal — reverificado, antes refutado por error)**. **Sin verificar (abstain por límite, no refutado):** riegos (530/531), marcas viales (700), tabla fabricación bituminosa 542.16. **No obtenido:** escolleras (658). Decisión pendiente: rehacer el motor a "por lote".
