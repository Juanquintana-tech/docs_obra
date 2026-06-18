/**
 * Genera el Word del plan rellenando la plantilla docxtemplater
 * (resources/templates/plan_plantilla.docx). La plantilla es editable en Word
 * sin tocar código: basta conservar los marcadores.
 */
import { readFileSync } from 'fs'
import { resolve } from 'path'
import PizZip from 'pizzip'
import Docxtemplater from 'docxtemplater'
import type { PlanRowInput } from '../types'
import { IVA_RATE, type ObraInfo } from './types'

export interface TemplateRow {
  descripcion: string
  medida: string
  frecuencia: string
  ud: string
  n_lotes: string
  ens_lote: string
  uds: string
  precio: string
  importe: string
}

export interface WordTemplateData {
  obra: string
  cliente: string
  ref_lab: string
  fecha: string
  responsable: string
  total_sin_iva: string
  iva: string
  total_con_iva: string
  rows: TemplateRow[]
}

const num = (n: number | null | undefined): string =>
  n == null ? '' : n.toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 2 })

const money = (n: number): string =>
  n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const EMPTY_ROW = { medida: '', frecuencia: '', ud: '', n_lotes: '', ens_lote: '', uds: '', precio: '', importe: '' }

/** Transforma plan + obra en los datos planos que espera la plantilla.
 *  Agrupa las filas test por material y subcategoría añadiendo cabeceras de sección. */
export function buildTemplateData(planRows: PlanRowInput[], obra: ObraInfo): WordTemplateData {
  const testRows = planRows.filter((r) => r.type === 'test')
  const total = testRows.reduce((s, r) => s + (r.total ?? 0), 0)

  // Agrupar por material → subcategoría → tests
  const grouped = new Map<string, Map<string, PlanRowInput[]>>()
  for (const r of testRows) {
    const mat = r.material ?? 'OTROS'
    const sub = r.subcategory ?? ''
    if (!grouped.has(mat)) grouped.set(mat, new Map())
    const matMap = grouped.get(mat)!
    if (!matMap.has(sub)) matMap.set(sub, [])
    matMap.get(sub)!.push(r)
  }

  const rows: TemplateRow[] = []
  for (const [mat, subcats] of grouped) {
    // Cabecera de material
    rows.push({ descripcion: mat.toUpperCase(), ...EMPTY_ROW })
    for (const [sub, tests] of subcats) {
      // Subcategoría (si no está vacía)
      if (sub) rows.push({ descripcion: `   ${sub}`, ...EMPTY_ROW })
      for (const r of tests) {
        rows.push({
          descripcion: r.description ?? '',
          medida: num(r.measurement),
          frecuencia: num(r.freq_qty),
          ud: r.measurement_unit ?? '',
          n_lotes: num(r.n_lots),
          ens_lote: num(r.tests_per_lot),
          uds: num(r.n_tests),
          precio: num(r.unit_price),
          importe: num(r.total)
        })
      }
    }
  }

  return {
    obra: obra.obra ?? '',
    cliente: obra.cliente ?? '',
    ref_lab: obra.ref_lab ?? '',
    fecha: obra.fecha ?? '',
    responsable: obra.responsable ?? '',
    total_sin_iva: money(total),
    iva: money(total * (obra.iva_rate ?? IVA_RATE)),
    total_con_iva: money(total * (1 + (obra.iva_rate ?? IVA_RATE))),
    rows
  }
}

const DEFAULT_TEMPLATE = resolve(process.cwd(), 'resources/templates/presupuesto_plantilla.docx')

export function generateWord(
  planRows: PlanRowInput[],
  obra: ObraInfo,
  templatePath: string = DEFAULT_TEMPLATE
): Buffer {
  const content = readFileSync(templatePath, 'binary')
  const zip = new PizZip(content)
  const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true })
  doc.render(buildTemplateData(planRows, obra))
  return doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' })
}
