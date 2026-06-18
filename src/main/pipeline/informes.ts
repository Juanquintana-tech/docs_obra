/**
 * Generación de informes de ensayo en Word y Excel con membrete CYE.
 *
 * Ambos tipos de ensayo (densidad in situ y placa de carga) siguen el mismo flujo:
 *   1. Rellenar la plantilla Excel oficial con los datos del ensayo.
 *   2. Generar la gráfica como PNG (sharp/SVG).
 *   3. Convertir la hoja INF del Excel a un documento Word (infSheetToWord).
 *
 * Esto garantiza que el Excel y el Word sean idénticos en contenido y formato.
 */
import { readFileSync } from 'fs'
import sharp from 'sharp'
import { fillDensidadTemplate } from './formatter/densidadExcelTemplate'
import { fillPlacaTemplate } from './formatter/placaExcelTemplate'
import { fillGranulometriaTemplate } from './formatter/granulometriaExcelTemplate'
import { densidadChartPng } from './formatter/densidadChart'
import { placaChartPng } from './formatter/placaChart'
import { infSheetToWord } from './formatter/infToWord'
import type { Ensayo, Obra } from '../db'
import {
  computeDensidad,
  computePlaca,
  type DensidadInput,
  type PlacaInput,
  type GranulometriaInput
} from './ensayos'

// ══════════════════════════════════════════════════════════════════════════════
// DENSIDAD IN SITU — Word
// ══════════════════════════════════════════════════════════════════════════════

async function densidadWord(
  datos: DensidadInput & Record<string, unknown>,
  obra: Obra,
  logoPath: string,
  excelTemplatePath: string
): Promise<Buffer> {
  // El Word es una réplica fiel de la hoja INF: horneamos el Excel y convertimos
  // su rejilla (valores, estilos, bordes y combinaciones) a una tabla de Word.
  const xlsxBuf = fillDensidadTemplate(datos, obra, excelTemplatePath)
  const chart = await densidadChartPng(computeDensidad(datos))
  const logoBuf = readFileSync(logoPath)
  const meta = await sharp(logoBuf).metadata()
  return infSheetToWord(
    xlsxBuf,
    { data: logoBuf, width: meta.width ?? 620, height: meta.height ?? 120 },
    chart
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// PLACA DE CARGA — Word
// ══════════════════════════════════════════════════════════════════════════════

async function placaWord(
  datos: PlacaInput & Record<string, unknown>,
  obra: Obra,
  logoPath: string,
  excelTemplatePath: string
): Promise<Buffer> {
  // Igual que densidad: horneamos el Excel y convertimos la hoja INF a Word.
  // La gráfica Presión/Asientos se genera como PNG y se embebe.
  const xlsxBuf = fillPlacaTemplate(datos, obra, excelTemplatePath)
  const chart = await placaChartPng(computePlaca(datos as PlacaInput))
  const logoBuf = readFileSync(logoPath)
  const meta = await sharp(logoBuf).metadata()
  return infSheetToWord(
    xlsxBuf,
    { data: logoBuf, width: meta.width ?? 620, height: meta.height ?? 120 },
    chart
  )
}

// ── API pública ───────────────────────────────────────────────────────────────

export async function generateInformeWord(
  ensayo: Ensayo,
  obra: Obra,
  logoPath: string,
  excelTemplatePath: string,
  placaTemplatePath?: string
): Promise<Buffer> {
  const datos = ensayo.datos as Record<string, unknown>
  if (ensayo.tipo === 'densidad_in_situ')
    return densidadWord(
      datos as DensidadInput & Record<string, unknown>,
      obra,
      logoPath,
      excelTemplatePath
    )
  if (ensayo.tipo === 'placa_carga')
    return placaWord(
      datos as PlacaInput & Record<string, unknown>,
      obra,
      logoPath,
      placaTemplatePath ?? excelTemplatePath
    )
  throw new Error(`Tipo de ensayo no soportado: ${ensayo.tipo}`)
}

export async function generateInformeExcel(
  ensayo: Ensayo,
  obra: Obra,
  templatePath: string
): Promise<Buffer> {
  const datos = ensayo.datos as Record<string, unknown>
  if (ensayo.tipo === 'densidad_in_situ')
    return fillDensidadTemplate(
      datos as DensidadInput & Record<string, unknown>,
      obra,
      templatePath
    )
  if (ensayo.tipo === 'placa_carga')
    return fillPlacaTemplate(datos as PlacaInput & Record<string, unknown>, obra, templatePath)
  if (ensayo.tipo === 'granulometria')
    return fillGranulometriaTemplate(
      datos as GranulometriaInput & Record<string, unknown>,
      obra,
      templatePath
    )
  throw new Error(`Informe Excel no disponible para tipo: ${ensayo.tipo}`)
}
