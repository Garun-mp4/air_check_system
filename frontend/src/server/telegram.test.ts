import { describe, it, expect, vi, afterEach } from 'vitest'
import { encryptToken, decryptToken, sendTelegram } from './telegram'
const secret = 'test-encryption-key-' + 'x'.repeat(32)
afterEach(() => vi.unstubAllGlobals())
describe('Telegram credentials and transport', () => {
  it('encrypts with independent nonces and authenticates ciphertext/key', () => {
    const a = encryptToken('private-bot-token', secret),
      b = encryptToken('private-bot-token', secret)
    expect(a).not.toContain('private-bot-token')
    expect(a).not.toBe(b)
    expect(decryptToken(a, secret)).toBe('private-bot-token')
    expect(() => decryptToken(a, secret + 'other')).toThrow()
    expect(() => decryptToken(a + 'x', secret)).toThrow()
  })
  it('sends only to the supplied chat and sanitizes failed URL/body diagnostics', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    vi.stubGlobal('fetch', fetch)
    await sendTelegram('test-token', '-10042', 'Test')
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({
      chat_id: '-10042',
      text: 'Test',
    })
    fetch.mockRejectedValue(new Error('URL contains test-token'))
    await expect(sendTelegram('test-token', '-10042', 'Test')).rejects.toThrow(
      'telegram_unavailable',
    )
    fetch.mockResolvedValue({
      ok: false,
      json: async () => ({ ok: false, description: 'test-token' }),
    })
    await expect(sendTelegram('test-token', '-10042', 'Test')).rejects.toThrow(
      'telegram_unavailable',
    )
  })
})
