export type RuntimeMode = 'real' | 'simulation'
export function runtimeMode(): RuntimeMode {
  const mode = process.env.AIRCHECK_MODE ?? 'simulation'
  if (mode !== 'real' && mode !== 'simulation') throw new Error('AIRCHECK_MODE must be real or simulation')
  return mode
}
export function activeDataSource(): 'real' | 'simulator' { return runtimeMode() === 'real' ? 'real' : 'simulator' }
