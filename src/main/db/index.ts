import { app } from 'electron'
import { join } from 'path'
import Database from 'better-sqlite3'
import { migrate } from './migrations'
import type { PlanRowInput } from '../pipeline/types'
import type { PriceStrategy } from '../pipeline/rag/priceBook'

// La forma de fila que produce el pipeline vive en el contrato del pipeline.
export type { PlanRowInput } from '../pipeline/types'

// ── Tipos del dominio ─────────────────────────────────────────────────────
export interface Obra {
  id: number
  obra: string
  cliente: string
  ref_lab: string
  fecha: string
  coef_baja: number
  total_importe: number
  n_ensayos: number
  n_materiales: number
  responsable: string
  price_strategy: string
  created_at: string
  status: 'activa' | 'archivada'
}

export interface PlanRow {
  id: number
  obra_id: number
  row_type: string
  material: string
  subcategory: string
  description: string
  measurement: number | null
  measurement_unit: string
  freq_qty: number | null
  freq_unit: string
  n_lots: number | null
  tests_per_lot: number | null
  n_tests: number
  unit_price: number
  total: number
  price_source: 'pricebook' | 'alagal' | 'fallback'
  rag_score: number
  rag_desc: string
  price_min: number | null
  price_max: number | null
  price_n: number | null
}

export interface ObraInput {
  obra: string
  cliente?: string
  ref_lab?: string
  fecha?: string
  coef_baja?: number
  responsable?: string
  price_strategy?: PriceStrategy
}

// ── Conexión (singleton) ────────────────────────────────────────────────────
let _db: Database.Database | null = null

export function getDb(): Database.Database {
  if (_db) return _db
  const dbPath = join(app.getPath('userData'), 'cye.db')
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate(db)
  _db = db
  return db
}

export function closeDb(): void {
  if (_db) {
    _db.close()
    _db = null
  }
}

// ── Escritura ────────────────────────────────────────────────────────────────
export function saveObra(info: ObraInput, planRows: PlanRowInput[]): number {
  const db = getDb()
  const testRows = planRows.filter((r) => r.type === 'test')
  const totalImporte = testRows.reduce((s, r) => s + (r.total ?? 0), 0)
  const nEnsayos = testRows.reduce((s, r) => s + (r.n_tests ?? 0), 0)
  const nMateriales = new Set(testRows.map((r) => r.material).filter(Boolean)).size

  const insertObra = db.prepare(
    `INSERT INTO obras (obra, cliente, ref_lab, fecha, coef_baja, total_importe,
                        n_ensayos, n_materiales, responsable, price_strategy)
     VALUES (@obra, @cliente, @ref_lab, @fecha, @coef_baja, @total_importe,
             @n_ensayos, @n_materiales, @responsable, @price_strategy)`
  )
  const insertRow = db.prepare(
    `INSERT INTO plan_rows
       (obra_id, row_type, material, subcategory, description, measurement,
        measurement_unit, freq_qty, freq_unit, n_lots, tests_per_lot, n_tests,
        unit_price, total, price_source, rag_score, rag_desc, price_min, price_max, price_n)
     VALUES
       (@obra_id, @row_type, @material, @subcategory, @description, @measurement,
        @measurement_unit, @freq_qty, @freq_unit, @n_lots, @tests_per_lot, @n_tests,
        @unit_price, @total, @price_source, @rag_score, @rag_desc, @price_min, @price_max, @price_n)`
  )

  const tx = db.transaction(() => {
    const res = insertObra.run({
      obra: info.obra,
      cliente: info.cliente ?? '',
      ref_lab: info.ref_lab ?? '',
      fecha: info.fecha ?? '',
      coef_baja: info.coef_baja ?? 1.0,
      total_importe: totalImporte,
      n_ensayos: nEnsayos,
      n_materiales: nMateriales,
      responsable: info.responsable ?? '',
      price_strategy: info.price_strategy ?? 'mediana'
    })
    const obraId = Number(res.lastInsertRowid)

    let currentMaterial = ''
    for (const row of planRows) {
      if (row.type === 'section') currentMaterial = row.material ?? ''
      insertRow.run({
        obra_id: obraId,
        row_type: row.type ?? null,
        material: row.material || currentMaterial,
        subcategory: row.subcategory ?? '',
        description: row.description ?? '',
        measurement: row.measurement ?? null,
        measurement_unit: row.measurement_unit ?? '',
        freq_qty: row.freq_qty ?? null,
        freq_unit: row.freq_unit ?? '',
        n_lots: row.n_lots ?? null,
        tests_per_lot: row.tests_per_lot ?? null,
        n_tests: row.n_tests ?? 0,
        unit_price: row.unit_price ?? 0,
        total: row.total ?? 0,
        price_source: row.price_source ?? 'fallback',
        rag_score: row.rag_score ?? 0,
        rag_desc: row.rag_desc ?? '',
        price_min: row.price_min ?? null,
        price_max: row.price_max ?? null,
        price_n: row.price_n ?? null
      })
    }
    return obraId
  })
  return tx()
}

export function updateStatus(obraId: number, status: 'activa' | 'archivada'): void {
  getDb().prepare('UPDATE obras SET status=? WHERE id=?').run(status, obraId)
}

export function updateObraInfo(obraId: number, info: ObraInput): void {
  getDb()
    .prepare(
      `UPDATE obras SET obra=@obra, cliente=@cliente, ref_lab=@ref_lab,
       fecha=@fecha, responsable=@responsable WHERE id=@id`
    )
    .run({
      id: obraId,
      obra: info.obra,
      cliente: info.cliente ?? '',
      ref_lab: info.ref_lab ?? '',
      fecha: info.fecha ?? '',
      responsable: info.responsable ?? ''
    })
}

export function deleteObra(obraId: number): void {
  getDb().prepare('DELETE FROM obras WHERE id=?').run(obraId)
}

/** Campos editables de una fila del plan (los que el usuario puede cambiar manualmente). */
export interface PlanRowPatch {
  id: number
  measurement?: number | null
  n_lots?: number | null
  tests_per_lot?: number | null
  n_tests: number
  unit_price: number
  total: number
}

/**
 * Actualiza los campos editables de un conjunto de filas en una sola transacción
 * y recalcula los totales de la obra (total_importe, n_ensayos, n_materiales).
 */
export function updatePlanRows(obraId: number, patches: PlanRowPatch[]): void {
  const db = getDb()
  const updateRow = db.prepare(
    `UPDATE plan_rows
     SET measurement=@measurement, n_lots=@n_lots, tests_per_lot=@tests_per_lot,
         n_tests=@n_tests, unit_price=@unit_price, total=@total
     WHERE id=@id`
  )
  const tx = db.transaction(() => {
    for (const p of patches) {
      updateRow.run({
        id: p.id,
        measurement: p.measurement ?? null,
        n_lots: p.n_lots ?? null,
        tests_per_lot: p.tests_per_lot ?? null,
        n_tests: p.n_tests,
        unit_price: p.unit_price,
        total: p.total
      })
    }
    refreshObraStats(db, obraId)
  })
  tx()
}
/** Recalcula totales de la obra (extrae la lógica común de updatePlanRows y las nuevas funciones). */
function refreshObraStats(db: Database.Database, obraId: number): void {
  const agg = db
    .prepare(
      `SELECT COALESCE(SUM(total),0)   AS total_importe,
              COALESCE(SUM(n_tests),0) AS n_ensayos,
              COUNT(DISTINCT CASE WHEN material!='' THEN material END) AS n_materiales
       FROM plan_rows WHERE obra_id=? AND row_type='test'`
    )
    .get(obraId) as { total_importe: number; n_ensayos: number; n_materiales: number }
  db.prepare(`UPDATE obras SET total_importe=?, n_ensayos=?, n_materiales=? WHERE id=?`).run(
    agg.total_importe, agg.n_ensayos, agg.n_materiales, obraId
  )
}

export function deletePlanRow(rowId: number): void {
  const db = getDb()
  const row = db.prepare('SELECT obra_id FROM plan_rows WHERE id=?').get(rowId) as { obra_id: number } | undefined
  if (!row) return
  db.prepare('DELETE FROM plan_rows WHERE id=?').run(rowId)
  refreshObraStats(db, row.obra_id)
}

export interface NewPlanRowData {
  material?: string
  subcategory?: string
  description?: string
  n_tests?: number
  unit_price?: number
}

export function addPlanRow(obraId: number, data: NewPlanRowData): number {
  const db = getDb()
  const nTests = data.n_tests ?? 0
  const unitPrice = data.unit_price ?? 0
  const result = db
    .prepare(
      `INSERT INTO plan_rows
         (obra_id, row_type, material, subcategory, description,
          measurement, measurement_unit, freq_qty, freq_unit,
          n_lots, tests_per_lot, n_tests, unit_price, total,
          price_source, rag_score, rag_desc)
       VALUES (?, 'test', ?, ?, ?, NULL, '', NULL, '',
               NULL, NULL, ?, ?, ?, 'fallback', 0, '')`
    )
    .run(obraId, data.material ?? '', data.subcategory ?? '', data.description ?? '',
         nTests, unitPrice, Math.round(nTests * unitPrice * 100) / 100)
  refreshObraStats(db, obraId)
  return result.lastInsertRowid as number
}
export interface PlanEdits {
  deletes: number[]
  adds: NewPlanRowData[]
  updates: PlanRowPatch[]
}

/**
 * Aplica borrados, inserciones y actualizaciones del plan en una sola transacción.
 * Si cualquier operación falla, ningún cambio queda guardado en la DB.
 */
export function savePlanEdits(obraId: number, edits: PlanEdits): void {
  const db = getDb()

  const deleteStmt = db.prepare('DELETE FROM plan_rows WHERE id=?')
  const insertStmt = db.prepare(
    `INSERT INTO plan_rows
       (obra_id, row_type, material, subcategory, description,
        measurement, measurement_unit, freq_qty, freq_unit,
        n_lots, tests_per_lot, n_tests, unit_price, total,
        price_source, rag_score, rag_desc)
     VALUES (?, 'test', ?, ?, ?, NULL, '', NULL, '',
             NULL, NULL, ?, ?, ?, 'fallback', 0, '')`
  )
  const updateStmt = db.prepare(
    `UPDATE plan_rows
     SET measurement=@measurement, n_lots=@n_lots, tests_per_lot=@tests_per_lot,
         n_tests=@n_tests, unit_price=@unit_price, total=@total
     WHERE id=@id`
  )

  db.transaction(() => {
    for (const id of edits.deletes) deleteStmt.run(id)

    for (const row of edits.adds) {
      const nTests = row.n_tests ?? 0
      const unitPrice = row.unit_price ?? 0
      insertStmt.run(
        obraId,
        row.material ?? '',
        row.subcategory ?? '',
        row.description ?? '',
        nTests,
        unitPrice,
        Math.round(nTests * unitPrice * 100) / 100
      )
    }

    for (const p of edits.updates) {
      updateStmt.run({
        id: p.id,
        measurement: p.measurement ?? null,
        n_lots: p.n_lots ?? null,
        tests_per_lot: p.tests_per_lot ?? null,
        n_tests: p.n_tests,
        unit_price: p.unit_price,
        total: p.total
      })
    }

    refreshObraStats(db, obraId)
  })()
}

export function getObras(status?: 'activa' | 'archivada'): Obra[] {
  const db = getDb()
  const rows = status
    ? db.prepare('SELECT * FROM obras WHERE status=? ORDER BY created_at DESC').all(status)
    : db.prepare('SELECT * FROM obras ORDER BY created_at DESC').all()
  return rows as Obra[]
}

export function getObra(obraId: number): Obra | undefined {
  return getDb().prepare('SELECT * FROM obras WHERE id=?').get(obraId) as Obra | undefined
}

export function getPlanRows(obraId: number): PlanRow[] {
  return getDb()
    .prepare('SELECT * FROM plan_rows WHERE obra_id=? ORDER BY id')
    .all(obraId) as PlanRow[]
}

export interface GlobalStats {
  n_obras: number
  n_ensayos: number
  importe_total: number
  ultima_fecha: string | null
}

export function getGlobalStats(): GlobalStats {
  return getDb()
    .prepare(
      `SELECT COUNT(*) AS n_obras,
              COALESCE(SUM(n_ensayos),0)     AS n_ensayos,
              COALESCE(SUM(total_importe),0) AS importe_total,
              MAX(created_at)                AS ultima_fecha
       FROM obras WHERE status='activa'`
    )
    .get() as GlobalStats
}

// ── Bucle de aprendizaje del precio ──────────────────────────────────────────
export interface PriceCorrectionInput {
  query: string
  category?: string
  suggested_code?: string
  suggested_price?: number | null
  corrected_code?: string
  corrected_price: number
  obra_id?: number | null
}

export function savePriceCorrection(c: PriceCorrectionInput): number {
  const res = getDb()
    .prepare(
      `INSERT INTO price_corrections
         (query, category, suggested_code, suggested_price, corrected_code,
          corrected_price, obra_id)
       VALUES (@query, @category, @suggested_code, @suggested_price, @corrected_code,
               @corrected_price, @obra_id)`
    )
    .run({
      query: c.query,
      category: c.category ?? '',
      suggested_code: c.suggested_code ?? '',
      suggested_price: c.suggested_price ?? null,
      corrected_code: c.corrected_code ?? '',
      corrected_price: c.corrected_price,
      obra_id: c.obra_id ?? null
    })
  return Number(res.lastInsertRowid)
}

// ── Ensayos (informes de campo) ───────────────────────────────────────────────
export interface Ensayo {
  id: number
  obra_id: number
  tipo: string
  titulo: string
  estado: 'borrador' | 'completado' | 'aprobado'
  veredicto: string
  responsable: string
  /** Referencia correlativa del laboratorio (año/NNNN). P3-ENAC. */
  n_expediente: string
  /** Línea del plan de ensayos a la que se vincula este informe. P2. */
  plan_row_id: number | null
  /** JSON parseado — en DB se almacena como TEXT */
  datos: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface EnsayoInput {
  tipo: string
  titulo: string
  estado: 'borrador' | 'completado' | 'aprobado'
  veredicto: string
  responsable?: string
  n_expediente?: string
  plan_row_id?: number | null
  datos: Record<string, unknown>
}

function parseEnsayo(row: Record<string, unknown>): Ensayo {
  return {
    ...(row as Omit<Ensayo, 'datos'>),
    datos: (() => {
      try {
        return JSON.parse((row.datos as string) || '{}')
      } catch {
        return {}
      }
    })()
  }
}

export function saveEnsayo(obraId: number, input: EnsayoInput): number {
  const res = getDb()
    .prepare(
      `INSERT INTO ensayos
         (obra_id, tipo, titulo, estado, veredicto, responsable,
          n_expediente, plan_row_id, datos)
       VALUES
         (@obra_id, @tipo, @titulo, @estado, @veredicto, @responsable,
          @n_expediente, @plan_row_id, @datos)`
    )
    .run({
      obra_id: obraId,
      tipo: input.tipo,
      titulo: input.titulo,
      estado: input.estado,
      veredicto: input.veredicto,
      responsable: input.responsable ?? '',
      n_expediente: input.n_expediente ?? '',
      plan_row_id: input.plan_row_id ?? null,
      datos: JSON.stringify(input.datos)
    })
  return Number(res.lastInsertRowid)
}

export function updateEnsayo(ensayoId: number, input: EnsayoInput): void {
  getDb()
    .prepare(
      `UPDATE ensayos
       SET titulo=@titulo, estado=@estado, veredicto=@veredicto,
           responsable=@responsable, n_expediente=@n_expediente,
           plan_row_id=@plan_row_id, datos=@datos,
           updated_at=datetime('now','localtime')
       WHERE id=@id`
    )
    .run({
      id: ensayoId,
      titulo: input.titulo,
      estado: input.estado,
      veredicto: input.veredicto,
      responsable: input.responsable ?? '',
      n_expediente: input.n_expediente ?? '',
      plan_row_id: input.plan_row_id ?? null,
      datos: JSON.stringify(input.datos)
    })
}

export function deleteEnsayo(ensayoId: number): void {
  getDb().prepare('DELETE FROM ensayos WHERE id=?').run(ensayoId)
}

export function getEnsayos(obraId: number, tipo?: string): Ensayo[] {
  const db = getDb()
  const rows = tipo
    ? db
        .prepare('SELECT * FROM ensayos WHERE obra_id=? AND tipo=? ORDER BY created_at DESC')
        .all(obraId, tipo)
    : db.prepare('SELECT * FROM ensayos WHERE obra_id=? ORDER BY created_at DESC').all(obraId)
  return (rows as Record<string, unknown>[]).map(parseEnsayo)
}

export function getEnsayo(ensayoId: number): Ensayo | undefined {
  const row = getDb().prepare('SELECT * FROM ensayos WHERE id=?').get(ensayoId) as
    | Record<string, unknown>
    | undefined
  return row ? parseEnsayo(row) : undefined
}

/** Devuelve un mapa obra_id → número de informes registrados. */
export function countEnsayosPorObra(): Record<number, number> {
  const rows = getDb()
    .prepare('SELECT obra_id, COUNT(*) AS n FROM ensayos GROUP BY obra_id')
    .all() as { obra_id: number; n: number }[]
  return Object.fromEntries(rows.map((r) => [r.obra_id, r.n]))
}

// ── P3 — Numeración correlativa de expedientes (ENAC) ──────────────────────

/**
 * Genera el siguiente número de expediente correlativo para el año dado.
 * Formato: AAAA/NNNN (e.g. "2026/0001"). Sólo lee la DB — el caller decide si
 * asignarlo (así no se "consume" un número si el usuario cancela).
 */
export function getNextExpediente(year: number): string {
  const row = getDb()
    .prepare(
      `SELECT n_expediente FROM ensayos
       WHERE n_expediente LIKE ? AND n_expediente != ''
       ORDER BY n_expediente DESC LIMIT 1`
    )
    .get(`${year}/%`) as { n_expediente: string } | undefined

  let seq = 1
  if (row) {
    const parts = row.n_expediente.split('/')
    const n = parseInt(parts[1] ?? '0', 10)
    if (!isNaN(n) && n >= seq) seq = n + 1
  }
  return `${year}/${String(seq).padStart(4, '0')}`
}

// ── P2 — Progreso de ejecución por obra ────────────────────────────────────

/** Fila de progreso: una línea del plan con los informes asociados. */
export interface ProgressRow {
  plan_row_id: number
  material: string
  subcategory: string
  description: string
  n_tests: number
  ensayos_total: number
  ensayos_completados: number
}

/**
 * Devuelve las filas del plan de una obra con el número de informes de campo
 * vinculados (todos y solo los completados/aprobados), para la vista de avance.
 */
export function getProgressRows(obraId: number): ProgressRow[] {
  return getDb()
    .prepare(
      `SELECT
         pr.id           AS plan_row_id,
         pr.material,
         pr.subcategory,
         pr.description,
         pr.n_tests,
         COUNT(e.id)     AS ensayos_total,
         COUNT(CASE WHEN e.estado IN ('completado','aprobado') THEN 1 END) AS ensayos_completados
       FROM plan_rows pr
       LEFT JOIN ensayos e ON e.plan_row_id = pr.id
       WHERE pr.obra_id = ? AND pr.row_type = 'test'
       GROUP BY pr.id
       ORDER BY pr.id`
    )
    .all(obraId) as ProgressRow[]
}
