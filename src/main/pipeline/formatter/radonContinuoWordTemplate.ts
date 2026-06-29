/**
 * Genera el informe Word de Radón Continuo (detectores electrónicos SARAD/AlphaGUARD/RAD7)
 * con docx v9. Replica el estilo del informe oficial CYE (mismo membrete y paleta).
 */
import { readFileSync } from 'fs'
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  ImageRun,
  AlignmentType,
  VerticalAlign,
  WidthType,
  BorderStyle,
  ShadingType,
  convertMillimetersToTwip
} from 'docx'
import { computeRadonContinuo, type RadonContinuoInput } from '../ensayos'
import type { Ensayo, Obra } from '../../db'

// ── Paleta CYE ────────────────────────────────────────────────────────────────

const NAVY       = '1B2A4A'
const LIGHT_BLUE = 'D6E4F0'
const AMBER      = 'FEF3C7'
const AMBER_DARK = 'D97706'
const RED_DARK   = 'C0392B'
const GREEN_DARK = '1A7A3E'
const WHITE      = 'FFFFFF'

// ── Geometría ─────────────────────────────────────────────────────────────────

const MARGIN_TW   = convertMillimetersToTwip(15)
const A4_WIDTH_TW = 11906
const CONTENT_TW  = A4_WIDTH_TW - MARGIN_TW * 2

// ── Bordes ────────────────────────────────────────────────────────────────────

const noBorder = {
  top:    { style: BorderStyle.NONE, size: 0, color: 'auto' },
  bottom: { style: BorderStyle.NONE, size: 0, color: 'auto' },
  left:   { style: BorderStyle.NONE, size: 0, color: 'auto' },
  right:  { style: BorderStyle.NONE, size: 0, color: 'auto' }
} as const

const thinBorder = {
  top:    { style: BorderStyle.SINGLE, size: 4, color: 'AAAAAA' },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: 'AAAAAA' },
  left:   { style: BorderStyle.SINGLE, size: 4, color: 'AAAAAA' },
  right:  { style: BorderStyle.SINGLE, size: 4, color: 'AAAAAA' }
} as const

// ── Helpers ───────────────────────────────────────────────────────────────────

function s(v: unknown): string {
  if (v === null || v === undefined) return ''
  return String(v).trim()
}

function fmtDate(v: unknown): string {
  const str = s(v)
  if (!str) return '—'
  const m = str.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (m) return `${m[3]}/${m[2]}/${m[1]}`
  return str
}

function fmtNum(v: unknown, unit = ''): string {
  if (v === null || v === undefined || v === '') return '—'
  return `${v}${unit ? ' ' + unit : ''}`
}

function bold(text: string, size = 20, color?: string): TextRun {
  return new TextRun({ text, bold: true, size, color })
}

function normal(text: string, size = 20, color?: string): TextRun {
  return new TextRun({ text, size, color })
}

function spacer(): Paragraph {
  return new Paragraph({ text: '', spacing: { before: 60, after: 60 } })
}

function sectionTitle(text: string): Paragraph {
  return new Paragraph({
    children: [bold(text, 22, NAVY)],
    spacing: { before: 200, after: 100 },
    border: {
      bottom: { style: BorderStyle.SINGLE, size: 6, color: NAVY }
    }
  })
}

// ── Cabecera membrete ─────────────────────────────────────────────────────────

async function makeHeader(logoPath: string, otNum: string): Promise<Table> {
  let logoImg: Buffer | null = null
  try { logoImg = readFileSync(logoPath) } catch { /* sin logo */ }

  const logoCell = new TableCell({
    width: { size: 3000, type: WidthType.DXA },
    borders: noBorder,
    children: [
      logoImg
        ? new Paragraph({
            children: [new ImageRun({ data: logoImg, transformation: { width: 120, height: 48 }, type: 'jpg' })],
            alignment: AlignmentType.LEFT
          })
        : new Paragraph({ children: [bold('CYE', 28, NAVY)] })
    ]
  })

  const addrCell = new TableCell({
    width: { size: 4600, type: WidthType.DXA },
    borders: noBorder,
    children: [
      new Paragraph({ children: [normal('Polígono de La Gándara. Avda del Mar nº 123', 16)], spacing: { after: 20 } }),
      new Paragraph({ children: [normal('15570 NARÓN (A Coruña)', 16)], spacing: { after: 20 } }),
      new Paragraph({ children: [normal('Tfno: 981 37 11 36  Fax: 981 37 11 04', 16)], spacing: { after: 20 } }),
      new Paragraph({ children: [normal('e-mail: cye@controluestudios.com', 16)] })
    ]
  })

  const titleCell = new TableCell({
    width: { size: 4400, type: WidthType.DXA },
    borders: {
      top: noBorder.top, bottom: noBorder.bottom, right: noBorder.right,
      left: { style: BorderStyle.SINGLE, size: 8, color: NAVY }
    },
    shading: { type: ShadingType.SOLID, color: NAVY, fill: NAVY },
    verticalAlign: VerticalAlign.CENTER,
    children: [
      new Paragraph({ children: [bold('INFORME DE ENSAYO', 24, WHITE)], alignment: AlignmentType.CENTER }),
      new Paragraph({ children: [normal(`ORDEN DE TRABAJO: ${otNum || '—'}`, 18, WHITE)], alignment: AlignmentType.CENTER })
    ]
  })

  return new Table({
    width: { size: CONTENT_TW, type: WidthType.DXA },
    rows: [new TableRow({ children: [logoCell, addrCell, titleCell] })]
  })
}

// ── Tabla genérica label→valor ────────────────────────────────────────────────

function makeKVTable(rows: [string, string][], labelW = 5400): Table {
  return new Table({
    width: { size: CONTENT_TW, type: WidthType.DXA },
    rows: rows.map(([label, value]) =>
      new TableRow({
        children: [
          new TableCell({
            width: { size: labelW, type: WidthType.DXA },
            borders: thinBorder,
            shading: { type: ShadingType.SOLID, color: LIGHT_BLUE, fill: LIGHT_BLUE },
            children: [new Paragraph({ children: [bold(label, 18)], spacing: { before: 40, after: 40 } })]
          }),
          new TableCell({
            width: { size: CONTENT_TW - labelW, type: WidthType.DXA },
            borders: thinBorder,
            children: [new Paragraph({ children: [normal(value || '—', 18)], spacing: { before: 40, after: 40 } })]
          })
        ]
      })
    )
  })
}

// ── Tabla de resultados ───────────────────────────────────────────────────────

function makeResultsTable(input: RadonContinuoInput): Table {
  const veredicto = computeRadonContinuo(input).veredicto
  const excede = veredicto === 'NO CUMPLE'
  const shade = excede ? AMBER : WHITE

  const hdrCell = (text: string, w: number): TableCell =>
    new TableCell({
      width: { size: w, type: WidthType.DXA },
      borders: thinBorder,
      shading: { type: ShadingType.SOLID, color: NAVY, fill: NAVY },
      verticalAlign: VerticalAlign.CENTER,
      children: [new Paragraph({ children: [bold(text, 17, WHITE)], alignment: AlignmentType.CENTER, spacing: { before: 40, after: 40 } })]
    })

  const valCell = (text: string, w: number, highlight = false): TableCell =>
    new TableCell({
      width: { size: w, type: WidthType.DXA },
      borders: thinBorder,
      shading: { type: ShadingType.SOLID, color: highlight ? shade : WHITE, fill: highlight ? shade : WHITE },
      verticalAlign: VerticalAlign.CENTER,
      children: [new Paragraph({
        children: [new TextRun({ text, size: 18, bold: highlight, color: highlight && excede ? AMBER_DARK : undefined })],
        alignment: AlignmentType.CENTER,
        spacing: { before: 40, after: 40 }
      })]
    })

  const COL = Math.floor(CONTENT_TW / 6)

  const uStr = input.u_rac !== null && input.u_rac !== undefined ? `± ${input.u_rac}` : '—'

  return new Table({
    width: { size: CONTENT_TW, type: WidthType.DXA },
    rows: [
      new TableRow({
        tableHeader: true,
        children: [
          hdrCell('RAC media\n(Bq/m³)', COL),
          hdrCell('RAC máx.\n(Bq/m³)', COL),
          hdrCell('RAC mín.\n(Bq/m³)', COL),
          hdrCell('± U k=2\n(Bq/m³)', COL),
          hdrCell('DT\n(Bq/m³)', COL),
          hdrCell('LLD\n(Bq/m³)', COL)
        ]
      }),
      new TableRow({
        children: [
          valCell(fmtNum(input.rac_media), COL, true),
          valCell(fmtNum(input.rac_max), COL),
          valCell(fmtNum(input.rac_min), COL),
          valCell(uStr, COL),
          valCell(fmtNum(input.umbral_decision ?? 10), COL),
          valCell(fmtNum(input.limite_deteccion ?? 20), COL)
        ]
      })
    ]
  })
}

// ── Función principal ─────────────────────────────────────────────────────────

export async function fillRadonContinuoWord(
  ensayo: Ensayo,
  obra: Obra,
  logoPath: string
): Promise<Buffer> {
  const datos = ensayo.datos as Record<string, unknown>
  const input: RadonContinuoInput = datos as RadonContinuoInput
  const result = computeRadonContinuo(input)
  const nivelRef = result.nivel_referencia
  const equipo = input.equipo

  const otNum = s(ensayo.n_expediente ?? obra.ref_lab ?? '')

  const header = await makeHeader(logoPath, otNum)

  // ── Sección 1: Objeto del ensayo ──────────────────────────────────────────

  const equipoTipo = s(equipo?.tipo) || '—'
  const periodoStr = [
    input.fecha_inicio ? `${fmtDate(input.fecha_inicio)}${input.hora_inicio ? ' ' + input.hora_inicio : ''}` : '',
    input.fecha_fin ? `${fmtDate(input.fecha_fin)}${input.hora_fin ? ' ' + input.hora_fin : ''}` : ''
  ].filter(Boolean).join(' — ') || '—'
  const durStr = input.duracion_horas !== null && input.duracion_horas !== undefined
    ? `${input.duracion_horas} horas`
    : '—'

  const objetivoText =
    `Medición de la Concentración de Actividad del Radón en Aire Interior (RAC) mediante ` +
    `UN (1) detector continuo de tipo ${equipoTipo}. ` +
    `Periodo de medición: ${periodoStr}. Duración: ${durStr}.`

  // ── Sección 2: Equipo de medida ───────────────────────────────────────────

  const equipoRows: [string, string][] = [
    ['Tipo de detector', equipoTipo],
    ['Modelo', s(equipo?.modelo) || '—'],
    ['Número de serie', s(equipo?.numero_serie) || '—'],
    ['Nº certificado calibración', s(equipo?.n_certificado) || '—'],
    ['Fecha de calibración', fmtDate(equipo?.fecha_calibracion)],
    ['Factor de calibración C0 (Bq/m³)', fmtNum(equipo?.factor_calibracion)]
  ]

  // ── Sección 3: Localización ───────────────────────────────────────────────

  const locRows: [string, string][] = [
    ['Edificio / Centro de trabajo', s(input.edificio) || s(obra.obra) || '—'],
    ['Planta', s(input.planta) || '—'],
    ['Ubicación', s(input.ubicacion) || '—']
  ]

  // ── Sección 4: Parámetros de la medición ──────────────────────────────────

  const paramsRows: [string, string][] = [
    ['Fecha/hora inicio', input.fecha_inicio ? `${fmtDate(input.fecha_inicio)}${input.hora_inicio ? ' ' + input.hora_inicio : ''}` : '—'],
    ['Fecha/hora fin', input.fecha_fin ? `${fmtDate(input.fecha_fin)}${input.hora_fin ? ' ' + input.hora_fin : ''}` : '—'],
    ['Duración (horas)', fmtNum(input.duracion_horas)],
    ['Intervalo de medida (min)', fmtNum(input.intervalo_min)],
    ['Nº de medidas', fmtNum(input.n_medidas)],
    ['Temperatura media (°C)', fmtNum(input.temperatura_media)],
    ['Humedad relativa media (%)', fmtNum(input.humedad_media)],
    ['Presión media (hPa)', fmtNum(input.presion_media)]
  ]

  // ── Veredicto ─────────────────────────────────────────────────────────────

  const vColor = result.veredicto === 'NO CUMPLE' ? RED_DARK : result.veredicto === 'CUMPLE' ? GREEN_DARK : NAVY
  const vText = result.veredicto
    ? `RESULTADO: ${result.veredicto}${result.rac_media !== null ? ` — RAC media ${result.rac_media} Bq/m³ (nivel de referencia: ${result.nivel_referencia} Bq/m³)` : ''}`
    : 'RESULTADO: Sin datos suficientes'

  const body = [
    header,
    spacer(),

    new Paragraph({
      children: [bold('Solicitante: ', 20), normal(s(obra.cliente) || '—', 20)],
      spacing: { before: 100, after: 60 }
    }),
    new Paragraph({
      children: [normal(s(obra.obra) || '', 18, '555555')],
      spacing: { after: 100 }
    }),

    sectionTitle('1.- OBJETO DEL ENSAYO'),
    new Paragraph({
      children: [bold('MEDICIÓN DE LA CONCENTRACIÓN DE RADÓN EN AIRE INTERIOR MEDIANTE DETECTOR CONTINUO ELECTRÓNICO', 20, NAVY)],
      spacing: { before: 120, after: 100 }
    }),
    new Paragraph({
      children: [bold('Norma / Procedimiento: ', 20), normal(s(input.norma) || 'IS-47 del CSN · ISO 11665-7', 20)],
      spacing: { before: 60, after: 60 }
    }),
    new Paragraph({
      children: [normal(objetivoText, 20)],
      spacing: { before: 60, after: 100 }
    }),

    sectionTitle('2.- EQUIPO DE MEDIDA'),
    makeKVTable(equipoRows),
    spacer(),

    sectionTitle('3.- LOCALIZACIÓN'),
    makeKVTable(locRows),
    spacer(),

    sectionTitle('4.- PARÁMETROS DE LA MEDICIÓN'),
    makeKVTable(paramsRows),
    spacer(),

    sectionTitle('5.- RESULTADOS'),
    makeResultsTable(input),
    spacer(),

    new Paragraph({
      children: [
        normal(
          'La incertidumbre expandida al resultado obtenido para k=2 representa un valor de confianza aproximado del 95% para una distribución normal.',
          17, '555555'
        )
      ],
      spacing: { before: 100, after: 100 }
    }),

    sectionTitle('6.- NORMATIVA'),
    new Paragraph({
      children: [
        bold('ESPECIFICACIONES: ', 20),
        normal(
          `El Art. 72 del R.D. 1029/2022 establece un nivel de referencia para el promedio anual de concentración de radón en aire en recintos cerrados de `,
          20
        ),
        bold(`${nivelRef} Bq/m³`, 20, RED_DARK),
        normal(
          `, tanto para viviendas o edificios de acceso público como para los lugares de trabajo.`,
          20
        )
      ],
      spacing: { before: 80, after: 80 },
      border: {
        left: { style: BorderStyle.SINGLE, size: 12, color: RED_DARK }
      },
      indent: { left: convertMillimetersToTwip(4) }
    }),
    spacer(),

    sectionTitle('7.- VEREDICTO'),
    new Paragraph({
      children: [bold(vText, 22, vColor)],
      spacing: { before: 120, after: 120 },
      border: {
        top:    { style: BorderStyle.SINGLE, size: 12, color: vColor },
        bottom: { style: BorderStyle.SINGLE, size: 12, color: vColor },
        left:   { style: BorderStyle.SINGLE, size: 24, color: vColor },
        right:  { style: BorderStyle.SINGLE, size: 12, color: vColor }
      },
      indent: { left: convertMillimetersToTwip(4), right: convertMillimetersToTwip(4) }
    }),

    spacer(),
    new Paragraph({
      children: [normal(`Narón (A Coruña), ${new Date().toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}`, 18)],
      spacing: { before: 200 }
    }),
    new Paragraph({
      children: [bold('EL DIRECTOR TÉCNICO DEL LABORATORIO', 18)],
      spacing: { before: 60 }
    }),
    new Paragraph({
      children: [normal(s(ensayo.responsable) || '—', 18)],
      spacing: { before: 60 }
    })
  ]

  if (input.observaciones) {
    body.push(spacer())
    body.push(new Paragraph({
      children: [bold('Observaciones: ', 18), normal(input.observaciones, 18, '555555')],
      spacing: { before: 80, after: 80 }
    }))
  }

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: MARGIN_TW, bottom: MARGIN_TW,
              left: MARGIN_TW, right: MARGIN_TW
            }
          }
        },
        children: body
      }
    ]
  })

  return Packer.toBuffer(doc)
}
