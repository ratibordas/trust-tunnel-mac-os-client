import { parse, stringify } from 'smol-toml'
import { validateConfig, type ClientConfig, type ValidationResult } from '@shared/schema'

/** Parse + validate a TOML string into a normalized ClientConfig. */
export function parseToml(text: string): ValidationResult {
  let raw: unknown
  try {
    raw = parse(text)
  } catch (err) {
    return {
      ok: false,
      issues: [{ path: '(toml)', message: `TOML parse error: ${(err as Error).message}` }]
    }
  }
  return validateConfig(raw)
}

/**
 * Serialize a validated config to TOML. We strip null/empty optionals that the
 * CLI defaults anyway, keeping the file readable. smol-toml rejects null, so we
 * drop null fields entirely.
 */
export function serializeToml(config: ClientConfig): string {
  const out = prune(structuredClone(config) as Record<string, unknown>)
  return stringify(out as Record<string, never>)
}

function prune(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) continue
    if (Array.isArray(value)) {
      result[key] = value
    } else if (typeof value === 'object') {
      const child = prune(value as Record<string, unknown>)
      if (Object.keys(child).length > 0) result[key] = child
    } else {
      result[key] = value
    }
  }
  return result
}
