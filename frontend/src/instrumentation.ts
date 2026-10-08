// Start background work on server boot, including when devices and browsers are offline.
export async function register() {
  if (
    process.env.NEXT_RUNTIME === 'nodejs' &&
    process.env.NEXT_PHASE !== 'phase-production-build' &&
    /^postgres(?:ql)?:\/\//.test(process.env.DATABASE_URL ?? '')
  ) {
    const { getAirQualityService } = await import('./server/api')
    getAirQualityService()
  }
}
