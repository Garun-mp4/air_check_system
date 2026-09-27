'use client'

import { Canvas } from '@react-three/fiber'
import type { SimulatorSnapshot, CutawayMode, VisualizationMode } from '../types'
import Airflow from './Airflow'
import CameraRig from './CameraRig'
import FanAssembly from './FanAssembly'
import RoomShell from './RoomShell'
import SensorsAndNodes from './SensorsAndNodes'
import WindowAssembly from './WindowAssembly'
import Wiring from './Wiring'

type Point = [number, number, number]
type CameraCommand = { id: number; focus: Point | null }

export default function SceneCanvas({
  snapshot,
  mode,
  cutaway,
  selectedId,
  cameraCommand,
  onSelect,
  onClearSelection,
}: {
  snapshot: SimulatorSnapshot
  mode: VisualizationMode
  cutaway: CutawayMode
  selectedId: string | null
  cameraCommand: CameraCommand
  onSelect: (id: string, point: Point) => void
  onClearSelection: () => void
}) {
  const d = snapshot.simulation.room_dimensions
  return (
    <div className="simulator-canvas-host" role="application" aria-label="Интерактивная 3D-сцена стенда AirCheck">
      <Canvas
        shadows
        dpr={[1, 1.5]}
        camera={{ position: [7, 3.1, -9], fov: snapshot.simulation.camera.field_of_view_degrees, near: snapshot.simulation.camera.near_plane_m, far: snapshot.simulation.camera.far_plane_m }}
        gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
        onContextMenu={(event) => event.preventDefault()}
        onPointerMissed={(event) => { if (event.button === 0) onClearSelection() }}
      >
        <color attach="background" args={['#a9d3e5']} />
        <fog attach="fog" args={['#a9d3e5', 24, 78]} />
        <ambientLight intensity={0.78} />
        <hemisphereLight args={['#e8f7ff', '#738b67', 1.05]} />
        <directionalLight position={[-6, 11, -8]} intensity={2.15} castShadow shadow-mapSize={[1024, 1024]} shadow-camera-far={45} shadow-camera-left={-12} shadow-camera-right={12} shadow-camera-top={12} shadow-camera-bottom={-12} />
        <directionalLight position={[7, 5, 8]} intensity={0.74} color="#fff4d8" />
        <RoomShell snapshot={snapshot} cutaway={cutaway} />
        <WindowAssembly snapshot={snapshot} selectedId={selectedId} mode={mode} onSelect={onSelect} />
        <SensorsAndNodes snapshot={snapshot} selectedId={selectedId} mode={mode} onSelect={onSelect} />
        <FanAssembly snapshot={snapshot} selectedId={selectedId} mode={mode} onSelect={onSelect} />
        <Wiring snapshot={snapshot} visible={mode === 'wiring' || mode === 'technical'} />
        <Airflow snapshot={snapshot} visible={mode === 'airflow'} />
        <CameraRig snapshot={snapshot} command={cameraCommand} />
        {/* A faint distant ground gives the green platform a horizon under the blue sky. */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.58, 0]} receiveShadow>
          <planeGeometry args={[d.width_m + d.outdoor_depth_m * 8, d.depth_m + d.outdoor_depth_m * 8]} />
          <meshStandardMaterial color="#b4d6a7" roughness={1} />
        </mesh>
      </Canvas>
      <div className="simulator-scene-cue"><span className="simulator-cue-dot" /> Перетаскивайте — вращение · колёсико — масштаб · WASD/QE — перемещение камеры</div>
    </div>
  )
}
