import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AVATAR_MAX_UPLOAD_BYTES } from '../../../../lib/avatar-image'

const state = vi.hoisted(() => ({
  user: null as { id: string; image: string | null } | null,
  updateUser: vi.fn(),
  storeAvatar: vi.fn(),
  removeAvatar: vi.fn(),
  readAvatar: vi.fn(),
}))

vi.mock('../../../../server/auth', () => ({
  getAuth: () => ({
    api: {
      getSession: async () => state.user ? { user: state.user } : null,
      updateUser: state.updateUser,
    },
  }),
}))

vi.mock('../../../../server/avatar-storage', () => ({
  avatarIdFromImageUrl: (imageUrl: string | null) => {
    const match = imageUrl?.match(/^\/api\/profile\/avatar\/([0-9a-f-]{36})$/i)
    return match?.[1] ?? null
  },
  avatarImageUrl: (avatarId: string) => `/api/profile/avatar/${avatarId}`,
  readAvatar: state.readAvatar,
  removeAvatar: state.removeAvatar,
  storeAvatar: state.storeAvatar,
}))

import { DELETE, POST } from './route'
import { GET } from './[avatarId]/route'

const originHeaders = {
  origin: 'https://aircheck.example',
  host: 'aircheck.example',
  'x-forwarded-host': 'aircheck.example',
  'x-forwarded-proto': 'https',
}
const currentAvatarId = '8f477503-d23c-47e3-85c3-11f9e9543bc7'
const oldAvatarId = 'da172402-7033-44db-9913-0c41b2a9ed4c'

function validAvatar(): Uint8Array {
  const bytes = new Uint8Array(44)
  const view = new DataView(bytes.buffer)
  const text = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) bytes[offset + index] = value.charCodeAt(index)
  }
  text(0, 'RIFF')
  view.setUint32(4, bytes.byteLength - 8, true)
  text(8, 'WEBP')
  text(12, 'VP8X')
  view.setUint32(16, 10, true)
  bytes[24] = 0xff
  bytes[25] = 0x01
  bytes[27] = 0xff
  bytes[28] = 0x01
  text(30, 'VP8L')
  view.setUint32(34, 5, true)
  bytes[38] = 0x2f
  bytes[39] = 0xff
  bytes[40] = 0xc1
  bytes[41] = 0x7f
  bytes[42] = 0
  return bytes
}

function uploadRequest(options: { user?: boolean; origin?: string; contentType?: string; body?: Uint8Array } = {}): Request {
  if ('user' in options) state.user = options.user ? { id: 'user-1', image: null } : null
  const payload = options.body ?? validAvatar()
  const body = new Uint8Array(new ArrayBuffer(payload.byteLength))
  body.set(payload)
  return new Request('https://aircheck.example/api/profile/avatar', {
    method: 'POST',
    headers: {
      ...originHeaders,
      origin: options.origin ?? originHeaders.origin,
      'content-type': options.contentType ?? 'image/webp',
    },
    body,
  })
}

function successfulAuthResponse(): Response {
  return new Response(JSON.stringify({ status: true }), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'set-cookie': 'better-auth.session_token=refreshed; Path=/; HttpOnly; SameSite=Lax',
    },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  state.user = { id: 'user-1', image: null }
  state.updateUser.mockResolvedValue(successfulAuthResponse())
  state.storeAvatar.mockResolvedValue(undefined)
  state.removeAvatar.mockResolvedValue(undefined)
  state.readAvatar.mockResolvedValue(Buffer.from('webp image'))
})

describe('profile avatar upload and removal routes', () => {
  it('requires an authenticated session and a same-origin request', async () => {
    const guestResponse = await POST(uploadRequest({ user: false }))
    expect(guestResponse.status).toBe(401)

    const crossOriginResponse = await POST(uploadRequest({ origin: 'https://attacker.example' }))
    expect(crossOriginResponse.status).toBe(403)
    expect(state.storeAvatar).not.toHaveBeenCalled()
  })

  it('rejects non-WebP and malformed/non-square image bodies before writing files', async () => {
    const unsupported = await POST(uploadRequest({ contentType: 'image/png' }))
    expect(unsupported.status).toBe(415)

    const malformed = await POST(uploadRequest({ body: new Uint8Array(44) }))
    expect(malformed.status).toBe(400)
    expect(state.storeAvatar).not.toHaveBeenCalled()
    expect(state.updateUser).not.toHaveBeenCalled()
  })

  it('bounds the processed image body before buffering it in memory', async () => {
    const response = await POST(uploadRequest({ body: new Uint8Array(AVATAR_MAX_UPLOAD_BYTES + 1) }))
    expect(response.status).toBe(413)
    expect(state.storeAvatar).not.toHaveBeenCalled()
  })

  it('stores the processed square image, updates Better Auth, and forwards refreshed session cookies', async () => {
    state.user = { id: 'user-1', image: `/api/profile/avatar/${oldAvatarId}` }
    const response = await POST(uploadRequest())
    const body = await response.json()
    const storedId = state.storeAvatar.mock.calls[0]?.[1]

    expect(response.status).toBe(200)
    expect(body.data.image).toBe(`/api/profile/avatar/${storedId}`)
    expect(response.headers.get('set-cookie')).toContain('better-auth.session_token=refreshed')
    expect(state.storeAvatar).toHaveBeenCalledWith('user-1', expect.any(String), expect.any(Buffer))
    expect(state.updateUser).toHaveBeenCalledWith(expect.objectContaining({
      body: { image: `/api/profile/avatar/${storedId}` },
      asResponse: true,
    }))
    expect(state.removeAvatar).toHaveBeenCalledWith('user-1', oldAvatarId)
  })

  it('removes the newly stored file if Better Auth rejects the profile update', async () => {
    state.updateUser.mockResolvedValue(new Response(JSON.stringify({ message: 'rejected' }), { status: 400 }))
    const response = await POST(uploadRequest())

    expect(response.status).toBe(400)
    expect(state.removeAvatar).toHaveBeenCalledWith('user-1', state.storeAvatar.mock.calls[0]?.[1])
  })

  it('clears the profile image before removing its stored file', async () => {
    state.user = { id: 'user-1', image: `/api/profile/avatar/${oldAvatarId}` }
    const response = await DELETE(new Request('https://aircheck.example/api/profile/avatar', {
      method: 'DELETE',
      headers: originHeaders,
    }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: { image: null } })
    expect(state.updateUser).toHaveBeenCalledWith(expect.objectContaining({ body: { image: null } }))
    expect(state.removeAvatar).toHaveBeenCalledWith('user-1', oldAvatarId)
    expect(response.headers.get('set-cookie')).toContain('better-auth.session_token=refreshed')
  })
})

describe('private profile avatar read route', () => {
  it('serves the active image only to its signed-in owner', async () => {
    state.user = { id: 'user-1', image: `/api/profile/avatar/${currentAvatarId}` }
    const request = new Request(`https://aircheck.example/api/profile/avatar/${currentAvatarId}`)
    const response = await GET(request, { params: Promise.resolve({ avatarId: currentAvatarId }) })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/webp')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(state.readAvatar).toHaveBeenCalledWith('user-1', currentAvatarId)
  })

  it('returns 404 for another or stale avatar id and 401 to guests', async () => {
    state.user = { id: 'user-1', image: `/api/profile/avatar/${currentAvatarId}` }
    const staleResponse = await GET(new Request('https://aircheck.example/api/profile/avatar/stale'), {
      params: Promise.resolve({ avatarId: oldAvatarId }),
    })
    expect(staleResponse.status).toBe(404)
    expect(state.readAvatar).not.toHaveBeenCalled()

    state.user = null
    const guestResponse = await GET(new Request('https://aircheck.example/api/profile/avatar/any'), {
      params: Promise.resolve({ avatarId: currentAvatarId }),
    })
    expect(guestResponse.status).toBe(401)
  })
})
