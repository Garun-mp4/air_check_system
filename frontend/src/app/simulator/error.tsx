'use client'

import StandBootScreen from '../../components/simulator/StandBootScreen'

export default function SimulatorError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <StandBootScreen stage="error" errorMessage={error.message} onRetry={reset} />
}
