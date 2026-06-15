/**
 * Contrato de tipos del pipeline. Vive aquí (no en la capa de DB ni en Electron)
 * para que el pipeline sea puro y testeable de forma aislada con tsx/Node.
 * La capa de DB importa estos tipos, no al revés.
 */

/** Material clasificado (salida del classifier, entrada del planner). */
export interface Material {
  material?: string
  category?: string
  quantity?: number | null
  unit?: string
  description?: string
  notes?: string
}

/** Fila del plan tal como la emite el planner, antes de persistir. */
export interface PlanRowInput {
  type?: string
  material?: string
  subcategory?: string
  description?: string
  measurement?: number | null
  measurement_unit?: string
  freq_qty?: number | null
  freq_unit?: string
  n_lots?: number | null
  tests_per_lot?: number | null
  n_tests?: number
  unit_price?: number
  total?: number
  price_source?: string
  rag_score?: number
  rag_desc?: string
}
