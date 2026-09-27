import { describe, expect, it } from 'vitest'

import { parseTrustedOrigins } from './trusted-origins'

describe('Better Auth trusted origin configuration', () => {
  it('parses, trims, and de-duplicates comma-separated origins', () => {
    expect(parseTrustedOrigins(' https://aircheck.home.arpa, http://localhost:3000,https://aircheck.home.arpa ')).toEqual([
      'https://aircheck.home.arpa',
      'http://localhost:3000',
    ])
  })

  it('leaves Better Auth defaults active when no extra origins are configured', () => {
    expect(parseTrustedOrigins(undefined)).toBeUndefined()
    expect(parseTrustedOrigins(' ,  ')).toBeUndefined()
  })
})
