import { describe, expect, it } from 'vitest'

import { getAccessRoleLabel, isAccessInfo } from './access-types'

describe('shared account access data', () => {
  it('accepts the server access contract and rejects malformed roles', () => {
    expect(isAccessInfo({
      userId: null,
      email: null,
      name: null,
      role: 'guest',
      operatorExpiresAt: null,
    })).toBe(true)
    expect(isAccessInfo({ userId: 'user-1', role: 'owner' })).toBe(false)
    expect(isAccessInfo({ userId: 'user-1', email: null, name: null, role: 'root', operatorExpiresAt: null })).toBe(false)
    expect(isAccessInfo({ userId: null, email: null, name: null, role: 'owner', operatorExpiresAt: null })).toBe(false)
  })

  it('uses the same role names across application surfaces', () => {
    expect(getAccessRoleLabel('guest')).toBe('Гость')
    expect(getAccessRoleLabel('operator')).toBe('Оператор')
    expect(getAccessRoleLabel('owner')).toBe('Владелец установки')
  })
})
