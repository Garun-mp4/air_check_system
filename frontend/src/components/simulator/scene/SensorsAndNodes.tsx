'use client'

import type { SimulatorSnapshot, VisualizationMode } from '../types'
import ControlCabinet from './models/ControlCabinet'
import { IndoorSensorNode, OutdoorSensorNode } from './models/WallSensorNodes'

type Point3 = [number, number, number]

export default function SensorsAndNodes({
  snapshot,
  selectedId,
  mode,
  onSelect,
}: {
  snapshot: SimulatorSnapshot
  selectedId: string | null
  mode: VisualizationMode
  onSelect: (id: string, point: Point3) => void
}) {
  return (
    <group>
      <IndoorSensorNode snapshot={snapshot} selectedId={selectedId} mode={mode} onSelect={onSelect} />
      <OutdoorSensorNode snapshot={snapshot} selectedId={selectedId} mode={mode} onSelect={onSelect} />
      <ControlCabinet snapshot={snapshot} selectedId={selectedId} mode={mode} onSelect={onSelect} />
    </group>
  )
}
