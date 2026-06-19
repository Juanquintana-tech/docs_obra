/**
 * Generación de informes de ensayo en Word y Excel con membrete CYE.
 *
 * Todos los informes Word se generan directamente con docx v9 replicando el
 * informe oficial PDF en lugar de convertir el Excel (Excel→Word producía
 * resultados irregulares con estilos y bordes incorrectos).
 */
import { fillDensidadTemplate } from './formatter/densidadExcelTemplate'
import { fillPlacaTemplate } from './formatter/placaExcelTemplate'
import { fillGranulometriaTemplate } from './formatter/granulometriaExcelTemplate'
import { fillTomaHormigonTemplate } from './formatter/tomaHormigonExcelTemplate'
import { fillTomaHormigonWord } from './formatter/tomaHormigonWordTemplate'
import { fillPlacaWord } from './formatter/placaWordTemplate'
import { fillDensidadWord } from './formatter/densidadWordTemplate'
import { fillAlbaranWord } from './formatter/albaranWordTemplate'
import { fillAlbaranPlantaWord } from './formatter/albaranPlantaWordTemplate'
import type { Ensayo, Obra } from '../db'
import {
  type DensidadInput,
  type PlacaInput,
  type GranulometriaInput
} from './ensayos'

// ── API pública ───────────────────────────────────────────────────────────────

export async function generateInformeWord(
  ensayo: Ensayo,
  obra: Obra,
  logoPath: string,
  excelTemplatePath: string,
  placaTemplatePath?: string
): Promise<Buffer> {
  if (ensayo.tipo === 'densidad_in_situ')
    return fillDensidadWord(ensayo, obra, logoPath)
  if (ensayo.tipo === 'placa_carga')
    return fillPlacaWord(ensayo, obra, logoPath)
  if (ensayo.tipo === 'toma_hormigon')
    return fillTomaHormigonWord(ensayo, obra, logoPath, false)
  if (ensayo.tipo === 'informe_hormigon')
    return fillTomaHormigonWord(ensayo, obra, logoPath, true)
  if (ensayo.tipo === 'albaran_ensayos')
    return fillAlbaranWord(ensayo, obra, logoPath)
  if (ensayo.tipo === 'albaran_planta')
    return fillAlbaranPlantaWord(ensayo, obra, logoPath)
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
  if (ensayo.tipo === 'toma_hormigon' || ensayo.tipo === 'informe_hormigon')
    return fillTomaHormigonTemplate(datos, obra)
  throw new Error(`Informe Excel no disponible para tipo: ${ensayo.tipo}`)
}
