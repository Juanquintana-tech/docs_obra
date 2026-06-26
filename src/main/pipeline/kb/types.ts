/**
 * Tipos de la BBDD curada (branch Cye_BBDD).
 *
 * Fuente de verdad = archivos JSON versionados en `resources/knowledge/curated/`.
 * El SQLite (`kb.sqlite`) es un artefacto derivado y reconstruible con `npm run kb:build`.
 *
 * Ver PLAN_BBDD.md §4 (modelo de datos) e INVENTARIO_FUENTES.md (fuentes).
 */

/** Categoría interna de material/obra (TERRAPLEN_RELLENOS, HORMIGON, …). */
export interface KbCategory {
  code: string
  name: string
  defaultUnit: string | null
  keywords: string[]
}

/** Ensayo canónico: identidad única de una prueba de control de calidad. */
export interface KbTest {
  id: string // T-0001
  canonicalDesc: string
  normCodes: string[] // ["UNE 103501:94", ...]
  /** Sección ALAGAL de origen (metadato jerárquico), p.ej. "ROCAS, SUELOS Y ZAHORRAS". */
  alagalSection: string | null
  /** Código jerárquico ALAGAL (p.ej. "3.2.4."), si proviene del catálogo. */
  alagalCode: string | null
  /** Origen del ensayo en el catálogo: alagal | cye (solo en presupuestos CYE). */
  origin: 'alagal' | 'cye'
}

/** Precio de un ensayo por fuente. Prioridad: tarifa_cye > pricebook > alagal. */
export interface KbPrice {
  testId: string
  source: 'tarifa_cye' | 'pricebook' | 'alagal'
  /** Precio puntual (alagal) o representativo (mediana/reciente para histórico). */
  price: number
  /** Estadística cuando la fuente es histórica (varios presupuestos). */
  min?: number
  max?: number
  n?: number
}

/** Alias: texto libre (de un presupuesto real) → ensayo canónico. Sustituye al fuzzy. */
export interface KbAlias {
  alias: string
  testId: string
  source: string // de qué presupuesto/fuente salió
}

/**
 * Regla de frecuencia normativa derivada de los presupuestos CYE reales.
 * "Para la categoría X, el ensayo T se aplica `muestreo` veces por cada `freqUnit`."
 * Ej.: { categoryCode: TERRAPLEN_RELLENOS, testId: T-0007, muestreo: 1, freqUnit: "10.000 m3" }
 */
export interface KbFrequencyRule {
  categoryCode: string
  testId: string
  muestreo: number // columna MUESTREO (ensayos por lote)
  freqUnit: string // columna UD ("10.000 m3", "Por material", "10 lotes ensayados"…)
  /** Cuántos presupuestos CYE respaldan esta regla (confianza). */
  sources: number
  /** Texto original del ensayo (para trazabilidad/curación). */
  rawDesc: string
}

// ── Proyectos CYE reales (held-out para evaluación) ─────────────────────────

export interface EvalLine {
  seccion: string
  categoryCode: string | null
  descripcion: string
  testId: string | null // canónico si mapea, null si no
  muestreo: number | null
  freqUnit: string | null
  nTests: number
  precioUnitario: number
  importe: number
}

export interface EvalSection {
  category: string | null
  sectionName: string
  quantity: number | null
  unit: string | null
  lines: EvalLine[]
}

export interface EvalProject {
  id: string // E1..E8
  nombre: string
  archivo: string
  formato: 'A' | 'B' // A = con frecuencia (MUESTREO+UD); B = simple
  totalBase: number
  sections: EvalSection[]
}
