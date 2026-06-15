# Plan de migración CYE → Electron

> Documento de trabajo. Origen: `~/Desktop/cye-demo` (Streamlit + Python, referencia).
> Destino: nueva app Electron + TypeScript (carpeta a decidir en Fase 0).

## Objetivos

- Migrar la app de Streamlit a **Electron + TypeScript**, distribuible como `.exe`/`.dmg` a laboratorios.
- Mejor UI/UX que Streamlit (tabla del plan editable, streaming fila a fila, tarjetas/filtros).
- Mejorar el RAG de precios y, sobre todo, dejar montada la **infraestructura para medirlo e iterarlo**.

## Decisiones tomadas

- **Arquitectura:** reescritura completa a Node/TS (sin sidecar Python). Patrón main/renderer como en Contido.
- **Word:** plantilla `.docx` con marcadores (`docxtemplater`), NO reconstrucción por código.
  - La plantilla es un .docx editable en Word con marcadores `{obra}`, `{#ensayos}…{/ensayos}`, etc.
  - Se genera una primera versión a partir de la salida Word actual; luego editable sin tocar código.
- **UI:** React + Vite + librería de componentes (recomendado y aceptado en principio). React solo
  afecta al renderer; no impacta empaquetado ni compatibilidad (mismo Chromium en todos los equipos).
- **RAG:** se acepta API de embeddings. Estrategia híbrida embeddings + TF-IDF char-ngram + harness de eval.

## Riesgos

- 🔴 **Formatter Word** (`agents/formatter.py`, ~1.500 líneas; `generate_word` ~460 con OOXML a bajo nivel).
  Mitigado por la vía de plantilla `.docx`.
- 🟡 OCR de PDFs escaneados (`tesseract.js` WASM: más lento, +traineddata es/en).
- 🟡 Excel corporativo (`exceljs`, fidelidad de formato).
- ⚠️ **No hay git en el origen.** El destino debe inicializar git desde el día 1.

## Mapeo del pipeline (Python → Node)

| Pieza             | Python actual                    | Equivalente Node                              | Riesgo |
| ----------------- | -------------------------------- | --------------------------------------------- | ------ |
| classifier        | MiniMax vía httpx                | fetch HTTPS (¿evaluar modelo frontera?)       | 🟢     |
| planner           | `planner.py` + `test_rules.json` | port directo; JSON se reutiliza               | 🟢     |
| rag_pricer        | TF-IDF sklearn + joblib          | embeddings API + coseno + TF-IDF híbrido      | 🟢     |
| extractor (texto) | pdfplumber                       | `unpdf` / `pdfjs-dist`                        | 🟡     |
| extractor (OCR)   | pytesseract + pdf2image          | `tesseract.js`                                | 🟡     |
| formatter (Excel) | openpyxl                         | `exceljs`                                     | 🟡     |
| formatter (Word)  | python-docx                      | `docxtemplater` + plantilla                   | 🔴→🟡  |
| DB                | sqlite3 (`obras`, `plan_rows`)   | `better-sqlite3` + migraciones `user_version` | 🟢     |

## Fases

- **Fase 0 — Andamiaje:** decidir carpeta/nombre del proyecto; scaffold Electron+TS+Vite+React
  (patrón Contido); `better-sqlite3` con esquema `obras`/`plan_rows` portado + migraciones; **git desde día 1**.
- **Fase 1 — Pipeline núcleo (bajo riesgo):** `planner` + `test_rules.json` + `ragPricer` (embeddings híbrido)
  - **harness de evaluación del RAG**. Validar RAG headless antes de UI.
- **Fase 2 — Ingesta:** `extractor` (texto + OCR) y `classifier`. Evaluar subir de MiniMax a modelo frontera.
- **Fase 3 — Entregables:** `formatter` vía plantilla `.docx` + `exceljs`. (Punto caliente.)
- **Fase 4 — UI:** dashboard, proyectos, nueva obra (streaming), detalle, descargas.
- **Fase 4.5 — HITO: pantalla interna de validación del RAG.** Pegar descripciones, ver matches+score,
  cargar set de casos reales, ver precisión@1. Validar el RAG tocando la interfaz.
- **Fase 5 — Empaquetado:** `electron-builder` → `.dmg`/`.exe` firmados.

## Estrategia RAG (detalle)

1. Indexar catálogo ALAGAL con embeddings multilingüe (voyage-3 / text-embedding-3-large), una sola vez;
   guardar vectores en SQLite (`catalog_embeddings`).
2. Búsqueda híbrida: coseno semántico (embeddings) + TF-IDF char-ngram (bueno con Proctor/Atterberg/UNE).
3. Harness de eval: casos `descripción de ensayo → entrada/precio correcto` → precisión@1, recall@k, score medio.
   - NO necesita los PDFs de obra (eso es para evaluar el classifier, problema aparte).
   - Sembrar con los resultados reales que el usuario tenga, aunque sean pocos.

## Inspiración del sector (CMT/LIMS) y diferenciador

- Referentes: Spectra QEST, MetaField, eFieldData, ForneyVault, Aldoa, Darwin/Stonemont.
- Features clásicas del sector: captura en campo (móvil, foto/GPS/firma), trazabilidad de muestras /
  cadena de custodia, cálculos automáticos, plantillas de informe + PDF firmado, cumplimiento normativo,
  dashboards por proyecto, captura directa desde máquinas, portal de cliente, integración facturación.
- **Diferenciador de CYE:** generar el plan de control VALORADO desde el PDF del proyecto con IA.
  Ningún competidor lo hace — todos asumen el plan ya existente y se centran en ejecutarlo. Nicho propio.
- Visión: CYE entra antes en la cadena (generación) y puede expandirse luego al territorio LIMS
  (ejecución/resultados) — encaja con los módulos "Ensayos"/"Resultados" ya esbozados.

### Decisiones de modelo de datos derivadas (baratas ahora, caras de retrofitear) — incorporar en Fase 0

- Campos de **firma/responsable** y **estado de ensayo** (planificado/en curso/resultado) en el esquema.
- Tabla de **correcciones del usuario** (auditoría + combustible para el harness del RAG):
  cuando el usuario corrige precio/match en la tabla editable, se guarda como ejemplo etiquetado.

### ⭐ Features diferenciadoras COMPROMETIDAS (roadmap firme — el usuario las quiere)

Son el "foso" de CYE frente a los LIMS clásicos. No se construyen en Fase 0, pero el modelo de datos
y la arquitectura deben dejarles sitio desde el principio.

1. **Confianza explícita de la IA por fila**: mostrar el origen de cada precio en la UI
   (`price_source`: alagal/fallback + `rag_score` como "nivel de confianza"). Ya existen en el planner.
   Ningún competidor lo tiene porque ninguno usa IA aquí.
2. **Bucle de aprendizaje del precio**: cuando el usuario corrige precio/match en la tabla editable,
   se guarda como ejemplo etiquetado → alimenta el harness del RAG. La app mejora sola con el uso.
   (Requiere la tabla de correcciones del usuario — ver modelo de datos.) Conecta con el objetivo de validar el RAG.
3. **Chat sobre el proyecto**: "¿por qué se ha incluido este ensayo?" → el asistente cita la regla de
   `test_rules.json` y el fragmento de la memoria. Tendencia "asistente como ingeniero virtual".
4. **Comparador / diff de planes**: si cambia el presupuesto, qué ensayos se añaden/quitan/varían.

## Pendiente del usuario

- Confirmar React definitivamente (o preferir TS-vanilla como Contido).
- Nombre/carpeta del proyecto destino (Fase 0).
- En Fase 1: aportar pares `ensayo → precio real` para sembrar el harness.

## Estado

- [x] Fase 0 — scaffold electron-vite (Electron 39/React 19/Vite 7/TS 5.9) + capa de datos
      SQLite (better-sqlite3, migraciones user_version, esquema base + campos de features) +
      git inicializado. Verificado: build OK + DB migrada a v1 en ejecución real.
- [x] Fase 1 — pipeline núcleo: planner (port de planner.py) + test_rules.json + ragPricer
      (TF-IDF char n-gram en TS, embeddings enchufables pendientes de activar) + harness de
      evaluación (rag:demo / rag:eval / plan:demo). Baseline medido: 80% acierto precio en el
      set de muestra. Verificado: typecheck OK + 3 scripts corren contra el catálogo real.
      Pendiente futuro: activar embeddings (proveedor a elegir) y sembrar harness con casos reales.
- [x] Fase 2 — Ingesta: extractor de texto PDF (unpdf) con detección de escaneado; capa LLM
      enchufable (LlmProvider + MiniMaxProvider + FallbackProvider) con MiniMax de base/fallback;
      classifier (classifyMaterials + extractObraInfo, port de classifier.py). Demos: extract:demo,
      ingest:demo. Verificado: extractor sobre PDF real (512 chars); wiring classifier→planner con
      proveedor simulado (descarta no-objetos, compone plan). Sin probar en vivo: HTTP real MiniMax
      (necesita key). DIFERIDO: OCR de PDFs escaneados (needsOcr=true detectado; ver nota OCR).
- [ ] Fase 3 ← siguiente
      \_ Nota OCR pendiente: para PDFs escaneados hace falta cadena PDF→imagen (unpdf renderPageAsImage + @napi-rs/canvas) + tesseract.js con traineddata es. Sub-tarea aislada; la mayoría de memorias
      son texto nativo, por eso se difiere. Confirmar con el usuario si sus PDFs reales suelen ser escaneados.
- [ ] Fase 4
- [ ] Fase 4.5 (hito RAG)
- [ ] Fase 5
