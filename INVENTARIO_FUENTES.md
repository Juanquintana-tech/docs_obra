# Inventario de fuentes de conocimiento — BBDD curada

> Análisis de `~/Desktop/Nigal/Proyects/CYE/DOCS/Presupuestos_completo/` + tarifa ALAGAL.
> Fecha: 2026-06-26. Acompaña a [`PLAN_BBDD.md`](PLAN_BBDD.md) (Etapa 1).
> **Regla de oro del usuario:** ningún plan generado por la app es válido como referencia.

---

## 1. La distinción que lo ordena todo

Hay **dos tipos de "presupuesto"** mezclados en la carpeta, y confundirlos es la causa de medio
problema actual:

| Tipo | Qué es | Rol en la BBDD |
|---|---|---|
| **Presupuesto de OBRA / mediciones / totalizados** | Lo que se construye y sus cantidades (m³, t, m²…). Capítulos/partidas de construcción. | **INPUT.** Solo sirve para probar el extractor. NO aporta ensayos/precios/frecuencias. |
| **Presupuesto de ENSAYOS de CYE** (`P-xxxx`, `xxxx P`) | El plan de control valorado que CYE factura: ensayos, frecuencias, precios, por tramo. | **OUTPUT / ORO.** Fuente canónica de frecuencias reales y precios CYE. Set de evaluación. |

Tu intuición era correcta: `G2156C`, `Presupuesto Orbital` y `pres3012` son **presupuestos de obra**
(input), no de ensayos → aportan poco a la curación, solo como entrada de prueba del extractor.

---

## 2. Discriminadores fiables (para el importador automático)

- **App-generado (EXCLUIR):** el libro tiene una hoja llamada **`Plan de Ensaios`** (gallego). Todos los `Plan_*.xlsx` lo son.
- **Presupuesto de ensayos CYE (ORO):** hoja `Hoja1` (u hoja de trabajo) con cabecera de ensayos. Dos formatos:
  - **Formato A (detallado, con frecuencia):** `ENSAYOS | OBSERV. | MUESTREO | UD. | nº | P.UNITARIO | IMPORTE`. Codifica la **frecuencia** (clave). Cabeceras de sección con `N.- NOMBRE | cantidad unidad`. Ej.: E8, E1.
  - **Formato B (simple):** `CONCEPTO Y NORMA DE ENSAYO | Nº ensayos | Precio | Importe`. Sin frecuencia explícita. Ej.: E7 (`0414.26 P`).
- **Presupuesto de obra (INPUT):** cabecera `Código | Ud | Resumen | Medición/CanPres | Precio | Importe`, con capítulos/partidas.

---

## 3. Clasificación de cada fuente

### ✅ MANTENER — catálogo canónico de precios
| Archivo | Contenido | Uso |
|---|---|---|
| `Tarifas ALAGAL Versión 0 28-02-2025.xlsx` (hoja `Versión 0 28-02-2025`) | **749 ensayos** con precio, **17 categorías** jerárquicas, **705 con código de norma** | Semilla de `kb_tests` + `kb_prices` (source=`alagal`) + taxonomía de categorías |
| ~~`TARIFAS ALAGAL V0 28-02-2025.pdf`~~ | Mismo contenido que el xlsx | **Redundante** — usar el xlsx |

### ✅ MANTENER — presupuestos de ensayos CYE (ORO: frecuencias + precios reales + estructura por tramo)
| Ejemplo | Archivo real | Formato | Notas |
|---|---|---|---|
| E1 | `P-1140.25 Rev 2.xls` (511 filas) | A | RIANXO / Stolt Sea Farm |
| E2 | `P-0331.25.xlsx` (34 filas) | A | Pequeño (Ferrol 3ª fase) |
| E3 | `P-0789.25.xls` (477 filas) | A | Obramat Narón |
| E4 | `P-0002.2-23.xlsx` (206 filas) | A | Seranco FE-14 |
| E5 | `P-1339-20 P Rev 3.xlsx` | A | ⚠️ **Archivo de trabajo**: hojas `comprobacion toni`, `BASE`, `14-12-2020`, `35-40%`. Hay que elegir la hoja definitiva. Enlace Orbital. |
| E6 | `0118.24 P.xlsx` (339 filas) | A | Alfonso Molina |
| E7 | `0414.26 P.xls` (44 filas) | B | Marín/Escuela. ⚠️ `pres3012.xlsx` del mismo Ejemplo es **presupuesto de obra (input)**, no CYE. |
| E8 | `P-0618-2018 CYE A54 ARZUA.xlsx` (322 filas) | A | Melide-Arzúa (el de la desviación +13,9% en PLAN.md) |

> E1–E6 ya estaban parseados en `historical_projects.json` (6 proyectos). **E7 y E8 son nuevos.**

### ✅ MANTENER (input) — mediciones/totalizados para probar el extractor (NO para frecuencias/precios)
- 8× `Totalizados/TOTALIZADOS *.xlsx` (uno por ejemplo) — pareados con su presupuesto CYE → set input→output para **evaluación**.
- Sueltos: `G2156C_PRESUPUESTO COMPLETO.xlsx`, `Presupuesto Orbital.xlsx`, `Ejemplo 7/pres3012.xlsx`, `Mediciones.pdf`, `DGC Ferrol_Mediciones.pdf`, `BRI-29 Ferrol_*.xlsx` (×3) — presupuestos de obra/mediciones, solo como **entrada de prueba** del extractor.

### 🟡 MANTENER como referencia de formato (baja prioridad)
- `P-xxx.yy - MODELO PRESUPUESTO.doc`, `P-modelo oferta.doc`, `P-0582-18.doc`, `Plantilla presupuesto y Plan de ensaios.xlsx` — plantillas de la estructura de salida CYE.

### ❌ EXCLUIR
- **Todos los `Plan_*.xlsx`** (~20 archivos, hoja `Plan de Ensaios`) — **generados por la app, no válidos**.
- `tmp_obra/*.ppm` (8 imágenes) — temporales de OCR de la app.

---

## 4. Qué alimenta cada tabla de la BBDD

| Tabla `kb_*` | Fuente primaria | Fuente secundaria |
|---|---|---|
| `kb_categories` | 17 secciones top-level de ALAGAL + categorías de `test_rules.json` | Secciones de los presupuestos CYE |
| `kb_tests` (catálogo canónico) | ALAGAL (749) | Ensayos de los presupuestos CYE no presentes en ALAGAL |
| `kb_test_aliases` | Descripciones reales en presupuestos CYE → ensayo canónico | `test_rules.json`, históricos |
| `kb_prices` | **Presupuestos CYE** (`tarifa_cye`, prioridad 1) | ALAGAL (`alagal`), `price_book.json` |
| `kb_frequency_rules` | **Presupuestos CYE formato A** (MUESTREO + UD por sección) | `test_rules.json` (normativa PG-3/UNE) |
| `kb_section_templates` | Estructura por tramo de los presupuestos CYE | — |
| `kb_hist_projects/lines` | 8 presupuestos CYE + sus totalizados | — (held-out para eval) |

**Prioridad de precio:** `tarifa_cye` (lo que CYE cobra de verdad) > `price_book` > `alagal`.
Es justo el ajuste que faltaba (PLAN.md §104.1: Proctor App 60 € vs CYE 55 €, etc.).

---

## 5. Ambigüedades — RESUELTAS (2026-06-26)

1. **E5 (`P-1339-20 P Rev 3.xlsx`)**: usar la hoja **`BASE`** — es la versión de partida; las demás (`35-40%`…) son descuentos posteriores.
2. **E7**: ✅ `0414.26 P.xls` = presupuesto CYE válido (formato B). `pres3012.xlsx` = presupuesto de obra (solo input).
3. **Cobertura Etapa 1: cerrada con estos 8 presupuestos CYE + ALAGAL.** Se amplía después si hace falta.

---

## 6. Conclusión

- **Catálogo canónico de precios:** ALAGAL (749 ensayos, 17 categorías) → listo para importar.
- **Frecuencias y precios reales de CYE:** 8 presupuestos (6 ya conocidos + E7/E8 nuevos), formato A mayoritario.
- **Evaluación:** 8 pares totalizados↔presupuesto CYE (input→output held-out).
- **Excluido sin ambigüedad:** ~20 planes de la app + temporales OCR.
- **Aporte real de los sueltos** (`G2156C`, `Orbital`, mediciones): solo como entrada de prueba del extractor — confirmada tu intuición.
