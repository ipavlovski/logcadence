import { closeSync, createReadStream, openSync, readSync, fstatSync, writeSync } from 'node:fs'
import type { Writable } from 'node:stream'
import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib'

// Minimal zip reader for chat exports (Claude data export, Google Takeout) and GPS archives. Reads the central
// directory and only the members asked for, so multi-GB Takeout archives stay cheap to probe.
// ZipWriter (below) streams the data exports, which run to many GB.

export interface ZipMember {
  name: string
  size: number
  read(): Buffer
  /** Writes the member to a file in chunks, so large stored members never sit in memory. */
  extractTo(file: string): void
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

const CHUNK = 1 << 20

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
    const dataStart = () => {
      const head = src.read(offset, 30)
      return offset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28)
    }
    const read = () => {
      const data = src.read(dataStart(), compSize)
      if (method === 0) return Buffer.from(data)
      if (method === 8) return inflateRawSync(data)
      throw new Error(`${name}: unsupported zip compression ${method}`)
    }
    out.push({
      name,
      size,
      read,
      extractTo(file) {
        const fd = openSync(file, 'w')
        try {
          if (method !== 0) writeSync(fd, read())
          else
            for (let pos = dataStart(), end = pos + compSize; pos < end; ) {
              const chunk = src.read(pos, Math.min(CHUNK, end - pos))
              if (!chunk.length) throw new Error(`${name}: truncated zip`)
              writeSync(fd, chunk)
              pos += chunk.length
            }
        } finally {
          closeSync(fd)
        }
      },
    })
  }
  return out
}

// ── writer ──────────────────────────────────────────────────────────────────

/**
 * Streaming zip writer. Every member uses the zip64 fields (sizes in a trailing data descriptor, 64-bit
 * sizes and offsets in the central directory), so archives past 4 GB need no special case.
 */
export class ZipWriter {
  private offset = 0
  private central: Buffer[] = []
  private count = 0

  constructor(private out: Writable) {}

  /** Adds an in-memory member, deflated unless `store` is set. */
  async add(name: string, data: Buffer, { store = false } = {}) {
    const body = store ? data : deflateRawSync(data)
    const start = await this.header(name, store ? 0 : 8)
    await this.write(body)
    await this.trailer(name, store ? 0 : 8, start, crc32(data), body.length, data.length)
  }

  /** Adds a file from disk, stored (media is already compressed) and streamed in chunks. Returns its size. */
  async addFile(name: string, file: string): Promise<number> {
    const start = await this.header(name, 0)
    let crc = 0
    let size = 0
    for await (const chunk of createReadStream(file, { highWaterMark: CHUNK }) as AsyncIterable<Buffer>) {
      crc = crc32(chunk, crc)
      size += chunk.length
      await this.write(chunk)
    }
    await this.trailer(name, 0, start, crc, size, size)
    return size
  }

  /** Writes the central directory and ends the output stream. */
  async finish() {
    const cdOffset = this.offset
    for (const rec of this.central) await this.write(rec)
    const cdSize = this.offset - cdOffset
    const eocd64Offset = this.offset

    const eocd64 = Buffer.alloc(56)
    eocd64.writeUInt32LE(0x06064b50, 0)
    eocd64.writeBigUInt64LE(44n, 4) // size of the rest of the record
    eocd64.writeUInt16LE(45, 12) // version made by
    eocd64.writeUInt16LE(45, 14) // version needed
    eocd64.writeBigUInt64LE(BigInt(this.count), 24)
    eocd64.writeBigUInt64LE(BigInt(this.count), 32)
    eocd64.writeBigUInt64LE(BigInt(cdSize), 40)
    eocd64.writeBigUInt64LE(BigInt(cdOffset), 48)

    const locator = Buffer.alloc(20)
    locator.writeUInt32LE(0x07064b50, 0)
    locator.writeBigUInt64LE(BigInt(eocd64Offset), 8)
    locator.writeUInt32LE(1, 16) // total disks

    const eocd = Buffer.alloc(22)
    eocd.writeUInt32LE(0x06054b50, 0)
    eocd.writeUInt16LE(0xffff, 8)
    eocd.writeUInt16LE(0xffff, 10)
    eocd.writeUInt32LE(0xffffffff, 12)
    eocd.writeUInt32LE(0xffffffff, 16)

    await this.write(Buffer.concat([eocd64, locator, eocd]))
    await new Promise<void>((resolve, reject) => this.out.end((err?: Error | null) => (err ? reject(err) : resolve())))
  }

  private async header(name: string, method: number): Promise<number> {
    const start = this.offset
    const nameBuf = Buffer.from(name, 'utf8')
    const h = Buffer.alloc(30)
    h.writeUInt32LE(0x04034b50, 0)
    h.writeUInt16LE(45, 4) // version needed: zip64
    h.writeUInt16LE(0x0808, 6) // sizes in data descriptor | utf-8 names
    h.writeUInt16LE(method, 8)
    h.writeUInt32LE(DOS_TIME, 10)
    h.writeUInt16LE(nameBuf.length, 26)
    h.writeUInt16LE(20, 28)
    // Zip64 extra with zero sizes: tells readers the data descriptor carries 64-bit sizes.
    const extra = Buffer.alloc(20)
    extra.writeUInt16LE(1, 0)
    extra.writeUInt16LE(16, 2)
    await this.write(Buffer.concat([h, nameBuf, extra]))
    return start
  }

  private async trailer(name: string, method: number, start: number, crc: number, compSize: number, size: number) {
    const dd = Buffer.alloc(24)
    dd.writeUInt32LE(0x08074b50, 0)
    dd.writeUInt32LE(crc, 4)
    dd.writeBigUInt64LE(BigInt(compSize), 8)
    dd.writeBigUInt64LE(BigInt(size), 16)
    await this.write(dd)

    const nameBuf = Buffer.from(name, 'utf8')
    const c = Buffer.alloc(46)
    c.writeUInt32LE(0x02014b50, 0)
    c.writeUInt16LE(45, 4)
    c.writeUInt16LE(45, 6)
    c.writeUInt16LE(0x0808, 8)
    c.writeUInt16LE(method, 10)
    c.writeUInt32LE(DOS_TIME, 12)
    c.writeUInt32LE(crc, 16)
    c.writeUInt32LE(0xffffffff, 20)
    c.writeUInt32LE(0xffffffff, 24)
    c.writeUInt16LE(nameBuf.length, 28)
    c.writeUInt16LE(28, 30)
    c.writeUInt32LE(0xffffffff, 42)
    const extra = Buffer.alloc(28)
    extra.writeUInt16LE(1, 0)
    extra.writeUInt16LE(24, 2)
    extra.writeBigUInt64LE(BigInt(size), 4)
    extra.writeBigUInt64LE(BigInt(compSize), 12)
    extra.writeBigUInt64LE(BigInt(start), 20)
    this.central.push(Buffer.concat([c, nameBuf, extra]))
    this.count++
  }

  private write(buf: Buffer): Promise<void> {
    this.offset += buf.length
    if (this.out.write(buf)) return Promise.resolve()
    return new Promise((resolve, reject) => {
      const done = (err?: Error) => {
        this.out.off('drain', done)
        this.out.off('error', done)
        if (err) reject(err)
        else resolve()
      }
      this.out.once('drain', done)
      this.out.once('error', done)
    })
  }
}

// Fixed timestamp (2000-01-01 00:00): member dates carry no meaning in an export.
const DOS_TIME = ((2000 - 1980) << 25) | (1 << 21) | (1 << 16)
