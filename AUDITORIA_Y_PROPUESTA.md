# CYE — Auditoría técnica y propuesta de mejora

**Proyecto:** cye-electron (Electron 39 · React 19 · Vite 7 · TypeScript 5.9)
**Fecha:** 24 jun 2026
**Alcance acordado:** auditoría + propuesta (sin tocar código todavía) · estética con enfoque de **pulido incremental** (conservar la identidad CYE).

---

## 1. Resumen ejecutivo

El proyecto está bien arquitecturado: separación limpia main / preload / renderer, pipeline puro y testeable con `tsx`, sistema de precios RAG documentado, y un sistema de diseño CSS con paleta corporativa y tokens base. La base es sólida y comercializable.

Las oportunidades de mejora se concentran en cuatro frentes:

1. **Errores reales** — 8 errores de `typecheck` (algunos pueden romper la generación de documentos), un bug de *hooks* en `ScanPanel`, y 115 errores de `lint`.
2. **Deuda de UI** — ~377 estilos en línea (`style={...}`) que erosionan la consistencia visual y dificultan cualquier rediseño.
3. **Accesibilidad** — prácticamente sin `aria-*` ni estados de foco; inviable con lector de pantalla y poco "profesional" al teclado.
4. **Pulido estético** — el sistema de diseño es bueno pero le faltan escala de espaciado y tipografía, estados de foco, micro-jerarquía y algunos detalles que separan "funcional" de "comercial".

La buena noticia: casi todo se arregla **sin reescribir**. La mayor parte del valor estético se obtiene endureciendo los tokens en `base.css` y migrando estilos en línea a clases existentes, no rehaciendo pantallas.

---

## 2. Errores y deuda técnica (priorizado)

### 2.1 🔴 Crítico — corregir cuanto antes

**Errores de `npm run typecheck` (8).** Varios afectan a la generación de entregables Word, que es funcionalidad central:

| Archivo | Error | Riesgo |
|---|---|---|
| `formatter/albaranPlantaWordTemplate.ts:192` | `"jpeg"` no asignable a `"jpg" \| "png" \| ...` | La imagen del albarán puede no insertarse o lanzar en runtime |
| `formatter/albaranPlantaWordTemplate.ts:255` | `direccion` no existe en `Obra` | Campo `undefined` silencioso en el documento |
| `formatter/placaWordTemplate.ts:586` | `municipio` no existe en `Obra` | Igual: dato vacío en el informe |
| `formatter/placaWordTemplate.ts:572` | `insideH` no válido en `ITableBordersOptions` | Bordes de tabla mal renderizados |
| `formatter/albaranPlantaWordTemplate.ts:15` | `TableBorders` importado sin usar | Limpieza |
| `pipeline/budgetParser.ts:344` | `format` declarado sin usar | Limpieza |
| `harness/ragCompare.ts:8,21` | Identificador `resolve` duplicado | El script `rag:compare` no compila |

> El tipo `Obra` se ha quedado corto respecto a lo que consumen las plantillas (`direccion`, `municipio`). Conviene decidir: ampliar el tipo `Obra` y poblar esos campos, o derivarlos de los datos de obra ya existentes. Hoy salen vacíos en el documento sin avisar.

**Bug de React Hooks — `components/ScanPanel.tsx:94-96`.** Hay un `return null` condicional (`if (!SUPPORTED.has(tipo)) return null`) **antes** de un `useCallback`. Esto rompe la regla de hooks: si `tipo` cambia entre un valor soportado y uno no soportado, React lanzará *"rendered fewer hooks than expected"* y la pantalla se cae. Solución: mover el `return` después de declarar todos los hooks.

**Pérdida de datos sin confirmación (UX crítica).** Reportado por la revisión de páginas, conviene verificar y blindar:
- `Ensayos.tsx` — `applyOcrResult()` fusiona/sobrescribe campos del formulario con el resultado de OCR sin confirmar; un OCR erróneo pisa datos correctos.
- `NuevaObra.tsx` — cambiar de modo (generar ↔ importar) resetea el estado sin avisar.
- Guardado de condiciones económicas en `Detalle.tsx` aplica descuento sin *rollback* si la operación falla.

### 2.2 🟠 Alto — calidad y mantenibilidad

**`lint`: 115 errores + 2.386 avisos.** Desglose real:

| Regla | Nº | Naturaleza |
|---|---|---|
| `prettier/prettier` | 2.386 (aviso) | Formato — **auto-corregible** con `npm run format` |
| `@typescript-eslint/no-require-imports` | 67 | `require()` en TS (sobre todo en `scripts/`) |
| `explicit-function-return-type` | 19 | Falta tipo de retorno |
| `no-unused-vars` | 18 | Código muerto |
| `set-state-in-effect` | 3 | Anti-patrón React (`Proyectos`, `Detalle`, `NuevaObra`) |
| `no-useless-escape` | 4 | Regex en `budgetParser.ts` |
| `rules-of-hooks` | 1 | El bug de `ScanPanel` de arriba |
| otros | 3 | `media-has-caption`, `react-refresh` |

Los 2.386 avisos son ruido de formato: ejecutar `npm run format` una vez los elimina y deja el `lint` legible. Recomiendo además un hook de pre-commit (lint-staged + prettier) para que no vuelvan.

**Componentes monolíticos.** `Ensayos.tsx` tiene **3.621 líneas** (9 formularios de ensayo, lógica de veredicto, *merge* de OCR). `Detalle.tsx` 718, `NuevaObra.tsx` 661. Son difíciles de mantener y de pulir visualmente. No hace falta partirlos todos ya, pero sí extraer piezas repetidas (ver §4).

**Tipado débil.** ~76 usos de `Record<string, unknown>` para `Ensayo.datos`, con *casts* repartidos. Un tipo discriminado por tipo de ensayo (`DensidadDatos | PlacaDatos | ...`) eliminaría casts y prevendría errores como los de `Obra`.

### 2.3 🟡 Medio — robustez

- Sin **ErrorBoundary** global: un error de render deja pantalla en blanco.
- Manejo de errores inconsistente (a veces `setMsg(errorMessage(e))`, a veces `catch` mudo).
- `Promise.all` sin cancelación en cargas de `Detalle`: posible *race condition* / *setState* tras desmontar al navegar rápido.
- Sin tests automatizados (ni de los *helpers* puros como `format.ts` / `ensayoCalc.ts`, que serían triviales de cubrir).
- Tabla de catálogo (Presupuestos) sin paginación/virtualización; con catálogos grandes degrada.

---

## 3. Estética — propuesta de pulido incremental

El objetivo es que se perciba más **moderna, profesional y comercial sin rediseñar**. La paleta navy/orange funciona y se mantiene. Lo que falta es *rigor de sistema* y *detalle*.

### 3.1 Diagnóstico del sistema actual

Lo bueno: tokens de color, sombras y radio en `base.css`; clases consistentes (`.btn`, `.card`, `.kpi`, `.badge`, `.banner`, `.plan-table`).

Lo que rompe la sensación de producto acabado:

- **Sin escala de espaciado.** Aparecen `28px, 36px, 22px, 18px, 16px, 14px...` ad-hoc. Sin ritmo vertical, la app se ve "artesanal".
- **Sin escala tipográfica.** Se usan **13 tamaños distintos** (9, 10, 11, 12, 13, 14, 15, 16, 18, 22, 24, 26, 40 px). Falta jerarquía clara.
- **Estados de foco casi inexistentes** (1 `:focus-visible` en toda la app). Tabular por teclado se siente roto y poco profesional.
- **~377 estilos en línea** que esquivan el sistema y reinventan patrones (botones, *toolbars*, *grids* de 2 columnas, badges).
- **Colores "sueltos"** fuera de tokens (`#f8fafc`, `#f8faff`, `#dbeafe`, `#dcfce7`...).
- Sin `prefers-reduced-motion` ni modo oscuro (opcional, pero el primero es accesibilidad básica).

### 3.2 Acciones concretas (orden recomendado)

**A. Endurecer los tokens en `base.css`** (1 archivo, alto impacto visual).

Añadir escala de espaciado y tipográfica, y un par de tokens que faltan:

```css
:root {
  /* Espaciado (escala 4px) */
  --space-1: 4px;  --space-2: 8px;  --space-3: 12px;
  --space-4: 16px; --space-5: 24px; --space-6: 32px; --space-8: 48px;

  /* Tipografía */
  --text-xs: 11px; --text-sm: 13px; --text-base: 14px;
  --text-lg: 16px; --text-xl: 20px; --text-2xl: 24px; --text-3xl: 30px;
  --font-num: 'SF Mono', ui-monospace, 'Roboto Mono', monospace; /* cifras/importes */

  /* Radios y elevación (refinar) */
  --radius-sm: 6px; --radius: 10px; --radius-lg: 14px;
  --ring: 0 0 0 3px rgba(46, 117, 182, 0.35); /* foco accesible */

  /* Color de marca con un toque más actual (opcional, mantiene identidad) */
  --orange: #ea6a17;   /* naranja un punto más vivo y saturado */
  --navy: #1f3864;     /* sin cambios */
}
```

Luego reemplazar los `28px/36px/...` por estos tokens en `.content`, `.page-head`, `.kpis`, `.card`, etc. El cambio es mecánico y de bajo riesgo.

**B. Estados de foco globales** (accesibilidad + percepción de calidad):

```css
:focus-visible {
  outline: none;
  box-shadow: var(--ring);
  border-radius: var(--radius-sm);
}
@media (prefers-reduced-motion: reduce) {
  * { animation-duration: .01ms !important; transition-duration: .01ms !important; }
}
```

**C. Detalles que elevan la percepción "comercial"** (todo en CSS, sin tocar JSX salvo clases):

- **Sidebar:** sutil degradado vertical (`--navy` → `--navy-700`), separador fino bajo la marca, e indicador de ítem activo con barra lateral de 3px en `--orange` en vez de fondo sólido (más sobrio y moderno). Estado *hover* con transición suave.
- **KPIs:** usar `--font-num` y `font-variant-numeric: tabular-nums` en los valores; reducir el borde izquierdo naranja a un acento más fino o moverlo a un icono superior. Añadir variación de delta (▲/▼) si hay histórico.
- **Tarjetas y filas:** unificar `:hover` (hoy conviven `translateY(-2px)` y solo cambio de sombra). Estandarizar a elevación + cambio de fondo muy leve.
- **Tablas (`.plan-table`):** filas zebra opcionales, cabecera *sticky* al hacer scroll, y números con `tabular-nums` (clave en una app de importes).
- **Botones:** añadir estado `:active` (leve `scale(.98)`) y `--btn-shadow` sutil en primarios para dar profundidad.
- **Badges/estados:** ya están bien; unificar a un único set de colores semánticos (ok/warn/danger/info) en tokens y derivar todos los badges de ahí.
- **Tipografía de cifras:** importes y resultados de ensayo con `--font-num` — es el detalle que más "look de software técnico serio" aporta.

**D. Migrar estilos en línea a clases** (es lo que hace sostenible todo lo anterior). Crear un `utilities.css` con los patrones repetidos detectados:

```css
.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-4); }
.input-narrow { width: 72px; text-align: right; }
.input-table  { width: 70px; padding: 4px 8px; font-size: var(--text-sm); text-align: right; }
.stack { display: flex; flex-direction: column; gap: var(--space-3); }
.cluster { display: flex; align-items: center; gap: var(--space-2); }
.section-actions { display: flex; justify-content: space-between; align-items: center; }
```

Empezar por **Dashboard** y **Detalle** (los más visibles y con más `style={...}` "de layout") deja resultado tangible rápido. `Ensayos.tsx` (232 inline styles) se aborda por formularios, no de golpe.

### 3.3 Antes / después (resumen de impacto)

| Aspecto | Hoy | Tras el pulido |
|---|---|---|
| Espaciado | Valores ad-hoc | Escala 4px coherente |
| Tipografía | 13 tamaños sueltos | 7 niveles + fuente para cifras |
| Foco teclado | Casi inexistente | Anillo accesible global |
| Estilos en línea | ~377 | Migrados a clases reutilizables |
| Sidebar / KPIs / tablas | Funcionales | Detalle "producto" (acentos, tabular-nums, hover unificado) |
| Accesibilidad | ~2 `aria-*` | `aria-label`/`aria-current`/`aria-modal` en navegación, tabs y diálogos |

---

## 4. Mejoras de sistema (más allá de lo estético)

Reutilización para reducir las 3.600 líneas de `Ensayos.tsx` y la duplicación general:

- **`<FormSection>` / `<FormRow>`** con etiqueta, ayuda (`aria-describedby`) y error visible — hoy cada formulario reinventa su layout.
- **`<TabBar>` genérico** con `role="tablist"` / `aria-selected` — usado en Detalle, Presupuestos y NuevaObra.
- **Tipo `EnsayoData` discriminado** por tipo de ensayo → elimina `Record<string, unknown>` y *casts*.
- **`<Toast>` / contexto de notificaciones** para unificar el feedback (hoy mezcla *banners* en línea y `setMsg`).
- **Helpers a `lib/`:** `computeVeredictoLocal`, `toStr/fromStr`, `fileToBase64` viven dentro de componentes; moverlos los hace testeables.
- **Validación de formularios** antes de guardar (p. ej. `obra.trim()` obligatorio, numéricos con `min`/`max` e `inputmode="decimal"`).
- **Accesibilidad funcional:** sustituir `div role="button"` por `<button>` nativo (drag-zones, expandibles), usar `<details>` para los desplegables del catálogo.

---

## 5. Plan sugerido por fases

**Fase 0 — Quick wins (≈ medio día, bajo riesgo).** `npm run format`; arreglar los 8 errores de typecheck; corregir el hook de `ScanPanel`; eliminar código muerto (`no-unused-vars`); añadir hook pre-commit. Resultado: build limpio y verde.

**Fase 1 — Pulido estético (≈ 2-3 días).** Tokens de espaciado/tipografía + foco global en `base.css`; `utilities.css`; refactor visual de Sidebar, Dashboard y Detalle a clases; cifras con `tabular-nums`. Resultado: salto de percepción "comercial" sin rediseñar.

**Fase 2 — Robustez (≈ 3-5 días).** ErrorBoundary; confirmaciones en acciones destructivas (OCR, cambio de modo); cancelación de cargas; `set-state-in-effect`; primeros tests de `helpers`.

**Fase 3 — Estructura (continuo).** Extraer `FormSection`/`TabBar`/`Toast`; tipar `EnsayoData`; trocear `Ensayos.tsx` por formularios; accesibilidad funcional.

---

## 6. Recomendación

Empezar por la **Fase 0** (rápida, deja el proyecto en verde y elimina riesgos reales de generación de documentos) e inmediatamente la **Fase 1**, que es donde se concentra el "más moderno y profesional" que buscas, con muy poco riesgo porque casi todo vive en `base.css` + un nuevo `utilities.css`.

Si te parece bien, en una siguiente sesión puedo implementar la Fase 0 + Fase 1 directamente en una rama aislada para que revises el diff antes de fusionar.
