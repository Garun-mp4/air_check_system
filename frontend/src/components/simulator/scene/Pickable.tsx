'use client'

import { useState } from 'react'
import type { ReactNode } from 'react'
import type { ThreeEvent } from '@react-three/fiber'

import type { VisualizationMode } from '../types'

type Position = [number, number, number]

export function Pickable({
  id,
  position,
  bounds,
  selectedId,
  mode,
  onSelect,
  children,
}: {
  id: string
  position?: Position
  bounds: Position
  selectedId: string | null
  mode: VisualizationMode
  onSelect: (id: string, point: Position) => void
  children: ReactNode
}) {
  const [hovered, setHovered] = useState(false)
  const highlighted = selectedId === id || hovered
  function select(event: ThreeEvent<MouseEvent>) {
    if (event.button !== 0) return
    event.stopPropagation()
    onSelect(id, [event.point.x, event.point.y, event.point.z])
  }
  return (
    <group
      position={position}
      userData={{ deviceId: id }}
      onClick={select}
      onPointerOver={(event) => { event.stopPropagation(); setHovered(true); document.body.style.cursor = 'pointer' }}
      onPointerOut={(event) => { event.stopPropagation(); setHovered(false); document.body.style.cursor = '' }}
    >
      {children}
      {highlighted ? (
        <mesh renderOrder={mode === 'technical' ? 9 : 2}>
          <boxGeometry args={bounds} />
          <meshBasicMaterial
            color={selectedId === id ? '#007f70' : '#e5a83b'}
            wireframe
            transparent
            opacity={selectedId === id ? 0.92 : 0.62}
            depthTest
          />
        </mesh>
      ) : null}
    </group>
  )
}
