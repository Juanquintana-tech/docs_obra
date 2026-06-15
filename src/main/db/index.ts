import { app } from 'electron'
import { join } from 'path'
import Database from 'better-sqlite3'
import { migrate } from './migrations'
import type { PlanRowInput } from '../pipeline/types'

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
  price_source: 'alagal' | 'fallback'
  rag_score: number
  rag_desc: string
}

export interface ObraInput {
  obra: string
  cliente?: string
  ref_lab?: string
  fecha?: string
  coef_baja?: number
  responsable?: string
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
                        n_ensayos, n_materiales, responsable)
     VALUES (@obra, @cliente, @ref_lab, @fecha, @coef_baja, @total_importe,
             @n_ensayos, @n_materiales, @responsable)`
  )
  const insertRow = db.prepare(
    `INSERT INTO plan_rows
       (obra_id, row_type, material, subcategory, description, measurement,
        measurement_unit, freq_qty, freq_unit, n_lots, tests_per_lot, n_tests,
        unit_price, total, price_source, rag_score, rag_desc)
     VALUES
       (@obra_id, @row_type, @material, @subcategory, @description, @measurement,
        @measurement_unit, @freq_qty, @freq_unit, @n_lots, @tests_per_lot, @n_tests,
        @unit_price, @total, @price_source, @rag_score, @rag_desc)`
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
      responsable: info.responsable ?? ''
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
        rag_desc: row.rag_desc ?? ''
      })
    }
    return obraId
  })
  return tx()
}

export function updateStatus(obraId: number, status: 'activa' | 'archivada'): void {
  getDb().prepare('UPDATE obras SET status=? WHERE id=?').run(status, obraId)
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
    // Recalcular stats de la obra a partir de las filas actualizadas
    const agg = db
      .prepare(
        `SELECT COALESCE(SUM(total),0)   AS total_importe,
                COALESCE(SUM(n_tests),0) AS n_ensayos,
                COUNT(DISTINCT CASE WHEN material!='' THEN material END) AS n_materiales
         FROM plan_rows WHERE obra_id=? AND row_type='test'`
      )
      .get(obraId) as { total_importe: number; n_ensayos: number; n_materiales: number }
    db.prepare(
      `UPDATE obras SET total_importe=?, n_ensayos=?, n_materiales=? WHERE id=?`
    ).run(agg.total_importe, agg.n_ensayos, agg.n_materiales, obraId)
  })
  tx()
}

// ── Lectura ────────────────────────────────────────────────────────────────
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
  estado: 'borrador' | 'completado'
  veredicto: string
  responsable: string
  /** JSON parseado — en DB se almacena como TEXT */
  datos: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface EnsayoInput {
  tipo: string
  titulo: string
  estado: 'borrador' | 'completado'
  veredicto: string
  responsable?: string
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
      `INSERT INTO ensayos (obra_id, tipo, titulo, estado, veredicto, responsable, datos)
       VALUES (@obra_id, @tipo, @titulo, @estado, @veredicto, @responsable, @datos)`
    )
    .run({
      obra_id: obraId,
      tipo: input.tipo,
      titulo: input.titulo,
      estado: input.estado,
      veredicto: input.veredicto,
      responsable: input.responsable ?? '',
      datos: JSON.stringify(input.datos)
    })
  return Number(res.lastInsertRowid)
}

export function updateEnsayo(ensayoId: number, input: EnsayoInput): void {
  getDb()
    .prepare(
      `UPDATE ensayos
       SET titulo=@titulo, estado=@estado, veredicto=@veredicto,
           responsable=@responsable, datos=@datos,
           updated_at=datetime('now','localtime')
       WHERE id=@id`
    )
    .run({
      id: ensayoId,
      titulo: input.titulo,
      estado: input.estado,
      veredicto: input.veredicto,
      responsable: input.responsable ?? '',
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
    : db
        .prepare('SELECT * FROM ensayos WHERE obra_id=? ORDER BY created_at DESC')
        .all(obraId)
  return (rows as Record<string, unknown>[]).map(parseEnsayo)
}

export function getEnsayo(ensayoId: number): Ensayo | undefined {
  const row = getDb()
    .prepare('SELECT * FROM ensayos WHERE id=?')
    .get(ensayoId) as Record<string, unknown> | undefined
  return row ? parseEnsayo(row) : undefined
}

/** Devuelve un mapa obra_id → número de informes registrados. */
export function countEnsayosPorObra(): Record<number, number> {
  const rows = getDb()
    .prepare('SELECT obra_id, COUNT(*) AS n FROM ensayos GROUP BY obra_id')
    .all() as { obra_id: number; n: number }[]
  return Object.fromEntries(rows.map((r) => [r.obra_id, r.n]))
}
