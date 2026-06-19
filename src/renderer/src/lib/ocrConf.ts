import { createContext, useContext, useCallback } from 'react'

export const OcrConfCtx = createContext<Record<string, string>>({})

/**
 * Returns a function `cc(key)` that produces the full className string for an input:
 * 'input' (no conf), 'input ocr-high', 'input ocr-mid', or 'input ocr-low'.
 * Call this inside any form component that lives under OcrConfCtx.Provider.
 */
export function useOcrConf(): (key: string) => string {
  const conf = useContext(OcrConfCtx)
  return useCallback(
    (key: string) => {
      const level = conf[key]
      if (level === 'high') return 'input ocr-high'
      if (level === 'mid') return 'input ocr-mid'
      if (level === 'low') return 'input ocr-low'
      return 'input'
    },
    [conf]
  )
}
