# Frecuencias de ensayo según normativa — referencia verificada

> Investigación 2026-06-26 (deep-research, verificación adversarial 3-0 contra texto BOE literal).
> Fuentes primarias: PG-3 (Órdenes FOM/1382/2002 y FOM/2523/2014), BOE.
> **Esta es la AUTORIDAD de las frecuencias.** Los presupuestos de CYE solo calibran el PRECIO.
> Acompaña a [`PLAN_BBDD.md`](PLAN_BBDD.md). Categorías pendientes al final.

---

## 0. Corrección fundamental (invalida el modelo previo "por volumen")

El umbral **5.000 / 10.000 NO es volumen (m³) por ensayo** ni depende del volumen total de obra.
Son **SUPERFICIES (m²) del lote**, y el conmutador es la **ALTURA del terraplén**:

| Zona | Superficie de lote |
|---|---|
| Coronación | 3.500 m² |
| Terraplén < 5 m altura | 5.000 m² |
| Terraplén ≥ 5 m altura | 10.000 m² |

> El modelo `VOLUME_THRESHOLD = 500.000 m³` implementado antes en `engine.ts` queda **superado**:
> partía de una correlación espuria (obras grandes → terraplenes más altos → parecía volumen).

---

## 1. Dos tipos de control con BASES DE FRECUENCIA DISTINTAS

Clave para el modelo de datos: cada ensayo pertenece a uno de dos controles:

- **Control de FABRICACIÓN / material** → frecuencia por **VOLUMEN (m³)** producido, en escalones.
- **Control de RECEPCIÓN / EJECUCIÓN (unidad terminada)** → frecuencia por **LOTE**, donde el
  lote es el **MENOR** de varios criterios aplicados a **UNA SOLA TONGADA/CAPA**:
  - una longitud (p. ej. 500 m de calzada),
  - una superficie (m², dependiente de zona/altura),
  - la fracción construida **diariamente**,
  - la fracción con mismo material/procedencia/equipo/procedimiento.

El nº de ensayos de obra = **nº de lotes × batería fija por lote**. El nº de lotes depende de
superficie, longitud y tongadas — **no del volumen**. Por eso los presupuestos miden en m² y "por tongada".

---

## 2. TERRAPLENES Y RELLENOS — PG-3 Art. 330 / 332 (FOM/1382/2002) ✅

**Lote (recepción)** = el menor de, sobre **una sola tongada**:
500 m de calzada · superficie (3.500 coronación / 5.000 si <5 m / 10.000 si ≥5 m) · fracción diaria · mismo material/préstamo/equipo.

**Batería por lote (cláusula 330.6.5.3 b):**
- **5 puntos** aleatorios de superficie → humedad y densidad in situ en cada uno.
- **1 punto por cada 100 m** (o fracción) en cada banda de borde → humedad y densidad (independiente).
- **Coronación:** 1 ensayo de carga con placa (NLT 357) por lote (obligatorio).
- **Resto de zonas:** placa por lote o ensayo alternativo correlacionado (huella), verificado **al menos cada 5 lotes**.

**Pendiente:** frecuencia de los ensayos de IDENTIFICACIÓN del material (granulometría, Atterberg,
Proctor, CBR, materia orgánica, sales, yesos) por procedencia/préstamo — no desglosada en esta tanda.

---

## 3. ZAHORRAS ARTIFICIALES — PG-3 Art. 510 (FOM/2523/2014 vigente) ✅

### 3a. Control de FABRICACIÓN (por volumen, escalonado) — 510.9.2.1
| Cada… (o periodo) | Ensayos |
|---|---|
| **1.000 m³** (o diario, mín. 2 muestras mañana/tarde) | granulometría UNE-EN 933-1 · humedad natural UNE-EN 1097-5 |
| **5.000 m³** (o semanal) | Proctor modificado UNE-EN 13286-2 · equivalente de arena UNE-EN 933-8 (o azul de metileno 933-9) · LL e IP (UNE 103103/103104) si procede · finos del árido grueso 933-1 |
| **20.000 m³** (o mensual) | índice de lajas 933-3 · caras de fractura 933-5 · Los Ángeles UNE-EN 1097-2 · azufre total UNE-EN 1744-1 |

> El Director puede **reducir la frecuencia a la mitad** si el material es homogéneo o tras 10 lotes aprobados.
> ⚠ Cambio de versión: el equivalente de arena estaba en el tramo de 1.000 m³ en FOM/891/2004 → **5.000 m³** en la vigente FOM/2523/2014.

### 3b. Control de RECEPCIÓN (unidad terminada) — 510.9.3
**Lote** = el menor de: 500 m de calzada · 3.500 m² de calzada · fracción diaria.
**Por lote:** ≥ **7** determinaciones de humedad y densidad in situ (≥1 por hectómetro) + **1** ensayo de carga con placa de 300 mm (UNE 103808).

---

## 4. SUELOS ESTABILIZADOS in situ (cal/cemento) — PG-3 Art. 512 (FOM/2523/2014) ✅

**Lote (recepción)** = el menor de, sobre una sola capa:
500 m calzada · 3.500 m² (explanada/coronación) · 5.000 m² (relleno <5 m) / 10.000 m² (≥5 m) · fracción diaria · mismo material/equipo.
**Por lote:** ≥ **7** humedad+densidad in situ + **1** carga con placa estática (UNE 103808) en capa superior de explanada/cimiento/coronación.

**Control de EJECUCIÓN por probetas:** por lote, ≥ **2 amasadas** (mañana/tarde) × ≥ **3 probetas** →
CBR a 7 d (UNE 103502) para S-EST1/S-EST2, o compresión simple a 7 d (UNE-EN 13286-41) para S-EST3.

> ⚠ **Refutado / no usar:** "Proctor de la mezcla cada 10.000 m³ o semanal" — fue refutado (1-2), reverificar contra 512.9.2 antes de integrar.

---

## 5. MEZCLAS BITUMINOSAS EN CALIENTE — PG-3 Art. 542 (FOM/2523/2014) ✅ (recepción)

**Lote (recepción, 542.9.4)** = el menor de, sobre una sola capa: 500 m calzada · 3.500 m² calzada · fracción diaria.
**Por lote:** ≥ **3 testigos** en puntos aleatorios → densidad aparente y espesor (UNE-EN 12697-6).
Además (542.9.3) **≥1 vez/lote**: 1 juego de **3 probetas** → contenido de huecos (12697-8) + densidad aparente (12697-6).

> **Pendiente:** control de FABRICACIÓN (contenido de ligante 12697-1 y granulometría de áridos
> recuperados 12697-2) — frecuencia por **toneladas** según tabla 542.16 por categoría de tráfico y
> nivel de conformidad. La tabla concreta quedó **sin verificar** (claim refutado 1-2).

---

## 6. Versiones normativas vigentes (etiquetar cada regla con su origen)

- **Terraplenes (330) y rellenos localizados (332):** Orden **FOM/1382/2002**.
- **Zahorras (510), suelos estabilizados (512), riegos (530/531/532), mezclas bituminosas (542/543):**
  incorporados por FOM/891/2004, **actualizados y vigentes por Orden FOM/2523/2014** (BOE-A-2015-48).
- **Usar SIEMPRE la frecuencia de FOM/2523/2014**, no la de 2004 (difieren, p. ej. equivalente de arena).

---

## 7. Pendiente (2ª tanda de investigación)

No verificadas en esta ronda — necesarias para completar la BBDD:
- **HORMIGÓN estructural** — EHE-08 / Código Estructural (RD 470/2021): definición de lote, nº de amasadas, probetas a compresión, control estadístico, cono de Abrams.
- **ACERO** armaduras/estructural — lotes y ensayos (tracción, doblado, geometría).
- **ESCOLLERAS** — PG-3 Art. 658.
- **RIEGOS** de imprimación (Art. 530) y adherencia (Art. 531) — control de dotación.
- **MARCAS VIALES** — PG-3 Art. 700.
- **MEZCLAS BITUMINOSAS — fabricación** (tabla 542.16 t/ensayo por tráfico).
- **TERRAPLENES — identificación del material** (frecuencia por préstamo/procedencia).

---

## 8. Implicación para el motor (decisión pendiente con el usuario)

El motor determinista debe pasar de "ensayos por volumen" a un **modelo por lote de dos vías**:
1. **Fabricación:** nº ensayos = `ceil(volumen / escalón_m³)` por escalón (1.000/5.000/20.000…).
2. **Recepción/ejecución:** nº lotes = `min(superficie/sup_lote, longitud/500, días)`; nº ensayos = nº lotes × batería fija.

Esto requiere que el **extractor (Etapa 3)** aporte por tramo: **superficie (m²), longitud (m),
nº de tongadas/altura y volumen (m³)** — no solo el volumen. Es el cambio estructural que desbloquea
la paridad real con los presupuestos de CYE.
