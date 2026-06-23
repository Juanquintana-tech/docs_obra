# Plan de desarrollo — Servicio de Radón (trazas CR-39)

> Objetivo: digitalizar el flujo completo del servicio de medición de radón de CYE,
> desde la instalación de detectores en campo hasta la emisión del informe firmado.
>
> Flujo deseado:
> **Técnico (móvil/Telegram)** → JSON + fotos → **App Electron** → cálculos + Word firmado

---

## Contexto y decisiones de arquitectura

### El servicio CYE de radón

- **Tipo de medida:** pasiva por trazas CR-39 (detectores GJ-series, ISO 11665-4 / IS-47 CSN)
- **Regulación:** RD 1029/2022 Art. 72 — nivel de referencia **300 Bq/m³** (lugares de trabajo y edificios públicos)
- **Norma interna:** PE-CYE-39
- **Periodo exposición:** 3 meses aprox. (90–100 días)
- **Procesado:** lectura en microscopio en el laboratorio (20–23 días después de recogida)
- **Informe:** membrete CYE + tabla de resultados por detector + reportaje fotográfico + planos

### Casos de uso conocidos

| Proyecto | OT | Detectores | Edificios | Complejidad |
|---|---|---|---|---|
| Bazar Chino Callao (Ferrol) | 26/0018 | 3 | 1 planta, 1 edificio | Mínima |
| Compañía de María (A Coruña) | 26/00144 | 47 | 6 pabellones, 2 plantas | Alta |
| Bordado Point (Monterroso) | 26/00179 | ? | TBD | TBD |

### Decisiones clave

1. **Radón es un servicio independiente**, no control de calidad de obra. No requiere crear un
   "Proyecto" de obra. Tendrá su propia sección en la sidebar (futura Fase A-4).
2. **Posiciones de detectores son prefijadas** por técnico cualificado en despacho (no in-situ).
   El plano con posiciones se prepara en CAD y se adjunta como imagen; la app no genera planos.
3. **El técnico en campo usa el móvil** (Telegram bot). No se espera que lleve tablet/portátil.
4. **Intercambio app↔bot vía JSON** — el bot genera un archivo JSON estructurado que se importa
   en Electron. No requiere servidor ni API en tiempo real.
5. **Fotos del bot** se reciben como archivos descargados del servidor de Telegram y se vinculan
   al detector correspondiente por número de posición.

---

## Fases y estado

### Fase A — Electron: modelo de datos y UI básica ✅ COMPLETADA (2026-06-23)

- [x] Tipo `radon_trazas` en `src/main/pipeline/ensayos.ts` (TIPOS + interfaces + `computeRadon()`)
- [x] Espejo `radonSummary()` en `src/renderer/src/lib/ensayoCalc.ts`
- [x] UI completa en `src/renderer/src/pages/Ensayos.tsx`:
  - Grupo "Radón (trazas CR-39)" en el selector de nuevo ensayo (color violeta)
  - Sección metadatos (fechas, duración, parámetros analíticos)
  - Sección lotes opcionales (para campañas con periodos distintos)
  - Tabla de detectores: añadir de 1 en 1 o en bulk (N filas)
  - Campos: código, edificio, planta, ubicación, extraviado, saturado, exposición, RAC, incertidumbres
  - Color coding en tiempo real: gris=extraviado, naranja=saturado, amarillo=excede 300 Bq/m³
  - Resumen live: n_total, n_extraviados, n_saturados, n_exceden, RAC min/max/media, veredicto
- [x] Estilos `.radon-row-*` en `Ensayos.css`
- [x] Formatter Word `src/main/pipeline/formatter/radonWordTemplate.ts`:
  - Página 1: cabecera membrete + objeto del ensayo (norma, nº detectores, instalación, periodo)
  - Página 2+: metadatos (fechas, error fab., umbral, límite), tabla de resultados, especificaciones RD
- [x] Dispatch en `src/main/pipeline/informes.ts`

---

### Fase A-2 — Electron: fotos y planos adjuntos ⏳ PENDIENTE

**Objetivo:** el informe Word incluya el reportaje fotográfico tal y como aparece en los informes
reales de CYE (foto de cada detector con su número y ubicación).

#### Modelo de datos
- Añadir campo `foto_path: string | null` a `RadonDetector` (ya reservado en el tipo)
- Añadir array `planos: { id, titulo, imagen_path }[]` en los datos del ensayo (ya reservado)
- Las rutas son absolutas en local; al exportar Word se leen como Buffer

#### UI (cambios en `RadonForm`)
- Botón "📎 Foto" por fila de detector → abre diálogo de archivo → guarda ruta absoluta
- Thumbnail 60×60 px si hay foto adjunta; icono vacío si no
- Sección "Planos" al final: lista de planos adjuntos por edificio/zona con botón para adjuntar imagen/PDF

#### Word (cambios en `radonWordTemplate.ts`)
- Página de fotos: grid 2×N con cada foto + nº detector + código + ubicación debajo
- Sección de planos al final (una página por edificio si hay imagen adjunta)
- Si no hay fotos: mantener el texto "A continuación se presenta el reportaje fotográfico…" como aviso

#### IPC necesario
- `api.pickFile(filters)` — ya existe en la app (verificar)
- Leer imagen en `radonWordTemplate.ts` con `readFileSync(path)` → ya usado en otros formatters

---

### Fase B — Bot de Telegram standalone ✅ COMPLETADA (2026-06-23)

**Objetivo:** bot que guía al técnico detector a detector en campo, recoge datos y fotos, y
genera al final un JSON importable en Electron. Sin servidor propio, sin conexión directa con
la app.

#### Stack técnico
- **`node-telegram-bot-api`** o **`telegraf`** (npm) — bot puro Node.js
- Almacenamiento local: un directorio `~/radon-bot-sessions/` con una carpeta por campaña
- Sin base de datos — estado de la conversación en memoria (Map<chatId, SessionState>)
- Descarga de fotos desde Telegram → archivo local en la sesión
- Al finalizar: genera `radon_data.json` + carpeta `fotos/` → el técnico lo envía por email o Telegram

#### Flujo de conversación (draft)

```
/nueva_campana
  → Bot pregunta: "¿Código de la campaña / referencia de obra?"
  → Bot pregunta: "¿Nombre del edificio o local?"
  → Bot pregunta: "¿Fecha de instalación? (dd/mm/aaaa)"
  → Confirma → crea sesión

/detector <N>   (o bot pregunta secuencialmente)
  → "Detector nº {N}: ¿Código? (ej. GJ3302)"
  → "¿Edificio/zona?"
  → "¿Planta?" [botones: -2 / -1 / 0 / 1 / 2 / Otro]
  → "¿Descripción de ubicación?"
  → "Manda la foto del detector instalado"  [espera foto]
  → Confirma resumen: "Detector 1 · GJ3302 · Planta 0 · Entrada caja · ✓ foto"

/siguiente   → siguiente detector
/extraviado  → marca el detector actual como extraviado (sin foto)
/fin         → genera JSON y envía el archivo al técnico
```

#### JSON generado (formato importable en Electron)
```json
{
  "version": 1,
  "tipo": "radon_trazas",
  "metadata": {
    "referencia": "26/0018",
    "edificio": "Bazar Chino Callao",
    "fecha_instalacion": "2026-01-12",
    "instalacion_cye": true
  },
  "detectores": [
    {
      "n": 1,
      "codigo": "GJ3302",
      "edificio": "Pabellón hockey",
      "planta": "Planta 0",
      "ubicacion": "Zona entrada caja",
      "extraviado": false,
      "foto_filename": "det_001_GJ3302.jpg"
    }
  ],
  "fotos_dir": "fotos/"
}
```

#### Archivos del bot (`radon-bot/`)
```
radon-bot/
  src/
    index.ts        ← entrada, instancia Telegraf
    session.ts      ← SessionState en memoria (Map<chatId, BotSession>)
    handlers.ts     ← todos los comandos, callbacks y mensajes
    exporter.ts     ← genera JSON + zip con fotos
    types.ts        ← interfaces compartidas (contrato con Electron)
  package.json      ← dependencias: telegraf, dotenv, axios, archiver
  tsconfig.json
  .env              ← TELEGRAM_BOT_TOKEN (no comitear)
  .env.example
```

**Arranque:** `cd radon-bot && cp .env.example .env && npm run dev`

---

### Fase C — Electron: importar JSON del bot ✅ COMPLETADA (2026-06-23)

**Objetivo:** desde el ensayo de radón en Electron, importar el JSON generado por el bot
(detectores + fotos) con un botón "Importar desde bot".

#### Implementado
- IPC handler `radon:importJson` en `src/main/ipc.ts`:
  - Abre diálogo de archivo filtrando `.json`
  - Valida `version === 1 && tipo === 'radon_trazas'`
  - Copia fotos de `{jsonDir}/fotos/` → `userData/radon-fotos/{timestamp}/`
  - Devuelve `{ data, fotoMap }` donde `fotoMap` mapea `foto_filename → ruta_local`
- API bridge `importRadonJson()` en `src/preload/api.ts`
- Botón "📥 Importar desde bot" en la cabecera de la sección Detectores de `RadonForm`:
  - Merge inteligente: busca detector existente por `codigo` o `n`, preserva resultados RAC ya introducidos
  - Rellena solo los campos de metadatos vacíos (fecha_inicio, instalacion_cye)
  - Banner verde/rojo con resultado de la importación (nº detectores + fotos importadas)

---

### Fase A-4 — Sidebar independiente ✅ COMPLETADA (2026-06-23)

Radón vive ahora en su propia pestaña `/radon` en la sidebar (icono átomo), completamente
independiente de "Proyectos". Las campañas se guardan en la tabla `ensayos` con `obra_id = NULL`.

- Migración v8: tabla `ensayos` recreada con `obra_id` nullable (SQLite recreate pattern)
- `getEnsayos(null, 'radon_trazas')` devuelve campañas sin obra asociada
- `saveEnsayo(null, input)` crea campañas standalone
- `Radon.tsx`: página propia con lista + editor + export Word
- `EnsayoCard`, `EnsayoEditor`, `defaultRadonDatos`, `WORD_TIPOS` exportados de `Ensayos.tsx`
- Export Word con obra vacía cuando `obra_id` es null (los formatters ya manejan campos vacíos)
- La sección "Ensayos" sigue soportando `radon_trazas` vinculado a obras (control de calidad)

---

## Orden de ejecución recomendado

1. ~~**Fase A** — Electron básico~~ ✅ Hecho
2. ~~**Fase B** — Bot Telegram standalone~~ ✅ Hecho
3. ~~**Fase C** — Importar JSON del bot en Electron~~ ✅ Hecho (ciclo cerrado)
4. ~~**Fase A-4** — Sidebar independiente~~ ✅ Hecho
5. **Fase A-2** — Planos de planta (adjuntar imagen de plano por edificio en app + Word) ⏳ PENDIENTE

---

## Notas regulatorias (referencia rápida)

| Norma | Aplica a | Límite |
|---|---|---|
| RD 1029/2022 + IS-47 CSN | Lugares de trabajo | 300 Bq/m³ |
| RD 732/2019 + HS-6 CTE | Edificios de nueva construcción | 300 Bq/m³ |
| ISO 11665-4 | Método de medida (trazas pasivas) | — |
| PE-CYE-39 | Procedimiento interno CYE | — |

- **Detección mínima:** 7 Bq/m³
- **Umbral de decisión:** 3 Bq/m³
- **Error de equipo (fabricante):** 7 %
- **k=2** para incertidumbre expandida (≈95% confianza distribución normal)
- **Saturación del detector:** exposición >2.200 kBq·h/m² → RAC real >1.000 Bq/m³ desconocida
