import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto'
const key = (secret: string) => {
  if (secret.length < 32) throw new Error('notification_key_unavailable')
  return createHash('sha256')
    .update('aircheck.telegram.v1\0' + secret)
    .digest()
}
export function encryptToken(token: string, secret: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key(secret), iv)
  const content = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), content]
    .map((b) => b.toString('base64url'))
    .join('.')
}
export function decryptToken(value: string, secret: string) {
  const [iv, tag, content] = value
    .split('.')
    .map((v) => Buffer.from(v, 'base64url'))
  const cipher = createDecipheriv('aes-256-gcm', key(secret), iv)
  cipher.setAuthTag(tag)
  return Buffer.concat([cipher.update(content), cipher.final()]).toString(
    'utf8',
  )
}
export type TelegramTransport = (
  token: string,
  chat: string,
  message: string,
) => Promise<void>
export const sendTelegram: TelegramTransport = async (token, chat, text) => {
  try {
    let base = 'https://api.telegram.org'
    if (
      process.env.AIRCHECK_E2E === '1' &&
      process.env.AIRCHECK_TELEGRAM_TEST_URL
    ) {
      const url = new URL(process.env.AIRCHECK_TELEGRAM_TEST_URL)
      if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1')
        throw new Error('invalid_test_transport')
      base = url.origin
    }
    const response = await fetch(base + '/bot' + token + '/sendMessage', {
      method: 'POST',
      signal: AbortSignal.timeout(5000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chat,
        text,
        disable_web_page_preview: true,
      }),
    })
    const result = await response.json()
    if (!response.ok || result.ok !== true) throw new Error('delivery_failed')
  } catch {
    throw new Error('telegram_unavailable')
  } // Never propagate a URL containing the bot token.
}
