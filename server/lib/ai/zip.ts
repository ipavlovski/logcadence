import { closeSync, openSync, readSync, fstatSync } from 'node:fs'
import { inflateRawSync } from 'node:zlib'

// Minimal zip reader for chat exports (Claude's data export, Google Takeout). Reads the central
// directory and only the members asked for, so multi-GB Takeout archives stay cheap to probe.

export interface ZipMember {
  name: string
  size: number
  read(): Buffer
}

type Source = { size: number; read(pos: number, len: number): Buffer; close(): void }

function fileSource(file: string): Source {
  const fd = openSync(file, 'r')
  return {
    size: fstatSync(fd).size,
    read(pos, len) {
      const buf = Buffer.alloc(len)
      const n = readSync(fd, buf, 0, len, pos)
      return buf.subarray(0, n)
    },
    close: () => closeSync(fd),
  }
}

function bufferSource(buf: Buffer): Source {
  return { size: buf.length, read: (pos, len) => buf.subarray(pos, pos + len), close() {} }
}

export const isZip = (buf: Buffer) => buf.length >= 4 && buf.readUInt32LE(0) === 0x04034b50

/** Lists a zip's members (file path or in-memory buffer). Throws if it is not a zip. */
export function withZip<T>(input: string | Buffer, fn: (members: ZipMember[]) => T): T {
  const src = typeof input === 'string' ? fileSource(input) : bufferSource(input)
  try {
    return fn(members(src))
  } finally {
    src.close()
  }
}

function members(src: Source): ZipMember[] {
  // End of central directory: last 22 bytes plus up to 64k of comment.
  const tailLen = Math.min(src.size, 22 + 0xffff)
  const tail = src.read(src.size - tailLen, tailLen)
  let eocd = -1
  for (let i = tail.length - 22; i >= 0; i--)
    if (tail.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  if (eocd < 0) throw new Error('not a zip file')
  let count = tail.readUInt16LE(eocd + 10)
  let cdSize = tail.readUInt32LE(eocd + 12)
  let cdOffset = tail.readUInt32LE(eocd + 16)
  // Zip64: the real values live in the zip64 end record (Takeout archives are often > 4GB).
  const loc = eocd - 20
  if (loc >= 0 && tail.readUInt32LE(loc) === 0x07064b50) {
    const recPos = Number(tail.readBigUInt64LE(loc + 8))
    const rec = src.read(recPos, 56)
    count = Number(rec.readBigUInt64LE(32))
    cdSize = Number(rec.readBigUInt64LE(40))
    cdOffset = Number(rec.readBigUInt64LE(48))
  }

  const cd = src.read(cdOffset, cdSize)
  const out: ZipMember[] = []
  for (let p = 0, i = 0; i < count && p + 46 <= cd.length; i++) {
    if (cd.readUInt32LE(p) !== 0x02014b50) break
    const method = cd.readUInt16LE(p + 10)
    let compSize = cd.readUInt32LE(p + 20)
    let size = cd.readUInt32LE(p + 24)
    const nameLen = cd.readUInt16LE(p + 28)
    const extraLen = cd.readUInt16LE(p + 30)
    const commentLen = cd.readUInt16LE(p + 32)
    let offset = cd.readUInt32LE(p + 42)
    const name = cd.subarray(p + 46, p + 46 + nameLen).toString('utf8')
    // Zip64 extra field: 64-bit values replace the ones set to 0xffffffff, in this order.
    for (let e = p + 46 + nameLen; e + 4 <= p + 46 + nameLen + extraLen; ) {
      const id = cd.readUInt16LE(e)
      const len = cd.readUInt16LE(e + 2)
      if (id === 1) {
        let q = e + 4
        if (size === 0xffffffff) (size = Number(cd.readBigUInt64LE(q)), (q += 8))
        if (compSize === 0xffffffff) (compSize = Number(cd.readBigUInt64LE(q)), (q += 8))
        if (offset === 0xffffffff) offset = Number(cd.readBigUInt64LE(q))
      }
      e += 4 + len
    }
    p += 46 + nameLen + extraLen + commentLen
    if (name.endsWith('/')) continue
    out.push({
      name,
      size,
      read() {
        const head = src.read(offset, 30)
        const start = offset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28)
        const data = src.read(start, compSize)
        if (method === 0) return Buffer.from(data)
        if (method === 8) return inflateRawSync(data)
        throw new Error(`${name}: unsupported zip compression ${method}`)
      },
    })
  }
  return out
}
