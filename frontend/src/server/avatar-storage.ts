import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const AVATAR_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const AVATAR_URL_PREFIX = '/api/profile/avatar/'

export function getAvatarStorageDirectory(): string {
  return process.env.AVATAR_STORAGE_PATH?.trim() || join(process.cwd(), '.data', 'avatars')
}

function userFilePrefix(userId: string): string {
  return `${createHash('sha256').update(userId).digest('hex')}-`
}

function avatarFilePath(userId: string, avatarId: string, directory = getAvatarStorageDirectory()): string {
  if (!AVATAR_ID_PATTERN.test(avatarId)) throw new Error('Invalid avatar identifier')
  return join(directory, `${userFilePrefix(userId)}${avatarId}.webp`)
}

export function avatarImageUrl(avatarId: string): string {
  if (!AVATAR_ID_PATTERN.test(avatarId)) throw new Error('Invalid avatar identifier')
  return `${AVATAR_URL_PREFIX}${avatarId}`
}

export function avatarIdFromImageUrl(imageUrl: string | null | undefined): string | null {
  if (!imageUrl?.startsWith(AVATAR_URL_PREFIX)) return null
  const avatarId = imageUrl.slice(AVATAR_URL_PREFIX.length)
  return AVATAR_ID_PATTERN.test(avatarId) ? avatarId : null
}

export async function storeAvatar(userId: string, avatarId: string, contents: Uint8Array): Promise<void> {
  const directory = getAvatarStorageDirectory()
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const target = avatarFilePath(userId, avatarId, directory)
  const temporary = `${target}.${randomUUID()}.tmp`

  try {
    await writeFile(temporary, contents, { flag: 'wx', mode: 0o600 })
    await rename(temporary, target)
  } finally {
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
    })
  }
}

export async function readAvatar(userId: string, avatarId: string): Promise<Buffer> {
  return readFile(avatarFilePath(userId, avatarId))
}

export async function removeAvatar(userId: string, avatarId: string): Promise<void> {
  await unlink(avatarFilePath(userId, avatarId)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error
  })
}

export async function removeUserAvatars(userId: string): Promise<void> {
  const directory = getAvatarStorageDirectory()
  let files: string[]
  try {
    files = await readdir(directory)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }

  const prefix = userFilePrefix(userId)
  await Promise.all(files
    .filter((file) => file.startsWith(prefix) && file.endsWith('.webp'))
    .map((file) => unlink(join(directory, file))))
}
