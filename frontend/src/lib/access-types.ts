export type AccessRole = 'guest' | 'user' | 'operator' | 'owner'

export interface AccessInfo {
  userId: string | null
  email: string | null
  name: string | null
  image: string | null
  role: AccessRole
  operatorExpiresAt: string | null
}

const ACCESS_ROLES: ReadonlySet<string> = new Set(['guest', 'user', 'operator', 'owner'])

export function isAccessInfo(value: unknown): value is AccessInfo {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  const role = candidate.role
  const identityMatchesRole = role === 'guest'
    ? candidate.userId === null && candidate.email === null
    : typeof candidate.userId === 'string' && typeof candidate.email === 'string'

  return identityMatchesRole
    && (candidate.userId === null || typeof candidate.userId === 'string')
    && (candidate.email === null || typeof candidate.email === 'string')
    && (candidate.name === null || typeof candidate.name === 'string')
    && (candidate.image === null || typeof candidate.image === 'string')
    && typeof role === 'string'
    && ACCESS_ROLES.has(role)
    && (candidate.operatorExpiresAt === null || typeof candidate.operatorExpiresAt === 'string')
}

export function getAccessRoleLabel(role: AccessRole): string {
  return {
    guest: 'Гость',
    user: 'Пользователь',
    operator: 'Оператор',
    owner: 'Владелец установки',
  }[role]
}
