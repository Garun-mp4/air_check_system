'use client'

import { Component, type ReactNode } from 'react'

type SceneStartupBoundaryProps = {
  children: ReactNode
  onRetry: () => void
  onError: (message: string) => void
}

export default class SceneStartupBoundary extends Component<SceneStartupBoundaryProps, { failed: boolean; retries: number }> {
  state = { failed: false, retries: 0 }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error) {
    if (this.state.retries === 0) {
      this.props.onRetry()
      this.setState({ failed: false, retries: 1 })
      return
    }
    this.props.onError(error.message || 'Не удалось инициализировать 3D-сцену.')
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}
