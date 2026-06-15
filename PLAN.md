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
      Fase 2b: ingesta MULTI-FORMATO (extractDocument): .pdf (unpdf), .docx (mammoth),
      .xlsx (exceljs), .txt. El usuario confirma que sus inputs reales suelen ser Word/Excel
      con cantidades, texto nativo → OCR queda como BAJA prioridad (diferido, documentado).
- [x] Fase 3 — Entregables: generateExcel (exceljs, port de generate_excel: cabecera, secciones
      por material, tabla valorada, totales sin/con IVA) + generateWord (docxtemplater sobre
      plantilla resources/templates/plan_plantilla.docx, generada con `docx` y editable en Word).
      Scripts: template:build, deliver:demo. Verificado: Excel (totales 5187/1089,27/6276,27 €) y
      Word (9 líneas de ensayo por el bucle {#rows}, totales y responsable) generados y releídos OK.
- [x] Fase 4 — UI React: cableado IPC completo (preload/api.ts + main/ipc.ts), servicio de
      pipeline cacheado (services/pipeline.ts, RAG con degradación elegante), resolución de rutas
      resources (paths.ts) y carga de .env (env.ts). Páginas: Dashboard (KPIs), Proyectos (lista +
      filtros + búsqueda), Nueva Obra (flujo: elegir doc → ingesta IA → revisar → guardar), Detalle
      (plan + descargas Excel/Word + archivar/eliminar). Tema CYE; PlanTable con "nivel de confianza"
      por fila (feature #1). Verificado: typecheck + lint + build OK; app arranca sin crash, DB+IPC OK.
      PENDIENTE: confirmación VISUAL del usuario con `npm run dev` + key MiniMax en .env para ingesta en vivo.
      DIFERIDO (pulido): streaming fila a fila en Nueva Obra; tabla editable; features #2/#3/#4.
- [x] Fase 4.5 (hito RAG) — pantalla interna "Validación RAG": buscador ensayo→catálogo con
      score por confianza (verde/ámbar/rojo), selector de categoría, banner de estado del motor
      (TF-IDF vs híbrido). IPC rag:status/rag:findMatches. Verificado: typecheck/lint/build OK.
      ⏳ EN CURSO: activar embeddings (MiniMax, pluggable) — requiere la API key para construir el índice.
- [x] Fase 5 — Empaquetado: electron-builder con extraResources (knowledge/templates →
      Contents/Resources para que process.resourcesPath los encuentre). Generado .dmg + .zip
      (x64, ~121 MB). Verificado: .app empaquetado arranca, DB en userData "CYE", better-sqlite3
      nativo carga, recursos colocados. Host Intel x64 → build x64 correcto.
      PENDIENTE distribución profesional: (a) firma + notarización Apple (Developer ID, evita
      Gatekeeper); (b) build Windows .exe (vía CI/GitHub Actions, no desde Mac); (c) universal/arm64
      para clientes Apple Silicon; (d) configurar publish/auto-update (hoy apunta a example.com).
- [x] Fase 6 — Laboratorio (aporte del usuario + revisión): informes de ensayo de campo
      (densidad in situ ASTM D-6938 / placa de carga NLT-357 con cálculo y veredicto), generación
      Word/Excel de informes (informes.ts), tabla del plan EDITABLE con recálculo + guardado en DB
      (updatePlanRows con recalc de KPIs), página Presupuestos (catálogo + editor de reglas), pulido
      UI (Dashboard, Proyectos con stats). Revisión: izado de PlacaTable, setState fuera de effect,
      bug de filas que desaparecían al editar, Ev en vivo con radio real. Motor de cálculo verificado.

---

## 🧭 Roadmap próximo (fundamentado en plataformas CMT/LIMS)

Referencias del sector: Spectra QEST, MetaField, eFieldData, ForneyVault, Aldoa. CYE ya cubre lo que
ellos NO hacen (generación del plan valorado con IA) y, con los ensayos de campo, empieza a entrar en
su terreno (ejecución). Prioridad orientada a: cerrar el ciclo plan→ejecución, requisitos ENAC, y el
objetivo del usuario de mejorar el RAG.

**P1 — RAG híbrido** ✅ HECHO (embeddings LOCALES) · _bucle de aprendizaje pendiente_

- ✅ Embeddings hechos con modelo LOCAL (transformers.js, multilingual-e5-small) en vez de MiniMax:
  la key MiniMax estaba bloqueada por rate limit (RPM) y, además, local es mejor para una app
  offline (sin red, sin coste, sin límites). MiniMax queda enchufable como alternativa.
  Híbrido (emb × TF-IDF) operativo en consulta (Validación RAG) y en la generación del plan (priceMany).
  Medido: corrige "granulometría→proctor" (92€→44€) sin romper aciertos previos. Índice 749/749.
- ⏳ Feature #2 (pendiente): al corregir un precio en la tabla editable, guardar en `price_corrections`
  → alimenta el harness. La app mejora con el uso. (Tabla editable y tabla DB ya existen; falta cablear la captura.)
- ⚠️ Empaquetado: el modelo de embeddings (~100 MB) se cachea en node_modules; para distribuir offline
  hay que bundlear el modelo en resources y apuntar `env.localModelPath`. Sub-tarea de la fase de distribución.
- Posible mejora futura: tunear umbral/peso del híbrido con un set de casos reales (harness rag:eval).

**P2 — Cerrar el ciclo plan ↔ ejecución** _(lo que distingue a un LIMS de un generador)_

- Vincular cada informe de ensayo a una línea del plan (`plan_row_id` en `ensayos`).
- Vista de avance por obra: planificados vs ejecutados, % completado, pendientes. (Dashboard ya
  insinúa "Informes de campo" vs "Planificados".)

**P3 — Requisitos de acreditación ENAC**

- Firma/responsable y estado de aprobación en informes (campos ya en esquema; falta flujo + sello).
- Numeración correlativa de informes/expediente (año/secuencia), trazable.
- Trazabilidad de muestras / cadena de custodia: nueva tabla `muestras` (id, fecha toma, técnico,
  estado) enlazada a ensayos — núcleo LIMS clásico.

**P4 — Inteligencia de producto** _(features diferenciadoras restantes)_

- Feature #4: diff de planes cuando cambia el presupuesto (qué ensayos se añaden/quitan/varían).
- Feature #3: chat sobre el proyecto ("¿por qué este ensayo?" → cita regla + fragmento de memoria).
- Analítica entre proyectos: precios medios, ratios €/m³, histórico (cross-project analytics).

**P5 — Entrega y distribución**

- Exportar/empaquetar entregables al cliente (PDF firmado).
- Distribución profesional (de Fase 5): firma+notarización Apple, build Windows vía CI, auto-update.

**Deuda técnica / pulido** (transversal, no bloquea)

- Tests automatizados (hoy el harness es manual); error-handling/telemetría; backups de la DB.
- Pulido UX diferido: streaming fila a fila en Nueva Obra; OCR de PDFs escaneados (baja prioridad).
