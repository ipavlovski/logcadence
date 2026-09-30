// Schema-less protobuf wire decoding. Antigravity stores conversation steps as protobuf blobs
// with no published .proto, so fields are addressed by number (see antigravity.ts).

export type Field = { n: number; wire: number; int?: bigint; bytes?: Buffer }

export function decode(buf: Buffer): Field[] | null {
  const out: Field[] = []
  let i = 0
  const varint = (): bigint | null => {
    let r = 0n
    for (let shift = 0n; i < buf.length; shift += 7n) {
      const b = buf[i++]!
      r |= BigInt(b & 0x7f) << shift
      if (b < 0x80) return r
      if (shift > 63n) return null
    }
    return null
  }
  while (i < buf.length) {
    const key = varint()
    if (key == null) return null
    const n = Number(key >> 3n)
    const wire = Number(key & 7n)
    if (n === 0) return null
    if (wire === 0) {
      const v = varint()
      if (v == null) return null
      out.push({ n, wire, int: v })
    } else if (wire === 2) {
      const len = varint()
      if (len == null || i + Number(len) > buf.length) return null
      out.push({ n, wire, bytes: buf.subarray(i, i + Number(len)) })
      i += Number(len)
    } else if (wire === 1 || wire === 5) {
      const len = wire === 1 ? 8 : 4
      if (i + len > buf.length) return null
      out.push({ n, wire, bytes: buf.subarray(i, i + len) })
      i += len
    } else return null
  }
  return out
}

/** Message view: look fields up by number, or by a path of numbers through nested messages. */
export class Msg {
  constructor(readonly fields: Field[]) {}

  static parse(buf: Buffer | null | undefined): Msg | null {
    const f = buf && decode(buf)
    return f ? new Msg(f) : null
  }

  all(n: number): Field[] {
    return this.fields.filter((f) => f.n === n)
  }

  msg(...path: number[]): Msg | null {
    let cur: Msg | null = this
    for (const n of path) cur = Msg.parse(cur?.all(n)[0]?.bytes)
    return cur
  }

  msgs(n: number): Msg[] {
    return this.all(n).flatMap((f) => Msg.parse(f.bytes) ?? [])
  }

  str(...path: number[]): string | undefined {
    const parent = path.length > 1 ? this.msg(...path.slice(0, -1)) : this
    return parent?.all(path.at(-1)!)[0]?.bytes?.toString('utf8')
  }

  int(...path: number[]): number | undefined {
    const parent = path.length > 1 ? this.msg(...path.slice(0, -1)) : this
    const v = parent?.all(path.at(-1)!)[0]?.int
    return v == null ? undefined : Number(v)
  }
}

/** google.protobuf.Timestamp {1: seconds, 2: nanos} → epoch ms. */
export function timestampMs(m: Msg | null): number | null {
  const s = m?.int(1)
  return s == null ? null : s * 1000 + Math.floor((m!.int(2) ?? 0) / 1e6)
}
