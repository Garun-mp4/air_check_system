export type ConditionState = {
  since: number | null
  active: boolean
  lastAlert: number | null
  lastCheck: number | null
}
export const emptyCondition: ConditionState = {
  since: null,
  active: false,
  lastAlert: null,
  lastCheck: null,
}
export function stepCondition(
  previous: ConditionState,
  bad: boolean | null,
  now: number,
  duration: number,
  suppression: number,
  maxGap: number,
) {
  let state = { ...previous, lastCheck: now },
    event: 'problem' | 'recovery' | null = null
  if (bad === null) {
    state.since = null
    return { state, event }
  }
  if (!bad) {
    if (state.active) event = 'recovery'
    state.active = false
    state.since = null
    return { state, event }
  }
  if (
    !state.active &&
    previous.lastCheck !== null &&
    now - previous.lastCheck > maxGap
  )
    state.since = null
  if (state.since === null) state.since = now
  if (
    !state.active &&
    now - state.since >= duration &&
    (state.lastAlert === null || now - state.lastAlert >= suppression)
  ) {
    state.active = true
    state.lastAlert = now
    event = 'problem'
  }
  return { state, event }
}
