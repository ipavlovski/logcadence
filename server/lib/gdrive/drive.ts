import { accessToken } from './auth.ts'

// The few Drive v3 calls the GPS import needs. Shared drives are included.

const API = 'https://www.googleapis.com/drive/v3'
const FOLDER_MIME = 'application/vnd.google-apps.folder'

export class DriveError extends Error {}

export interface DriveFile {
  id: string
  name: string
  size: number
  modifiedTime: number // epoch ms
}

async function driveFetch(url: string): Promise<Response> {
  const token = await accessToken()
  if (!token) throw new DriveError('Google Drive is not connected')
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) {
    const json = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
    throw new DriveError(`Google Drive: ${json?.error?.message ?? `HTTP ${res.status}`}`)
  }
  return res
}

/** A folder ID from a Drive folder link (…/folders/<id>, ?id=<id>) or the bare ID. */
export function parseFolderId(input: string): string | null {
  const s = input.trim()
  const m = /\/folders\/([\w-]{10,})/.exec(s) ?? /[?&]id=([\w-]{10,})/.exec(s) ?? /^([\w-]{10,})$/.exec(s)
  return m?.[1] ?? null
}

export async function getFolder(id: string): Promise<{ id: string; name: string }> {
  const q = new URLSearchParams({ fields: 'id,name,mimeType', supportsAllDrives: 'true' })
  const f = (await (await driveFetch(`${API}/files/${encodeURIComponent(id)}?${q}`)).json()) as { id: string; name: string; mimeType: string }
  if (f.mimeType !== FOLDER_MIME) throw new DriveError(`“${f.name}” is not a folder`)
  return { id: f.id, name: f.name }
}

/** Files directly in the folder (not in subfolders, not trashed). */
export async function listFolder(folderId: string): Promise<DriveFile[]> {
  const out: DriveFile[] = []
  let pageToken: string | undefined
  do {
    const q = new URLSearchParams({
      q: `'${folderId.replace(/'/g, "\\'")}' in parents and trashed = false and mimeType != '${FOLDER_MIME}'`,
      fields: 'nextPageToken,files(id,name,size,modifiedTime)',
      pageSize: '1000',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
      ...(pageToken && { pageToken }),
    })
    const r = (await (await driveFetch(`${API}/files?${q}`)).json()) as { nextPageToken?: string; files: { id: string; name: string; size?: string; modifiedTime: string }[] }
    for (const f of r.files) out.push({ id: f.id, name: f.name, size: Number(f.size ?? 0), modifiedTime: Date.parse(f.modifiedTime) })
    pageToken = r.nextPageToken
  } while (pageToken)
  return out
}

export async function download(fileId: string): Promise<Buffer> {
  const res = await driveFetch(`${API}/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`)
  return Buffer.from(await res.arrayBuffer())
}
