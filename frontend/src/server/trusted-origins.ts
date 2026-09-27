export function parseTrustedOrigins(value: string | undefined): string[] | undefined {
  const origins = [...new Set((value ?? '').split(',').map((origin) => origin.trim()).filter(Boolean))]
  return origins.length > 0 ? origins : undefined
}
