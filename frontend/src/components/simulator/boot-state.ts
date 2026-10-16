export type SimulatorBootStage = 'snapshot' | 'scene' | 'frame'

export function getSimulatorBootStage(
  snapshotReady: boolean,
  rendererReady: boolean,
  firstFrameReady: boolean,
): SimulatorBootStage | null {
  if (!snapshotReady) return 'snapshot'
  if (!rendererReady) return 'scene'
  if (!firstFrameReady) return 'frame'
  return null
}
