# CYE Electron — Plan de desarrollo y roadmap

> Reescritura de `~/Desktop/cye-demo` (Streamlit + Python) a **Electron + React + TypeScript**.
> Distribuible como `.exe`/`.dmg` a laboratorios de control de calidad.

---

## Decisiones de arquitectura

- **Proceso main (Node) ↔ preload (IPC tipado) ↔ renderer (React).** Igual que Contido.
- **Word vía plantilla `.docx`** con `docxtemplater` — editable en Word sin tocar código.
- **RAG híbrido:** TF-IDF char n-gram + embeddings locales (`multilingual-e5-small`, transformers.js
  en UtilityProcess). Sin red, sin coste, sin límites. MiniMax enchufable como alternativa.
- **LLM enchufable** (`LlmProvider`): MiniMax de base; arquitectura preparada para añadir Claude.
- **DB SQLite** con migraciones por `user_version`. Esquema preparado para features futuras
  (firma/responsable, estado de ensayo, correcciones de precio).

---

## Estado de fases

- [x] **Fase 0** — Scaffold Electron+TS+Vite+React, SQLite con migraciones, git.
- [x] **Fase 1** — Pipeline núcleo: planner + test_rules.json + RAG TF-IDF + harness eval. Baseline RAG: 80%.
- [x] **Fase 2** — Ingesta multi-formato: PDF (unpdf), DOCX (mammoth), XLSX (exceljs), TXT.
      Classifier LLM (MiniMax): classifyMaterials + extractObraInfo. OCR diferido (baja prioridad).
- [x] **Fase 3** — Entregables: Excel (exceljs) + Word (docxtemplater sobre plantilla).
- [x] **Fase 4** — UI React completa: Dashboard · Proyectos · NuevaObra · Detalle.
      IPC cableado, pipeline cacheado, tema CYE, confianza IA por fila (feature #1).
- [x] **Fase 4.5** — Pantalla Validación RAG: búsqueda ensayo→catálogo con score en tiempo real.
- [x] **Fase 5** — Empaquetado: `.dmg` + `.zip` x64. better-sqlite3 nativo, recursos colocados.
- [x] **Fase 6** — Informes de campo: densidad in situ (ASTM D-6938) + placa de carga (NLT-357).
      Motor de cálculo con veredicto. Plan editable con recálculo y guardado transaccional.
      Páginas Ensayos y Presupuestos. Pulido UI (Dashboard, Proyectos).

**RAG híbrido (P1):**
- [x] Embeddings locales activos (`multilingual-e5-small`, UtilityProcess). Índice 749/749 entradas.
- [x] Hybrid scoring: TF-IDF + embeddings (peso 0.3). Corrige "granulometría→proctor" (92€→44€).
- [x] price_book.json (histórico propio) como prioridad 1 sobre ALAGAL.
- [x] Umbrales ajustados con harness `rag:thresholds` (PB: 0.55, ALAGAL: 0.45).

**RAG-2 — Mejoras de scoring (2026-06-21):**
- [x] `reranker.ts`: re-ranker LLM (Gemini Flash) para zona gris [0.35, 0.65].
      `maybeRerank()` llamado desde `LabPricer.findMatches()` (pantalla validación).
      Si no hay GEMINI_API_KEY → silencioso, sin re-ranking.
- [x] RRF (Reciprocal Rank Fusion) implementado en `RagPricer`. Habilitado con
      `useRrf: true` en `RagPricerOptions`. Por defecto off — requiere re-calibrar
      umbrales con `npm run rag:thresholds` antes de activar.
- [x] Category bonus (+0.05) en `priceMany`: compara categoría interna con el
      campo `categoria` del catálogo ALAGAL.
- [x] `CATEGORY_CTX` extendido con: ACERO_LAMINADO, MARCAS_VIALES, RIEGO_BITUMINOSO,
      PILOTES, CAMPANA_GEOTECNICA.

**RAG-3 — Categorías y frecuencias (2026-06-21):**
- [x] `test_rules.json` TERRAPLEN_RELLENOS: lab → 5.000 m³ (era 10.000, PG-3 Art.330).
      CBR → 50.000 m³. Densidad in situ → 5.000 m² y tongada.
- [x] Nuevas categorías en `test_rules.json`: CAMPANA_GEOTECNICA, MARCAS_VIALES,
      ACERO_LAMINADO, PILOTES, RIEGO_BITUMINOSO.
- [x] `classifier.ts` SYSTEM_PROMPT: reconoce las 5 nuevas categorías y distingue
      ACERO (armadura) de ACERO_LAMINADO (perfiles estructurales).

---

## Roadmap

### P2 — Cerrar el ciclo plan ↔ ejecución _(diferenciador LIMS)_

- [x] `plan_row_id` en `ensayos` (migración v5). Enlace suave (ON DELETE SET NULL).
- [x] Vista de avance en Detalle → tab Ensayos: barra %, planificados vs completados, tabla por material.
- [x] Selector de línea del plan en el editor de ensayos.
- [x] Bug fix: botón Editar en Detalle navega directamente al ensayo específico (state.editEnsayoId).
- [ ] Dashboard: KPI "% avance" entre todos los proyectos activos.

### P3 — Requisitos de acreditación ENAC

- [x] `n_expediente` en `ensayos` (migración v5): campo correlativo AAAA/NNNN.
- [x] `getNextExpediente(year)`: sugiere el siguiente número libre, el usuario confirma.
- [x] Botón "Auto" en el editor de ensayos para asignar el siguiente expediente.
- [x] Estado `aprobado` añadido al flujo borrador → completado → aprobado.
- [x] Tabla `muestras` (migración v6): cadena de custodia, enlazada a ensayos y obras.
- [ ] UI para gestionar muestras (crear, listar por ensayo).
- [ ] Sello/firma en exportación Word de informes aprobados.

### P4 — Bucle de aprendizaje del precio _(feature #2)_

Al corregir un precio en la tabla editable, guardar en `price_corrections` → alimenta el harness.
La app mejora con el uso. La tabla DB ya existe; falta cablear la captura en la UI.

### P5 — Inteligencia de producto

- **Feature #4:** diff de planes cuando cambia el presupuesto (qué ensayos se añaden/quitan/varían).
- **Feature #3:** chat sobre el proyecto ("¿por qué este ensayo?" → cita regla + fragmento de memoria).
- Analítica entre proyectos: precios medios, ratios €/m³, histórico cross-project.

### P6 — Distribución profesional _(de Fase 5)_

- Firma + notarización Apple (Developer ID, evita Gatekeeper).
- Build Windows `.exe` vía CI/GitHub Actions.
- Build universal/arm64 para clientes Apple Silicon.
- Auto-update (`publish` hoy apunta a example.com).
- Bundlear modelo de embeddings (~100 MB) en `resources/` para offline total.

---

## Análisis de diferencias P-0618 (CYE) vs Plan App — pendiente revisar

> Análisis realizado 2026-06-23 comparando `P-0618-2018 CYE A54 ARZUA.xlsx` (€1.314.272, 219 líneas)
> con `Plan_MELIDE_ARZUA.xlsx` generado por la App (€1.496.730, 124 líneas). Diferencia: +€182.458 (+13,9%).

### Causas identificadas (NO corregidas todavía)

1. **Precios unitarios** — la App usa `price_book` (mediana/máximo/mínimo) vs tarifa interna CYE.
   Divergencias conocidas: Proctor Modificado App €60 vs CYE €55; Desgaste Los Ángeles App €60 vs CYE €54;
   Fórmula trabajo MBC App €86 vs CYE €185. Impacto pequeño (~€5-10k neto). Pendiente: revisar
   si ajustar `price_book.json` con precios reales de CYE.

2. **Número de lotes/ensayos calculado** — la App lee cantidades distintas del documento por capas/materiales.
   MBC genera filas por cada tipo de capa → multiplica "Análisis gran. áridos recuperados" (~€100k extra).
   RELLENO: App 431 uds vs CYE 440 (diferencia de cantidad de partida: 4.304.081 vs ~4.400.000 m³).

3. **Catálogo de ensayos diferente** — causa dominante (~€178k de los €182k totales):
   - **Solo en App:** Fabricación 3 probetas suelo estabilizado €276k; Extracción testigo MBC ~€205k;
     Ensayo carga placa NLT-357 ~€115k; Hormigón probetas (múltiples tipos) ~€121k; CROSS HOLE €61k.
   - **Solo en CYE:** 219 líneas vs 124 App — CYE desglosa por tramo/sección; la App agrupa por categoría.
     Muchas partidas CYE sin equivalente en `test_rules.json` o con descripciones que no matchean.

4. **Granularidad de agrupación** — CYE hace una fila por tramo de obra; la App hace una fila
   por categoría de material a nivel global. Esto puede generar exceso de lotes en mezclas bituminosas.

---

## Deuda técnica

- `unit_price_base` / `discount_pct` (migración v4): campos en DB pero descuento no recalculado en `updatePlanRows`.
- `iva_rate` por obra (migración v3): campo en DB pero formatter siempre usa 0.21 hardcodeado.
- `granulometria`: motor de cálculo existe (`ensayos.ts`) pero UI y plantilla pendientes.
- Tests automatizados (hoy el harness es manual).
- Error-handling / telemetría en pipelines largos (ingestDocument puede tardar 20-30 s sin cancelación).
- Backups automáticos de la DB.

---

## Diferenciador de CYE frente al sector (CMT/LIMS)

Referentes: Spectra QEST, MetaField, eFieldData, ForneyVault, Aldoa.

**Lo que ellos no hacen:** generar el plan de control VALORADO desde el PDF del proyecto con IA.
Todos asumen el plan ya existente. CYE entra antes en la cadena (generación) y puede expandirse
al territorio LIMS (ejecución/resultados) — lo que los módulos Ensayos/Resultados ya inician.

Features diferenciadoras comprometidas:
1. **Confianza IA por fila** — `price_source` + `rag_score` visible en UI. ✅ Implementado.
2. **Bucle de aprendizaje** — correcciones del usuario alimentan el harness RAG. ⏳ Pendiente cablear UI.
3. **Chat sobre el proyecto** — "¿por qué este ensayo?" cita regla + fragmento. 🔵 Diferido.
4. **Diff de planes** — qué cambia si cambia el presupuesto. 🔵 Diferido.
