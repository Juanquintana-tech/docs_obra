/**
 * Genera el informe Word de Concentración de Radón en Aire Interior (ISO 11665-4)
 * con docx v9. Replica el informe oficial CYE (OT 26/0018 / PE-CYE-39):
 *   · Cabecera membrete (logo + dirección + INFORME DE ENSAYO + nº OT)
 *   · Solicitante
 *   · Sección 1: Objeto del ensayo (norma, referencia, nº detectores, instalación, exposición)
 *   · Sección 2: Resultados obtenidos (tabla por detector con RAC e incertidumbre)
 *   · Bloque de especificaciones (Art. 72 RD 1029/2022, 300 Bq/m³)
 */
import { readFileSync, existsSync } from 'fs'
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
import { computeRadon, type RadonInput, type RadonDetector } from '../ensayos'
import type { Ensayo, Obra } from '../../db'

// ── Paleta CYE ────────────────────────────────────────────────────────────────

const NAVY      = '1B2A4A'
const LIGHT_BLUE = 'D6E4F0'
const AMBER     = 'FEF3C7'
const AMBER_DARK = 'D97706'
const RED_DARK  = 'C0392B'
const GREEN_DARK = '1A7A3E'
const WHITE     = 'FFFFFF'
const GREY_BG   = 'F1F5F9'

// ── Geometría ─────────────────────────────────────────────────────────────────

const MARGIN_TW  = convertMillimetersToTwip(15)
const A4_WIDTH_TW = 11906
const CONTENT_TW = A4_WIDTH_TW - MARGIN_TW * 2

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
  // ISO date → dd/mm/aaaa
  const m = str.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (m) return `${m[3]}/${m[2]}/${m[1]}`
  return str
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

function fieldRow(label: string, value: string): Paragraph {
  return new Paragraph({
    children: [
      bold(`${label}: `, 20),
      normal(value || '—', 20)
    ],
    spacing: { before: 60, after: 60 }
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

// ── Tabla de resultados ───────────────────────────────────────────────────────

function racDisplay(d: RadonDetector): string {
  if (d.extraviado) return 'DETECTOR EXTRAVIADO'
  if (d.saturado) return '>1.000'
  if (d.rac === null || d.rac === undefined) return '—'
  return String(d.rac)
}

function expDisplay(d: RadonDetector): string {
  if (d.extraviado || d.saturado) return '—'
  if (d.exposicion === null || d.exposicion === undefined) return '—'
  return String(d.exposicion)
}

function uRacDisplay(d: RadonDetector): string {
  if (d.extraviado || d.saturado) return '—'
  if (d.u_rac === null || d.u_rac === undefined) return '—'
  return `± ${d.u_rac}`
}

function makeResultsTable(detectores: RadonDetector[], nivelRef: number): Table {
  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      makeHdrCell('Nº', 600),
      makeHdrCell('Código', 1000),
      makeHdrCell('Ubicación del detector', 4000),
      makeHdrCell('Exposición\n(kBq·h/m²)', 1200),
      makeHdrCell('Incertidumbre\nexp. k=2', 1000),
      makeHdrCell('Concentración\nmedia (Bq/m³)', 1300),
      makeHdrCell('Incert.\nRAC k=2', 900)
    ]
  })

  const dataRows = detectores.map((d) => {
    const excede = !d.extraviado && !d.saturado && d.rac !== null && Number(d.rac) > nivelRef
    const saturado = !d.extraviado && d.saturado
    const extraviado = Boolean(d.extraviado)
    const shade = extraviado ? GREY_BG : saturado ? AMBER : excede ? AMBER : WHITE

    const cell = (text: string, w: number, isRac = false): TableCell =>
      new TableCell({
        width: { size: w, type: WidthType.DXA },
        borders: thinBorder,
        shading: { type: ShadingType.SOLID, color: shade, fill: shade },
        verticalAlign: VerticalAlign.CENTER,
        children: [
          new Paragraph({
            children: [
              new TextRun({
                text,
                size: 18,
                bold: isRac && !extraviado,
                color: excede || saturado ? AMBER_DARK : undefined
              })
            ],
            alignment: AlignmentType.CENTER
          })
        ]
      })

    return new TableRow({
      children: [
        cell(String(d.n), 600),
        cell(s(d.codigo), 1000),
        new TableCell({
          width: { size: 4000, type: WidthType.DXA },
          borders: thinBorder,
          shading: { type: ShadingType.SOLID, color: shade, fill: shade },
          children: [
            new Paragraph({
              children: [normal([s(d.edificio), s(d.planta), s(d.ubicacion)].filter(Boolean).join(' · '), 17)],
              spacing: { before: 40, after: 40 }
            })
          ]
        }),
        cell(expDisplay(d), 1200),
        cell(d.extraviado ? '—' : d.u_exposicion ? `± ${d.u_exposicion}` : '—', 1000),
        cell(racDisplay(d), 1300, true),
        cell(uRacDisplay(d), 900)
      ]
    })
  })

  return new Table({
    width: { size: CONTENT_TW, type: WidthType.DXA },
    rows: [headerRow, ...dataRows]
  })
}

function makeHdrCell(text: string, w: number): TableCell {
  return new TableCell({
    width: { size: w, type: WidthType.DXA },
    borders: thinBorder,
    shading: { type: ShadingType.SOLID, color: NAVY, fill: NAVY },
    verticalAlign: VerticalAlign.CENTER,
    children: [
      new Paragraph({
        children: [bold(text, 17, WHITE)],
        alignment: AlignmentType.CENTER,
        spacing: { before: 40, after: 40 }
      })
    ]
  })
}

// ── Tabla de metadatos (fechas, parámetros) ───────────────────────────────────

function makeMetaTable(input: RadonInput): Table {
  const m = input.metadata ?? {}
  const durStr = (() => {
    if (m.duracion_dias) return `${m.duracion_dias} días`
    if (m.fecha_inicio && m.fecha_fin) {
      const d1 = new Date(String(m.fecha_inicio))
      const d2 = new Date(String(m.fecha_fin))
      const diff = Math.round((d2.getTime() - d1.getTime()) / 86400000)
      return isNaN(diff) ? '—' : `${diff} días`
    }
    return '—'
  })()

  const rows: [string, string][] = [
    ['Fecha inicio exposición', fmtDate(m.fecha_inicio)],
    ['Fecha fin exposición', fmtDate(m.fecha_fin)],
    ['Duración', durStr],
    ['Error inducido por el equipo (según Fabricante)', `${m.error_fabricante_pct ?? 7} %`],
    ['Umbral de decisión', `${m.umbral_decision ?? 3} Bq/m³`],
    ['Límite de detección', `${m.limite_deteccion ?? 7} Bq/m³`],
    ['Fechas de procesado y lectura en microscopio', [fmtDate(m.fecha_procesado_inicio), fmtDate(m.fecha_procesado_fin)].filter((x) => x !== '—').join(' — ') || '—']
  ]

  return new Table({
    width: { size: CONTENT_TW, type: WidthType.DXA },
    rows: rows.map(([label, value]) =>
      new TableRow({
        children: [
          new TableCell({
            width: { size: 5400, type: WidthType.DXA },
            borders: thinBorder,
            shading: { type: ShadingType.SOLID, color: LIGHT_BLUE, fill: LIGHT_BLUE },
            children: [new Paragraph({ children: [bold(label, 18)], spacing: { before: 40, after: 40 } })]
          }),
          new TableCell({
            width: { size: CONTENT_TW - 5400, type: WidthType.DXA },
            borders: thinBorder,
            children: [new Paragraph({ children: [normal(value, 18)], spacing: { before: 40, after: 40 } })]
          })
        ]
      })
    )
  })
}

// ── Función principal ─────────────────────────────────────────────────────────

export async function fillRadonWord(
  ensayo: Ensayo,
  obra: Obra,
  logoPath: string
): Promise<Buffer> {
  const datos = ensayo.datos as Record<string, unknown>
  const input: RadonInput = {
    metadata: (datos.metadata as RadonInput['metadata']) ?? {},
    lotes: (datos.lotes as RadonInput['lotes']) ?? [],
    detectores: (datos.detectores as RadonDetector[]) ?? []
  }
  const result = computeRadon(input)
  const m = input.metadata ?? {}
  const detectores = input.detectores ?? []
  const nivelRef = m.nivel_referencia ?? 300

  const otNum = s(ensayo.n_expediente ?? obra.ref_lab ?? '')

  // Descripción nº detectores
  const nDets = detectores.length
  const nDetText = nDets === 1 ? 'UN (1) detector' : `${nDets} detectores`
  const edificiosList = [...new Set(detectores.map((d) => s(d.edificio)).filter(Boolean))].join(', ')

  const header = await makeHeader(logoPath, otNum)

  // ── Página 1: Objeto del ensayo ───────────────────────────────────────────

  const p1Body = [
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
      children: [bold('INSTALACIÓN DE DETECTORES Y POSTERIOR MEDIDA DE LA CONCENTRACIÓN DE RADÓN EN AIRE INTERIOR', 20, NAVY)],
      spacing: { before: 120, after: 100 }
    }),

    new Paragraph({
      children: [bold('Norma / Procedimiento de ensayo: ', 20), normal(s(m.norma) || 'IS-47 del CSN · PE-CYE-39 (ISO 11665-4)', 20)],
      spacing: { before: 60, after: 60 }
    }),

    fieldRow('Referencia de obra', s(obra.ref_lab) || s(ensayo.titulo) || '—'),

    new Paragraph({
      children: [
        bold('Número de detectores: ', 20),
        normal(`${nDetText} de trazas tipo CR-39/GJ en el Centro de Trabajo: ${edificiosList || s(obra.obra) || '—'}`, 20)
      ],
      spacing: { before: 60, after: 60 }
    }),

    fieldRow('Instalación', m.instalacion_cye ? 'La instalación de los equipos fue realizada por CYE CONTROL Y ESTUDIOS' : 'Instalación por el cliente'),

    fieldRow(
      'Exposición de detectores',
      [
        m.fecha_inicio ? `Entre el ${fmtDate(m.fecha_inicio)}` : '',
        m.fecha_fin ? `y el ${fmtDate(m.fecha_fin)}` : '',
        m.duracion_dias ? `(${m.duracion_dias} días)` : ''
      ].filter(Boolean).join(' ') || '—'
    ),

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

  // ── Página 2+: Resultados ─────────────────────────────────────────────────

  const p2Body = [
    header,
    spacer(),

    sectionTitle('2.- RESULTADOS OBTENIDOS'),

    makeMetaTable(input),
    spacer(),

    makeResultsTable(detectores, nivelRef),
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

    new Paragraph({
      children: [
        bold(
          result.n_exceden > 0
            ? `RESULTADO: ${result.n_exceden} detector(es) superan el nivel de referencia de ${nivelRef} Bq/m³. Se recomienda adoptar medidas correctoras.`
            : `RESULTADO: Todos los detectores presentan concentraciones por debajo del nivel de referencia de ${nivelRef} Bq/m³.`,
          20,
          result.n_exceden > 0 ? RED_DARK : GREEN_DARK
        )
      ],
      spacing: { before: 100, after: 100 }
    }),

    new Paragraph({
      children: [bold('A continuación, se presenta el reportaje fotográfico de los detectores instalados por orden de instalación y un plano con la ubicación de los mismos.', 18, '555555')],
      spacing: { before: 80 }
    })
  ]

  // ── Sección fotográfica (detectores con foto_path) ────────────────────────
  const detsConFoto = detectores.filter((d) => d.foto_path && existsSync(String(d.foto_path)))

  const photoBody: (Paragraph | Table)[] = []
  if (detsConFoto.length > 0) {
    photoBody.push(new Paragraph({ pageBreakBefore: true }))
    photoBody.push(sectionTitle('3.- REPORTAJE FOTOGRÁFICO'))
    photoBody.push(new Paragraph({
      children: [normal('Fotografías de los detectores de radón en su posición de instalación.', 18, '555555')],
      spacing: { before: 60, after: 200 }
    }))

    // Cuadrícula 2 columnas: foto (aprox 6 cm) + pie de foto
    const PHOTO_W = 170  // px → docx ImageRun usa px directamente (aprox 6 cm @ 96dpi)
    const PHOTO_H = 130

    for (let i = 0; i < detsConFoto.length; i += 2) {
      const pair = [detsConFoto[i], detsConFoto[i + 1] ?? null]

      const makeFotoCell = (d: RadonDetector | null): TableCell => {
        if (!d || !d.foto_path) {
          return new TableCell({
            width: { size: Math.floor(CONTENT_TW / 2), type: WidthType.DXA },
            borders: noBorder,
            children: [new Paragraph({ children: [] })]
          })
        }
        let imgData: Buffer | null = null
        try { imgData = readFileSync(String(d.foto_path)) } catch { /* sin foto */ }

        const ext = String(d.foto_path).split('.').pop()?.toLowerCase() ?? 'jpg'
        const imgType = (ext === 'png' ? 'png' : ext === 'gif' ? 'gif' : 'jpg') as 'png' | 'gif' | 'jpg'

        const label = `Detector ${d.n} · ${d.codigo ?? ''}${d.ubicacion ? ` · ${d.ubicacion}` : ''}`
        return new TableCell({
          width: { size: Math.floor(CONTENT_TW / 2), type: WidthType.DXA },
          borders: noBorder,
          children: [
            imgData
              ? new Paragraph({
                  children: [new ImageRun({ data: imgData, transformation: { width: PHOTO_W, height: PHOTO_H }, type: imgType })],
                  alignment: AlignmentType.CENTER,
                  spacing: { after: 60 }
                })
              : new Paragraph({ children: [normal('[foto no disponible]', 14, '999999')] }),
            new Paragraph({
              children: [bold(label, 16, NAVY)],
              alignment: AlignmentType.CENTER,
              spacing: { after: 200 }
            })
          ]
        })
      }

      photoBody.push(new Table({
        width: { size: CONTENT_TW, type: WidthType.DXA },
        rows: [new TableRow({ children: [makeFotoCell(pair[0]), makeFotoCell(pair[1])] })]
      }))
    }
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
        children: [...p1Body, ...p2Body, ...photoBody]
      }
    ]
  })

  return Packer.toBuffer(doc)
}
