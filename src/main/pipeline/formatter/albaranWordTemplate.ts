/**
 * Genera el albarán Word "SOLICITUD, TOMA DE MUESTRA Y REGISTRO DE ENSAYO"
 * (pág. 1: formulario) + tabla de campo DENSIDAD "IN SITU" (pág. 2: registro
 * apaisado), replicando el formulario oficial PDF de CYE con docx v9.
 */
import { readFileSync } from 'fs'
import sharp from 'sharp'
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
  WidthType,
  BorderStyle,
  ShadingType,
  UnderlineType,
  convertMillimetersToTwip,
  VerticalMergeType,
  PageOrientation
} from 'docx'
import type { Ensayo, Obra } from '../../db'

// ── Geometría ─────────────────────────────────────────────────────────────────
const MARGIN_TW  = convertMillimetersToTwip(15)
const CONTENT_TW = 11906 - MARGIN_TW * 2              // ≈ 10200 twips (portrait)
const LAND_TW    = 16838 - MARGIN_TW * 2              // ≈ 15138 twips (landscape)
const PX_PER_MM  = 96 / 25.4

// ── Bordes ────────────────────────────────────────────────────────────────────
const N = { style: BorderStyle.NONE,   size: 0, color: 'FFFFFF' } as const
const T = { style: BorderStyle.SINGLE, size: 4, color: '000000' } as const
const G = { style: BorderStyle.SINGLE, size: 4, color: 'AAAAAA' } as const

const bAll  = { top: T, bottom: T, left: T, right: T }
const bNone = { top: N, bottom: N, left: N, right: N }
const bTop  = { top: T, bottom: N, left: N, right: N }
const bBot  = { top: N, bottom: T, left: N, right: N }
const bGray = { top: G, bottom: G, left: G, right: G }

// ── Texto ─────────────────────────────────────────────────────────────────────
type TxOpts = { bold?: boolean; italic?: boolean; size?: number; color?: string; br?: number; underline?: boolean }

// Null-safe: docx's Text constructor crashes if text is null (typeof null !== 'string'
// causes it to try null.space). Coerce any null/undefined to empty string.
const tx = (text: string | null | undefined, o: TxOpts = {}): TextRun =>
  new TextRun({
    text: String(text ?? ''), bold: o.bold, italics: o.italic,
    size: (o.size ?? 8) * 2, color: o.color ?? '000000',
    font: 'Calibri', break: o.br,
    underline: o.underline ? { type: UnderlineType.SINGLE } : undefined
  })

const lbl  = (t: string | null | undefined, sz = 8) => tx(t, { bold: true, size: sz })
const lblU = (t: string | null | undefined, sz = 8) => tx(t, { bold: true, size: sz, underline: true })
const val  = (t: string | null | undefined, sz = 8) => tx(t, { size: sz })

const chk = (on: boolean, text: string, sz = 8): TextRun[] =>
  [tx(on ? '☑' : '☐', { size: sz }), tx(' ' + text, { size: sz })]

// ── Párrafos ──────────────────────────────────────────────────────────────────
const sp = (bef = 20, aft = 20) => ({ before: bef, after: aft })

const p = (runs: TextRun[], align = AlignmentType.LEFT, spacing = sp()): Paragraph =>
  new Paragraph({ alignment: align, spacing, children: runs })

const pBlank = (): Paragraph => new Paragraph({ spacing: sp(10, 10), children: [tx('')] })

// ── Celdas ────────────────────────────────────────────────────────────────────
interface CellOpts {
  borders?: typeof bAll
  span?: number
  shade?: string
  align?: typeof AlignmentType[keyof typeof AlignmentType]
  vMerge?: 'restart' | 'continue'
  vAlign?: 'top' | 'center' | 'bottom'
  spacing?: ReturnType<typeof sp>
  paras?: Paragraph[]
}

function tc(width: number, runs: TextRun[], o: CellOpts = {}): TableCell {
  const vM = o.vMerge === 'restart' ? VerticalMergeType.RESTART
           : o.vMerge === 'continue' ? VerticalMergeType.CONTINUE
           : undefined
  return new TableCell({
    width:         { size: width, type: WidthType.DXA },
    borders:       o.borders ?? bAll,
    columnSpan:    o.span,
    verticalMerge: vM,
    verticalAlign: o.vAlign ?? 'top',
    ...(o.shade ? { shading: { type: ShadingType.SOLID, fill: o.shade } } : {}),
    children:      o.paras ?? [p(runs, o.align, o.spacing ?? sp())]
  })
}

const tcCont = (width: number, span?: number): TableCell =>
  new TableCell({
    width:         { size: width, type: WidthType.DXA },
    columnSpan:    span,
    verticalMerge: VerticalMergeType.CONTINUE,
    borders:       bNone,
    children:      [pBlank()]
  })

// ── Filas y tablas ────────────────────────────────────────────────────────────
const tr = (cells: TableCell[], height?: number): TableRow =>
  new TableRow({
    children: cells,
    ...(height ? { height: { value: height, rule: 'atLeast' } } : {})
  })

const tbl = (widths: number[], rows: TableRow[]): Table =>
  new Table({
    columnWidths: widths,
    width:        { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    rows
  })

const gap = (): Paragraph => new Paragraph({ spacing: sp(0, 16), children: [] })

// ══════════════════════════════════════════════════════════════════════════════
// FUNCIÓN PRINCIPAL
// ══════════════════════════════════════════════════════════════════════════════

export async function fillAlbaranWord(
  ensayo: Ensayo,
  obra: Obra,
  logoPath: string
): Promise<Buffer> {
  const datos = (ensayo.datos ?? {}) as Record<string, unknown>
  const d = (k: string, fb = '') => String(datos[k] ?? fb).trim()
  const b = (k: string) => Boolean(datos[k])

  const n_ensayo_ot     = d('n_ensayo_ot')
  const fecha_toma      = d('fecha_toma')
  const fecha_entrada   = d('fecha_entrada')
  const titulo          = d('titulo_obra', obra.obra)
  const ref_obra        = d('ref_obra', obra.ref_lab)
  const empresa         = d('empresa', obra.cliente)
  const direccion       = d('direccion')
  const nif_cif         = d('nif_cif')
  const pers_contacto   = d('persona_contacto')
  const tel_fax         = d('telefono_fax')
  const obs_cliente     = d('observaciones_cliente')
  const peticionario    = d('peticionario')
  const ef_cye          = b('efectuada_por_cye')
  const rec_cye         = b('recibida_en_cye')
  const in_situ         = b('ensayo_in_situ')
  const recogida        = d('recogida_por_cye_en')
  const material        = d('material_descripcion')
  const localiz         = d('localizacion')
  const cantidad        = d('cantidad_muestra')
  const otros           = d('otros_datos')
  const indicac         = d('indicaciones_toma')
  const firma_tipo      = d('firma_tipo', 'analista')
  const fdo_muestra     = d('fdo_muestra')
  const ensayos_sol     = (datos['ensayos_solicitados'] as Array<{ ensayo: string; normativa: string }>) ?? []
  const condiciones     = d('condiciones_ejecucion')
  const inspeccion      = d('inspeccion', 'aceptada')
  const comentarios     = d('comentarios')
  const acp_cliente     = b('aceptacion_cliente')
  const acp_peticion    = b('aceptacion_peticionario')
  const fdo_cliente     = d('fdo_cliente')
  const fecha_fc        = d('fecha_firma_cliente')
  const acp_dir         = b('aceptacion_dir_tecnico')
  const acp_jefe        = b('aceptacion_jefe_area')
  const fdo_tecnico     = d('fdo_tecnico')
  const fecha_ft        = d('fecha_firma_tecnico')
  const fecha_encargo   = d('fecha_encargo')
  const fecha_informe   = d('fecha_informe')

  // ── Logo ───────────────────────────────────────────────────────────────────
  const logoBuf  = readFileSync(logoPath)
  const logoMeta = await sharp(logoBuf).metadata()
  const logoColTw = 3000
  const logoColPx = Math.round(logoColTw / 15)
  const logoHpx   = Math.round(logoColPx * ((logoMeta.height ?? 120) / (logoMeta.width ?? 620)))

  // ══════════════════════════════════════════════════════════════════════════
  // PÁGINA 1: FORMULARIO DE SOLICITUD
  // ══════════════════════════════════════════════════════════════════════════

  // ── T1: Cabecera ──────────────────────────────────────────────────────────
  // [logo(3000) | título(4000) | label(2000) | valor(1200)] = 10200
  const W1 = [3000, 4000, 2000, 1200] as const

  const t1 = tbl(W1 as unknown as number[], [
    tr([
      new TableCell({
        width: { size: W1[0], type: WidthType.DXA },
        borders: bAll, verticalMerge: VerticalMergeType.RESTART, verticalAlign: 'center',
        children: [p([new ImageRun({ type: 'jpg', data: logoBuf, transformation: { width: logoColPx, height: logoHpx } })],
          AlignmentType.CENTER, sp(40, 40))]
      }),
      new TableCell({
        width: { size: W1[1], type: WidthType.DXA },
        borders: bAll, verticalMerge: VerticalMergeType.RESTART, verticalAlign: 'center',
        children: [
          p([tx('SOLICITUD, TOMA DE MUESTRA Y', { bold: true, size: 13 })], AlignmentType.CENTER, sp(20, 4)),
          p([tx('REGISTRO DE ENSAYO',            { bold: true, size: 13 })], AlignmentType.CENTER, sp(4, 20))
        ]
      }),
      tc(W1[2], [lbl('Nº de ensayo (O.T.)', 7)], { borders: { top: T, bottom: T, left: T, right: N } }),
      tc(W1[3], [val(n_ensayo_ot)],               { borders: { top: T, bottom: T, left: N, right: T } }),
    ], 280),
    tr([
      tcCont(W1[0]), tcCont(W1[1]),
      tc(W1[2], [lbl('Fecha de toma', 7)],    { borders: { top: T, bottom: T, left: T, right: N } }),
      tc(W1[3], [val(fecha_toma)],            { borders: { top: T, bottom: T, left: N, right: T } }),
    ], 200),
    tr([
      tcCont(W1[0]), tcCont(W1[1]),
      tc(W1[2], [lbl('Fecha de entrada', 7)], { borders: { top: T, bottom: T, left: T, right: N } }),
      tc(W1[3], [val(fecha_entrada)],         { borders: { top: T, bottom: T, left: N, right: T } }),
    ], 200),
  ])

  // ── T2: Datos de la obra ──────────────────────────────────────────────────
  // [1600 | 5000 | 1600 | 2000] = 10200
  const W2 = [1600, 5000, 1600, 2000] as const
  const t2 = tbl(W2 as unknown as number[], [
    tr([tc(CONTENT_TW, [lblU('DATOS DE LA OBRA', 8.5)],
      { span: 4, borders: { top: N, bottom: N, left: N, right: N } })], 180),
    tr([
      tc(W2[0], [lbl('TÍTULO:')]),
      tc(W2[1], [val(titulo)]),
      tc(W2[2], [lbl('REF. OBRA:')], { align: AlignmentType.RIGHT }),
      tc(W2[3], [val(ref_obra)]),
    ], 240),
  ])

  // ── T3: Datos del cliente ─────────────────────────────────────────────────
  // Header full-span | [5100 | 5100]
  const W3 = [5100, 5100] as const
  const clienteLines: TextRun[] = [
    lbl('EMPRESA: '), val(empresa), tx('', { br: 1 }),
    lbl('DIRECCIÓN: '), val(direccion), tx('', { br: 1 }),
    lbl('N.I.F. / C.I.F.: '), val(nif_cif), tx('', { br: 1 }),
    lbl('PERSONA DE CONTACTO: '), val(pers_contacto), tx('', { br: 1 }),
    lbl('TELÉFONO / FAX: '), val(tel_fax),
  ]
  const t3 = tbl(W3 as unknown as number[], [
    tr([tc(CONTENT_TW, [
      lblU('DATOS DEL CLIENTE', 8.5),
      tx('  (cumplimentar cuando no se conozcan los datos)', { italic: true, size: 7.5 })
    ], { span: 2, borders: { top: N, bottom: N, left: N, right: N } })], 180),
    tr([
      tc(W3[0], clienteLines, { spacing: sp(20, 20) }),
      tc(W3[1], [
        lbl('PETICIONARIO', 8.5),
        tx('  (cumplimentar cuando sea distinto del cliente)', { italic: true, size: 7 }), tx('', { br: 1 }),
        val(peticionario)
      ], { vAlign: 'top', spacing: sp(20, 20) }),
    ], 480),
    tr([
      tc(CONTENT_TW, [lbl('OBSERVACIONES: '), val(obs_cliente)],
        { span: 2 }), // no: span of 2 in 2-col table = full width
    ], 200),
  ])

  // ── T4: Toma de muestra (checkboxes) ─────────────────────────────────────
  // [1800 | 2100 | 2100 | 2100 | 2100] = 10200
  const W4 = [1800, 2100, 2100, 2100, 2100] as const
  const t4 = tbl(W4 as unknown as number[], [
    tr([
      tc(W4[0], [lbl('TOMA DE MUESTRA', 7.5)], { align: AlignmentType.CENTER, vAlign: 'center' }),
      tc(W4[1], chk(ef_cye, 'EFECTUADA POR CYE', 7.5),  { align: AlignmentType.CENTER, vAlign: 'center' }),
      tc(W4[2], chk(rec_cye, 'RECIBIDA EN CYE', 7.5),   { align: AlignmentType.CENTER, vAlign: 'center' }),
      tc(W4[3], chk(in_situ, 'ENSAYO IN SITU', 7.5),    { align: AlignmentType.CENTER, vAlign: 'center' }),
      tc(W4[4], [
        ...chk(Boolean(recogida), 'RECOGIDA POR CYE EN', 7.5),
        tx('', { br: 1 }), val(recogida)
      ], { align: AlignmentType.CENTER, vAlign: 'center' }),
    ], 280),
  ])

  // ── T5: Material / Localización / Otros datos ─────────────────────────────
  // 2 filas × [3000 | 4200 | 3000] = 10200
  const W5 = [3000, 4200, 3000] as const
  const firmaIsAnalista = firma_tipo === 'analista'
  const t5 = tbl(W5 as unknown as number[], [
    tr([
      tc(W5[0], [lbl('MATERIAL Y DESCRIPCIÓN:'), tx('', { br: 1 }), val(material)], { vAlign: 'top' }),
      tc(W5[1], [lbl('LOCALIZACIÓN:'), tx('', { br: 1 }), val(localiz)],            { vAlign: 'top' }),
      tc(W5[2], [lbl('OTROS DATOS:'), tx('', { br: 1 }), val(otros)],               { vAlign: 'top' }),
    ], 320),
    tr([
      tc(W5[0], [lbl('INDICACIONES SOBRE LA TOMA DE MUESTRA:'), tx('', { br: 1 }), val(indicac)], { vAlign: 'top' }),
      tc(W5[1], [lbl('CANTIDAD DE MUESTRA:'), tx('', { br: 1 }), val(cantidad)],                  { vAlign: 'top' }),
      tc(W5[2], [
        ...chk(firmaIsAnalista,   '  ANALISTA QUE TOMA LA MUESTRA', 7.5), tx('', { br: 1 }),
        ...chk(!firmaIsAnalista,  '  PERSONA QUE RECIBE / RECOGE LA MUESTRA', 7.5), tx('', { br: 1 }),
        tx('', { br: 1 }),
        val(fdo_muestra), tx('', { br: 1 }),
        lbl('Fdo.:', 7.5)
      ], { vAlign: 'top' }),
    ], 360),
  ])

  // ── T6: Ensayos solicitados ───────────────────────────────────────────────
  // [7200 | 3000] = 10200
  const W6 = [7200, 3000] as const
  const minRows = 10
  const ensayoRows = [...ensayos_sol]
  while (ensayoRows.length < minRows) ensayoRows.push({ ensayo: '', normativa: '' })

  const t6 = tbl(W6 as unknown as number[], [
    tr([
      tc(W6[0], [lbl('ENSAYOS SOLICITADOS', 8.5)], { shade: 'EEEEEE', align: AlignmentType.CENTER }),
      tc(W6[1], [lbl('NORMATIVA APLICABLE', 8.5)], { shade: 'EEEEEE', align: AlignmentType.CENTER }),
    ], 220),
    ...ensayoRows.map((e) =>
      tr([
        tc(W6[0], [val(e.ensayo)]),
        tc(W6[1], [val(e.normativa)]),
      ], 180)
    ),
  ])

  // ── T7: Condiciones de ejecución ──────────────────────────────────────────
  const t7 = tbl([CONTENT_TW], [
    tr([tc(CONTENT_TW, [
      lbl('CONDICIONES DE EJECUCIÓN', 8.5),
      tx('  (cuando sean distintas a la Norma de Ensayo)', { italic: true, size: 7.5 }),
      tx('', { br: 1 }), val(condiciones),
    ])], 380),
  ])

  // ── T8: Inspección de la muestra ──────────────────────────────────────────
  // [5000 | 2600 | 2600] = 10200
  const W8 = [5000, 2600, 2600] as const

  const t8 = tbl(W8 as unknown as number[], [
    tr([
      // Inspección + checkboxes
      tc(W8[0], [
        lblU('INSPECCIÓN DE LA MUESTRA:', 8.5), tx('', { br: 1 }),
        ...chk(inspeccion === 'aceptada',  ' Aceptada', 8), tx('   ', { size: 8 }),
        ...chk(inspeccion === 'en_espera', ' En espera', 8), tx('   ', { size: 8 }),
        ...chk(inspeccion === 'rechazada', ' Rechazada', 8),
      ], { vAlign: 'top' }),
      // Aceptación cliente
      tc(W8[1], [
        lbl('Aceptación', 8.5), tx('', { br: 1 }),
        ...chk(acp_cliente,  ' EL CLIENTE', 7.5), tx('', { br: 1 }),
        ...chk(acp_peticion, ' PETICIONARIO', 7.5),
      ], { vAlign: 'top' }),
      // Aceptación técnico
      tc(W8[2], [
        lbl('Aceptación', 8.5), tx('', { br: 1 }),
        ...chk(acp_dir,  ' DIR. TÉCNICO O', 7.5), tx('', { br: 1 }),
        ...chk(acp_jefe, ' JEFE DE ÁREA', 7.5),
      ], { vAlign: 'top' }),
    ], 280),
    tr([
      tc(W8[0], [lblU('COMENTARIOS:', 8.5), tx('', { br: 1 }), val(comentarios)], { vAlign: 'top' }),
      tc(W8[1], [
        lbl('Fdo.:', 7.5), tx('', { br: 1 }), val(fdo_cliente),
        tx('', { br: 1 }), tx('', { br: 1 }),
        lbl('Fecha: ', 7.5), val(fecha_fc),
      ], { vAlign: 'top' }),
      tc(W8[2], [
        lbl('Fdo.:', 7.5), tx('', { br: 1 }), val(fdo_tecnico),
        tx('', { br: 1 }), tx('', { br: 1 }),
        lbl('Fecha: ', 7.5), val(fecha_ft),
      ], { vAlign: 'top' }),
    ], 320),
  ])

  // ── T9: Registro / fechas ─────────────────────────────────────────────────
  // [1500 | 2700 | 1500 | 2700 | 1800] = 10200
  const W9 = [1500, 2700, 1500, 2700, 1800] as const
  const t9 = tbl(W9 as unknown as number[], [
    tr([
      tc(W9[0], [lbl('REGISTRO', 7.5)],          { align: AlignmentType.CENTER, vAlign: 'center' }),
      tc(W9[1], [lbl('FECHA DE ENCARGO', 7.5), tx('', { br: 1 }), val(fecha_encargo)],
        { align: AlignmentType.CENTER, vAlign: 'center' }),
      tc(W9[2], [tx('')]),
      tc(W9[3], [lbl('FECHA DE INFORME', 7.5), tx('', { br: 1 }), val(fecha_informe)],
        { align: AlignmentType.CENTER, vAlign: 'center' }),
      tc(W9[4], [tx('')]),
    ], 240),
  ])

  // ══════════════════════════════════════════════════════════════════════════
  // PÁGINA 2: TABLA DENSIDAD "IN SITU" (apaisado)
  // ══════════════════════════════════════════════════════════════════════════
  // Columnas: [Nº Lote | Referencia | D.Máx | H.Opt | Densidad | Humedad | %Comp | Observaciones]
  // Anchuras: [900, 2000, 1700, 1600, 2000, 1900, 1600, 3438] = 15138

  const WD = [900, 2000, 1700, 1600, 2000, 1900, 1600, 3438] as const
  const WD_TOTAL = WD.reduce((a, b) => a + b, 0)  // 15138

  const DATA_ROWS = 20
  const hdrShade = 'D9D9D9'
  const midShade = 'EEEEEE'

  const logoPage2Px = Math.round((5 * PX_PER_MM) * ((logoMeta.width ?? 620) / (logoMeta.height ?? 120)))
  const logo2Hpx   = Math.round(5 * PX_PER_MM)  // 5mm de alto

  // Cabecera pag 2
  const WH2 = [3500, 6138, 5500] as const  // logo | doc ref | dirección
  const cabPag2 = tbl(WH2 as unknown as number[], [
    tr([
      new TableCell({
        width: { size: WH2[0], type: WidthType.DXA },
        borders: bNone,
        verticalAlign: 'center',
        children: [p([
          new ImageRun({ type: 'jpg', data: logoBuf, transformation: { width: logoPage2Px, height: logo2Hpx } })
        ], AlignmentType.LEFT, sp(10, 10))]
      }),
      tc(WH2[1], [], {
        borders: bNone, vAlign: 'center',
        paras: [
          p([val('CF-DENSIS Rev 0  –  Pág. 1', 7)], AlignmentType.CENTER, sp(4, 4)),
          p([lblU('DENSIDAD "IN SITU"', 14)],        AlignmentType.CENTER, sp(4, 4)),
        ]
      }),
      tc(WH2[2], [], {
        borders: bNone, vAlign: 'center',
        paras: [
          p([val('Polígono de la Gándara, Avda del Mar, 123, 15570 Narón (A Coruña)', 6.5)], AlignmentType.RIGHT, sp(4, 2)),
          p([val('Tel 981-37 11 36  /  Fax 981-37 11 04', 6.5)],                             AlignmentType.RIGHT, sp(2, 4)),
        ]
      }),
    ], 300),
  ])

  // Tabla de datos
  const tdRows: TableRow[] = [
    // Fila cabecera grupo superior
    tr([
      tc(WD[0], [lbl('Nº\nLote', 7)],       { shade: hdrShade, align: AlignmentType.CENTER, vAlign: 'center', vMerge: 'restart' }),
      tc(WD[1], [lbl('REFERENCIA', 7)],      { shade: hdrShade, align: AlignmentType.CENTER, vAlign: 'center', vMerge: 'restart' }),
      tc(WD[2] + WD[3], [lbl('LABORATORIO', 7)],
        { shade: midShade, align: AlignmentType.CENTER, span: 2 }),
      tc(WD[4] + WD[5] + WD[6], [lbl('OBRA', 7)],
        { shade: midShade, align: AlignmentType.CENTER, span: 3 }),
      tc(WD[7], [lbl('OBSERVACIONES', 7)],   { shade: hdrShade, align: AlignmentType.CENTER, vAlign: 'center', vMerge: 'restart' }),
    ], 200),
    // Fila cabecera sub-columnas
    tr([
      tcCont(WD[0]),
      tcCont(WD[1]),
      tc(WD[2], [lbl('Dens. Máx.\ng/cm³', 7)],  { shade: midShade, align: AlignmentType.CENTER }),
      tc(WD[3], [lbl('Hum. Opt.\n%',      7)],  { shade: midShade, align: AlignmentType.CENTER }),
      tc(WD[4], [lbl('Densidad\ng/cm³',   7)],  { shade: midShade, align: AlignmentType.CENTER }),
      tc(WD[5], [lbl('Humedad\n%',        7)],  { shade: midShade, align: AlignmentType.CENTER }),
      tc(WD[6], [lbl('% Comp.',           7)],  { shade: midShade, align: AlignmentType.CENTER }),
      tcCont(WD[7]),
    ], 220),
    // Filas de datos (en blanco para rellenar en campo)
    ...Array.from({ length: DATA_ROWS }, () =>
      tr(WD.map((w) => tc(w, [tx('')], { borders: bGray })), 200)
    ),
  ]

  const tDensidad = tbl(WD as unknown as number[], tdRows)

  // ── Montar documento ───────────────────────────────────────────────────────
  const page1Margin = { top: MARGIN_TW, bottom: MARGIN_TW, left: MARGIN_TW, right: MARGIN_TW }

  const doc = new Document({
    sections: [
      // ─── Sección 1: Formulario solicitud (retrato) ─────────────────────────
      {
        properties: {
          page: {
            size:   { width: 11906, height: 16838 },
            margin: page1Margin
          }
        },
        children: [
          t1, gap(),
          t2, gap(),
          t3, gap(),
          t4, gap(),
          t5, gap(),
          t6, gap(),
          t7, gap(),
          t8, gap(),
          t9,
        ]
      },
      // ─── Sección 2: Tabla de campo densidad in situ (apaisado) ────────────
      {
        properties: {
          page: {
            size:   { width: 16838, height: 11906, orientation: PageOrientation.LANDSCAPE },
            margin: { top: MARGIN_TW, bottom: MARGIN_TW, left: MARGIN_TW, right: MARGIN_TW }
          }
        },
        children: [
          cabPag2,
          gap(),
          tDensidad,
        ]
      }
    ]
  })

  return Buffer.from(await Packer.toBuffer(doc))
}
