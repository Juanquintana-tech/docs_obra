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

export interface WordTemplateData {
  obra: string
  cliente: string
  ref_lab: string
  fecha: string
  responsable: string
  total_sin_iva: string
  iva: string
  total_con_iva: string
  rows: Array<{
    descripcion: string
    medida: string
    frecuencia: string
    ud: string
    n_lotes: string
    ens_lote: string
    uds: string
    precio: string
    importe: string
  }>
}

const num = (n: number | null | undefined): string =>
  n == null ? '' : n.toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 2 })

const money = (n: number): string =>
  n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Transforma plan + obra en los datos planos que espera la plantilla. */
export function buildTemplateData(planRows: PlanRowInput[], obra: ObraInfo): WordTemplateData {
  const testRows = planRows.filter((r) => r.type === 'test')
  const total = testRows.reduce((s, r) => s + (r.total ?? 0), 0)
  return {
    obra: obra.obra ?? '',
    cliente: obra.cliente ?? '',
    ref_lab: obra.ref_lab ?? '',
    fecha: obra.fecha ?? '',
    responsable: obra.responsable ?? '',
    total_sin_iva: money(total),
    iva: money(total * IVA_RATE),
    total_con_iva: money(total * (1 + IVA_RATE)),
    rows: testRows.map((r) => ({
      descripcion: r.description ?? '',
      medida: num(r.measurement),
      frecuencia: num(r.freq_qty),
      ud: r.measurement_unit ?? '',
      n_lotes: num(r.n_lots),
      ens_lote: num(r.tests_per_lot),
      uds: num(r.n_tests),
      precio: num(r.unit_price),
      importe: num(r.total)
    }))
  }
}

const DEFAULT_TEMPLATE = resolve(process.cwd(), 'resources/templates/plan_plantilla.docx')

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
