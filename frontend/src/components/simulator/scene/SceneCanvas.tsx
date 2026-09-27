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
        <color attach="background" args={['#c8e0ec']} />
        <fog attach="fog" args={['#c8e0ec', 30, 90]} />
        <ambientLight intensity={0.48} />
        <hemisphereLight args={['#eef7fa', '#788b6d', 0.92]} />
        <directionalLight position={[-5, 9, -6]} intensity={1.9} color="#fff9ef" castShadow shadow-mapSize={[2048, 2048]} shadow-camera-far={40} shadow-camera-left={-11} shadow-camera-right={11} shadow-camera-top={10} shadow-camera-bottom={-10} shadow-bias={-0.00018} shadow-normalBias={0.018} />
        <directionalLight position={[6, 4, 8]} intensity={0.42} color="#dceaf1" />
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
          <meshStandardMaterial color="#b7d4a8" roughness={1} />
        </mesh>
      </Canvas>
      <div className="simulator-scene-cue"><span className="simulator-cue-dot" /> ЛКМ — сдвиг · ПКМ — вращение · колёсико — масштаб · WASD/QE — камера</div>
    </div>
  )
}
