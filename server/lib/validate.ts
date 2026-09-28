import { HTTPException } from 'hono/http-exception'
import { isIsoDate } from '../../shared/dates.ts'

export function bad(message: string): never {
  throw new HTTPException(400, { message })
}

export function notFound(what: string): never {
  throw new HTTPException(404, { message: `${what} not found` })
}

export type Obj = Record<string, unknown>

export function obj(v: unknown): Obj {
  if (!v || typeof v !== 'object' || Array.isArray(v)) bad('expected a JSON object')
  return v as Obj
}

export function str(o: Obj, k: string): string {
  const v = o[k]
  if (typeof v !== 'string') bad(`${k} must be a string`)
  return v
}

export function optStr(o: Obj, k: string): string | undefined {
  return o[k] === undefined ? undefined : str(o, k)
}

export function optBool(o: Obj, k: string): boolean | undefined {
  const v = o[k]
  if (v === undefined) return undefined
  if (typeof v !== 'boolean') bad(`${k} must be a boolean`)
  return v
}

export function optNum(o: Obj, k: string): number | undefined {
  const v = o[k]
  if (v === undefined) return undefined
  if (typeof v !== 'number' || !Number.isFinite(v)) bad(`${k} must be a number`)
  return v
}

export function num(o: Obj, k: string): number {
  return optNum(o, k) ?? bad(`${k} is required`)
}

export function optStrArr(o: Obj, k: string): string[] | undefined {
  const v = o[k]
  if (v === undefined) return undefined
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) bad(`${k} must be an array of strings`)
  return v as string[]
}

export function date(o: Obj, k: string): string {
  const v = str(o, k)
  if (!isIsoDate(v)) bad(`${k} must be a YYYY-MM-DD date`)
  return v
}

export function optDate(o: Obj, k: string): string | undefined {
  return o[k] === undefined ? undefined : date(o, k)
}

/** Keeps only the keys whose value is defined, so optional body fields stay optional in client types. */
export function defined<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T
}
