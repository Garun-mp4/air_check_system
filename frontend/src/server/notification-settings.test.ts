import { describe, it, expect } from 'vitest'
import {
  parseNotificationSettings,
  publicNotificationSettings,
} from './notifications'
describe('notification configuration boundary', () => {
  it('never serializes the encrypted credential or an incidental DB column', () => {
    const data = publicNotificationSettings({
      enabled: false,
      co2_duration_seconds: 300,
      offline_duration_seconds: 60,
      suppression_seconds: 900,
      telegram_chat_id: '-10042',
      token_ciphertext: 'secret-cipher',
    })
    expect(data).toMatchObject({
      token_configured: true,
      telegram_chat_id: '-10042',
    })
    expect(JSON.stringify(data)).not.toContain('secret-cipher')
    expect(data).not.toHaveProperty('token_ciphertext')
  })
  it.each([
    { enabled: 'true' },
    { co2_duration_seconds: 0 },
    { suppression_seconds: -1 },
    { telegram_chat_id: '@someone' },
    { bot_token: 'malformed' },
    { token_ciphertext: 'injected' },
    { clear_token: true, bot_token: '123456:' + 'x'.repeat(32) },
  ])('rejects invalid settings %j', (body) =>
    expect(() => parseNotificationSettings(body)).toThrow(),
  )
})
