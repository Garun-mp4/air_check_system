import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  avatarIdFromImageUrl,
  avatarImageUrl,
  readAvatar,
  removeAvatar,
  removeUserAvatars,
  storeAvatar,
} from './avatar-storage'

const avatarId = '8f477503-d23c-47e3-85c3-11f9e9543bc7'
const anotherAvatarId = 'da172402-7033-44db-9913-0c41b2a9ed4c'

describe('private avatar file storage', () => {
  const previousStoragePath = process.env.AVATAR_STORAGE_PATH
  let storageDirectory: string

  beforeEach(async () => {
    storageDirectory = await mkdtemp(join(tmpdir(), 'aircheck-avatar-'))
    process.env.AVATAR_STORAGE_PATH = storageDirectory
  })

  afterEach(async () => {
    if (previousStoragePath === undefined) delete process.env.AVATAR_STORAGE_PATH
    else process.env.AVATAR_STORAGE_PATH = previousStoragePath
    await rm(storageDirectory, { recursive: true, force: true })
  })

  it('round-trips an avatar for its owner and never resolves a different user to that file', async () => {
    const contents = Buffer.from('private webp bytes')
    await storeAvatar('user-1', avatarId, contents)

    await expect(readAvatar('user-1', avatarId)).resolves.toEqual(contents)
    await expect(readAvatar('user-2', avatarId)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(avatarImageUrl(avatarId)).toBe(`/api/profile/avatar/${avatarId}`)
    expect(avatarIdFromImageUrl(avatarImageUrl(avatarId))).toBe(avatarId)
    expect(avatarIdFromImageUrl('https://example.test/avatar.webp')).toBeNull()
  })

  it('rejects path-like identifiers before touching the filesystem', async () => {
    await expect(storeAvatar('user-1', '../avatar', Buffer.from('x'))).rejects.toThrow('Invalid avatar identifier')
    expect(() => avatarImageUrl('../../secret')).toThrow('Invalid avatar identifier')
  })

  it('removes replaced and deleted account avatars without affecting another account', async () => {
    await storeAvatar('user-1', avatarId, Buffer.from('old'))
    await storeAvatar('user-1', anotherAvatarId, Buffer.from('new'))
    await storeAvatar('user-2', avatarId, Buffer.from('other user'))

    await removeAvatar('user-1', avatarId)
    await expect(readAvatar('user-1', avatarId)).rejects.toMatchObject({ code: 'ENOENT' })
    await removeUserAvatars('user-1')

    await expect(readAvatar('user-2', avatarId)).resolves.toEqual(Buffer.from('other user'))
    await expect(readdir(storageDirectory)).resolves.toHaveLength(1)
  })

  it('ignores a missing storage directory when cleaning up an account', async () => {
    await rm(storageDirectory, { recursive: true, force: true })
    await expect(removeUserAvatars('user-1')).resolves.toBeUndefined()
  })
})
