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

---

## Roadmap

### P2 — Cerrar el ciclo plan ↔ ejecución _(diferenciador LIMS)_

- Vincular cada informe de ensayo a una línea del plan (`plan_row_id` en `ensayos`).
- Vista de avance por obra: planificados vs ejecutados, % completado, pendientes.
- El Dashboard ya insinúa "Informes de campo" vs "Planificados"; falta el enlace real.

### P3 — Requisitos de acreditación ENAC

- Flujo de firma/aprobación en informes (campos en esquema; falta UI + sello).
- Numeración correlativa de informes/expediente (año/secuencia), trazable.
- Trazabilidad de muestras / cadena de custodia: tabla `muestras` enlazada a ensayos.

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
