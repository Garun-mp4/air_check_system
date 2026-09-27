const FALLBACK_RETURN_PATH = '/'

export function getSafeReturnPath(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return FALLBACK_RETURN_PATH
  }

  try {
    const url = new URL(value, 'https://aircheck.invalid')
    if (url.origin !== 'https://aircheck.invalid') return FALLBACK_RETURN_PATH
    const normalizedPath = url.pathname
    if (
      !normalizedPath.startsWith('/') ||
      normalizedPath.startsWith('//') ||
      normalizedPath.includes('\\')
    ) {
      return FALLBACK_RETURN_PATH
    }
    return `${normalizedPath}${url.search}${url.hash}`
  } catch {
    return FALLBACK_RETURN_PATH
  }
}

export function getLoginHref(returnTo: string): string {
  return `/login?returnTo=${encodeURIComponent(getSafeReturnPath(returnTo))}`
}
