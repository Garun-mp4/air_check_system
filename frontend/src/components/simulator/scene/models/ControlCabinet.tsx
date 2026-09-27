'use client'

import { Text } from '@react-three/drei'
import type { SimulatorSnapshot, VisualizationMode } from '../../types'
import { Pickable } from '../Pickable'
import { CylinderBetween, Fastener, Housing, StatusLed } from './parts'
import { CONTROL_CABINET_MODULES, type Point3 } from './geometry'
type Select = (id: string, point: Point3) => void

function CabinetLabel({ children, position, size = 0.045, color = '#e7ece7', rotation = [0, 0, 0] }: { children: string; position: Point3; size?: number; color?: string; rotation?: [number, number, number] }) {
  return <Text position={position} rotation={rotation} fontSize={size} color={color} anchorX="center" anchorY="middle" outlineWidth={0.0018} outlineColor="#344348">{children}</Text>
}

function BoardWithTerminals({ width, height, count = 4 }: { width: number; height: number; count?: number }) {
  return (
    <group>
      <Housing position={[0, 0, 0]} size={[width, height, 0.006]} color="#17684f" radius={0.003} roughness={0.62} />
      {Array.from({ length: count }, (_, index) => (
        <group key={index} position={[-width * 0.39 + index * width * 0.78 / Math.max(1, count - 1), -height * 0.24, 0.009]}>
          <Housing position={[0, 0, 0]} size={[0.020, 0.016, 0.017]} color={index % 2 ? '#21755d' : '#c58e37'} radius={0.003} metalness={0.16} />
          <mesh position={[0, 0, 0.009]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.003, 0.003, 0.005, 8]} />
            <meshStandardMaterial color="#c3c4b8" metalness={0.74} roughness={0.28} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

function Esp32Board({ online }: { online: boolean }) {
  const boardWidth = 0.096
  const boardHeight = 0.050
  return (
    <group>
      <Housing position={[0, 0, 0]} size={[boardWidth, boardHeight, 0.004]} color="#167454" radius={0.002} roughness={0.58} />
      {/* WROOM-32E shield and its ceramic antenna are distinct from the carrier PCB. */}
      <Housing position={[-0.004, 0.006, 0.005]} size={[0.046, 0.024, 0.006]} color="#bdc5c1" radius={0.002} metalness={0.46} roughness={0.34} />
      <Housing position={[0.032, 0.006, 0.005]} size={[0.017, 0.024, 0.005]} color="#e6e5dc" radius={0.0015} roughness={0.76} />
      {[0, 1, 2, 3, 4].map((line) => <mesh key={line} position={[0.032, -0.002 + line * 0.004, 0.008]}><boxGeometry args={[0.013, 0.0012, 0.001]} /><meshStandardMaterial color="#b8904a" metalness={0.66} /></mesh>)}
      <Housing position={[-0.036, -0.007, 0.005]} size={[0.014, 0.015, 0.010]} color="#c8cdca" radius={0.002} metalness={0.56} />
      <mesh position={[-0.036, -0.007, 0.010]}><boxGeometry args={[0.007, 0.006, 0.002]} /><meshStandardMaterial color="#445459" metalness={0.44} /></mesh>
      <Housing position={[0.010, -0.014, 0.007]} size={[0.014, 0.008, 0.005]} color="#dfc880" radius={0.001} />
      {[-1, 1].map((side) => (
        <group key={side}>
          {Array.from({ length: 12 }, (_, index) => (
            <mesh key={index} position={[-0.039 + index * 0.0071, side * 0.023, 0.005]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.0011, 0.0011, 0.010, 6]} />
              <meshStandardMaterial color="#c2a45b" metalness={0.72} roughness={0.3} />
            </mesh>
          ))}
        </group>
      ))}
      <StatusLed position={[-0.020, -0.014, 0.010]} active={online} size={0.0035} />
      <mesh position={[0.000, 0.014, 0.009]}><boxGeometry args={[0.012, 0.005, 0.006]} /><meshStandardMaterial color="#202a2d" roughness={0.4} /></mesh>
      <mesh position={[0.019, -0.009, 0.008]}><boxGeometry args={[0.009, 0.006, 0.004]} /><meshStandardMaterial color="#d5d1b9" metalness={0.18} /></mesh>
    </group>
  )
}

function PowerSupply({ enabled }: { enabled: boolean }) {
  return (
    <group>
      <Housing position={[0, 0, 0]} size={[0.18, 0.112, 0.088]} color="#c9d0cd" radius={0.006} metalness={0.48} roughness={0.43} />
      <Housing position={[0, 0, 0.048]} size={[0.148, 0.083, 0.010]} color="#8c9998" radius={0.004} metalness={0.26} />
      {Array.from({ length: 8 }, (_, index) => (
        <mesh key={index} position={[-0.056 + index * 0.016, 0, 0.055]}>
          <boxGeometry args={[0.0035, 0.062, 0.002]} />
          <meshStandardMaterial color="#586568" metalness={0.35} roughness={0.5} />
        </mesh>
      ))}
      <Housing position={[-0.072, -0.023, 0.057]} size={[0.026, 0.043, 0.012]} color="#e0e3dc" radius={0.003} />
      <Housing position={[0.057, -0.024, 0.057]} size={[0.045, 0.036, 0.012]} color="#596b6d" radius={0.003} />
      {[
        { y: -0.034, color: '#76533f' },
        { y: -0.023, color: '#4c82a2' },
        { y: -0.012, color: '#5d9b50' },
      ].map(({ y, color }) => (
        <group key={y}>
          <mesh position={[-0.072, y, 0.065]}><boxGeometry args={[0.007, 0.003, 0.002]} /><meshStandardMaterial color={color} metalness={0.32} /></mesh>
          <mesh position={[-0.072, y, 0.067]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.002, 0.002, 0.0015, 8]} /><meshStandardMaterial color="#c1bda9" metalness={0.72} roughness={0.32} /></mesh>
        </group>
      ))}
      {[0.057, 0.071].map((x, index) => <mesh key={x} position={[x, -0.024, 0.065]}><boxGeometry args={[0.006, 0.003, 0.002]} /><meshStandardMaterial color={index === 0 ? '#c84f43' : '#303a3d'} metalness={0.24} /></mesh>)}
      <StatusLed position={[-0.063, 0.036, 0.059]} active={enabled} size={0.005} />
    </group>
  )
}

function BuckConverter() {
  return (
    <group>
      <BoardWithTerminals width={0.132} height={0.074} count={4} />
      <Housing position={[-0.020, 0.006, 0.012]} size={[0.027, 0.026, 0.022]} color="#283537" radius={0.003} metalness={0.26} />
      <mesh position={[-0.020, 0.006, 0.024]}><torusGeometry args={[0.0075, 0.002, 5, 12]} /><meshStandardMaterial color="#b07d36" metalness={0.64} roughness={0.36} /></mesh>
      {[-1, 1].map((side) => <mesh key={side} position={[side * 0.039, 0.015, 0.016]}><cylinderGeometry args={[0.006, 0.006, 0.012, 10]} /><meshStandardMaterial color="#bfbdad" metalness={0.38} /></mesh>)}
    </group>
  )
}

function DriverBoard({ kind }: { kind: 'mosfet' | 'hbridge' }) {
  const width = kind === 'mosfet' ? 0.135 : 0.145
  const height = kind === 'mosfet' ? 0.078 : 0.084
  return (
    <group>
      <BoardWithTerminals width={width} height={height} count={6} />
      {kind === 'mosfet' ? (
        <group>
          {[-0.025, 0.021].map((x) => (
            <group key={x} position={[x, 0.003, 0.015]}>
              <Housing position={[0, 0, 0]} size={[0.028, 0.038, 0.024]} color="#2d393c" radius={0.003} metalness={0.16} />
              {[-1, 0, 1].map((side) => <mesh key={side} position={[side * 0.009, 0, 0.014]}><boxGeometry args={[0.003, 0.037, 0.003]} /><meshStandardMaterial color="#aeb7b4" metalness={0.54} /></mesh>)}
            </group>
          ))}
        </group>
      ) : (
        <group>
          {[-0.035, -0.014, 0.007, 0.028].map((x) => <mesh key={x} position={[x, 0.012, 0.014]}><boxGeometry args={[0.015, 0.028, 0.023]} /><meshStandardMaterial color="#38464a" metalness={0.12} roughness={0.55} /></mesh>)}
          <Housing position={[0.035, -0.018, 0.014]} size={[0.026, 0.018, 0.018]} color="#d5c887" radius={0.003} />
        </group>
      )}
      <StatusLed position={[0.049, 0.026, 0.022]} active size={0.004} />
    </group>
  )
}

function FuseRail() {
  return (
    <group>
      <Housing position={[0, 0, 0]} size={[0.17, 0.048, 0.023]} color="#384a4e" radius={0.004} />
      {[-0.047, 0, 0.047].map((x, index) => (
        <group key={x} position={[x, 0, 0.015]}>
          <Housing position={[0, 0, 0]} size={[0.034, 0.036, 0.016]} color={index === 1 ? '#2c8d79' : '#d58b3e'} radius={0.007} />
          <mesh position={[0, 0, 0.010]}><boxGeometry args={[0.009, 0.021, 0.004]} /><meshStandardMaterial color="#eee6c9" transparent opacity={0.84} roughness={0.22} /></mesh>
          <mesh position={[0, 0.004, 0.013]}><boxGeometry args={[0.003, 0.013, 0.002]} /><meshStandardMaterial color="#c6ba8c" metalness={0.28} /></mesh>
          {[-1, 1].map((side) => <group key={side} position={[0, side * 0.027, 0.008]}>
            <Housing position={[0, 0, 0]} size={[0.022, 0.010, 0.010]} color="#4d5d60" radius={0.002} />
            <mesh position={[0, 0, 0.006]}><boxGeometry args={[0.006, 0.002, 0.002]} /><meshStandardMaterial color="#c8b875" metalness={0.6} /></mesh>
          </group>)}
        </group>
      ))}
    </group>
  )
}

function TerminalStrip() {
  const colors = ['#be7042', '#be7042', '#537d74', '#537d74', '#567d73', '#516f98', '#516f98', '#516f98']
  return (
    <group>
      {colors.map((color, index) => (
        <group key={index} position={[-0.217 + index * 0.062, 0, 0]}>
          <Housing position={[0, 0, 0]} size={[0.058, 0.052, 0.045]} color={color} radius={0.004} />
          <mesh position={[0, 0.006, 0.025]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.008, 0.008, 0.006, 8]} />
            <meshStandardMaterial color="#c9ccc3" metalness={0.72} roughness={0.28} />
          </mesh>
          <mesh position={[0, 0.006, 0.029]}><boxGeometry args={[0.009, 0.0015, 0.001]} /><meshStandardMaterial color="#657174" metalness={0.44} /></mesh>
        </group>
      ))}
    </group>
  )
}

function DinRail({ position, width }: { position: Point3; width: number }) {
  return (
    <group position={position}>
      <Housing position={[0, 0, 0]} size={[width, 0.018, 0.030]} color="#8c9998" radius={0.002} metalness={0.66} roughness={0.36} />
      {Array.from({ length: 13 }, (_, index) => <mesh key={index} position={[-width * 0.44 + index * width * 0.88 / 12, 0, 0.017]}><boxGeometry args={[0.012, 0.004, 0.001]} /><meshStandardMaterial color="#3a4c50" metalness={0.34} /></mesh>)}
      {[-1, 1].map((side) => <Fastener key={side} position={[side * (width / 2 - 0.028), 0, 0.018]} scale={0.55} facing={-1} />)}
    </group>
  )
}

export default function ControlCabinet({
  snapshot,
  selectedId,
  mode,
  onSelect,
}: {
  snapshot: SimulatorSnapshot
  selectedId: string | null
  mode: VisualizationMode
  onSelect: Select
}) {
  const center = snapshot.simulation.layout.control_cabinet_center
  const width = snapshot.simulation.mount_dimensions.control_cabinet_width_m
  const height = snapshot.simulation.mount_dimensions.control_cabinet_height_m
  const x = center[0]
  const y = center[2]
  const wallInside = snapshot.simulation.room_dimensions.depth_m / 2 - snapshot.simulation.room_dimensions.wall_thickness_m / 2
  const z = wallInside - 0.080
  const face = wallInside - 0.200
  const railZ = wallInside - 0.072
  const doorZ = wallInside - 0.068
  const controllerOnline = snapshot.backend.online
  const modules = CONTROL_CABINET_MODULES

  return (
    <group>
      {/* Surface-mounted enclosure: the backplate meets the room-side wall and the open side faces into the room. */}
      <Housing position={[x, y, wallInside - 0.025]} size={[width - 0.035, height - 0.035, 0.030]} color="#c4ceca" radius={0.010} metalness={0.12} roughness={0.76} />
      <Housing position={[x - width / 2 + 0.020, y, z]} size={[0.040, height, 0.145]} color="#627174" radius={0.009} metalness={0.26} roughness={0.61} />
      <Housing position={[x + width / 2 - 0.020, y, z]} size={[0.040, height, 0.145]} color="#627174" radius={0.009} metalness={0.26} roughness={0.61} />
      <Housing position={[x, y + height / 2 - 0.020, z]} size={[width, 0.040, 0.145]} color="#627174" radius={0.009} metalness={0.26} roughness={0.61} />
      <Housing position={[x, y - height / 2 + 0.020, z]} size={[width, 0.040, 0.145]} color="#627174" radius={0.009} metalness={0.26} roughness={0.61} />
      <DinRail position={[x, y + 0.105, railZ]} width={width - 0.18} />
      <DinRail position={[x, y - 0.085, railZ]} width={width - 0.18} />
      <DinRail position={[x, y - 0.285, railZ]} width={width - 0.18} />

      {modules.map((module) => (
        <Pickable
          key={module.id}
          id={module.id}
          position={[x + module.position[0], y + module.position[1], face + module.position[2]]}
          bounds={module.bounds}
          selectedId={selectedId}
          mode={mode}
          onSelect={onSelect}
        >
          <group rotation={[0, Math.PI, 0]}>
            {module.kind === 'psu' ? <PowerSupply enabled={controllerOnline} /> : null}
            {module.kind === 'esp' ? <Esp32Board online={controllerOnline} /> : null}
            {module.kind === 'buck' ? <BuckConverter /> : null}
            {module.kind === 'mosfet' ? <DriverBoard kind="mosfet" /> : null}
            {module.kind === 'hbridge' ? <DriverBoard kind="hbridge" /> : null}
            {module.kind === 'fuse' ? <FuseRail /> : null}
            {module.kind === 'terminals' ? <TerminalStrip /> : null}
          </group>
          <CabinetLabel position={[0, -module.bounds[1] * 0.67, -module.bounds[2] / 2 - 0.006]} rotation={[0, Math.PI, 0]} size={0.031} color="#35464a">{module.label}</CabinetLabel>
        </Pickable>
      ))}

      <group position={[x - width / 2 + 0.012, y, doorZ]} rotation={[0, 0.92, 0]}>
        <Housing position={[width / 2 - 0.005, 0, 0]} size={[width - 0.020, height - 0.020, 0.030]} color="#879391" radius={0.014} metalness={0.34} roughness={0.55} />
        <Housing position={[width / 2 - 0.005, 0, 0.018]} size={[width - 0.070, height - 0.072, 0.008]} color="#a5b0ad" radius={0.010} metalness={0.18} roughness={0.58} />
        <Housing position={[width - 0.070, 0, 0.027]} size={[0.022, 0.084, 0.014]} color="#45565a" radius={0.006} metalness={0.42} />
        <mesh position={[width - 0.070, 0, 0.035]}><cylinderGeometry args={[0.008, 0.008, 0.006, 10]} /><meshStandardMaterial color="#d2b768" metalness={0.74} /></mesh>
        <CabinetLabel position={[width / 2 - 0.005, height * 0.24, 0.026]} size={0.052} color="#405155">12 V DC · AIR CHECK</CabinetLabel>
        {[-1, 0, 1].map((side) => <mesh key={side} position={[width * 0.23, side * 0.14, 0.025]}><boxGeometry args={[width * 0.50, 0.004, 0.004]} /><meshStandardMaterial color="#778480" /></mesh>)}
        {[0.30, -0.30].map((hingeY) => <Housing key={hingeY} position={[0.008, hingeY, 0]} size={[0.025, 0.11, 0.036]} color="#59696c" radius={0.006} metalness={0.52} />)}
      </group>
      <CylinderBetween from={[x - width / 2 + 0.010, y + 0.30, doorZ - 0.035]} to={[x - width / 2 + 0.010, y + 0.30, doorZ + 0.035]} radius={0.006} color="#b8c3bf" />
      <CylinderBetween from={[x - width / 2 + 0.010, y - 0.30, doorZ - 0.035]} to={[x - width / 2 + 0.010, y - 0.30, doorZ + 0.035]} radius={0.006} color="#b8c3bf" />
      <Housing position={[x, y + height / 2 - 0.060, wallInside - 0.115]} size={[width - 0.18, 0.045, 0.018]} color="#415156" radius={0.008} />
      <CabinetLabel position={[x, y + height / 2 - 0.060, wallInside - 0.128]} rotation={[0, Math.PI, 0]} size={0.035}>УПРАВЛЕНИЕ · 12 V DC</CabinetLabel>
      <Fastener position={[x - width / 2 + 0.042, y - height / 2 + 0.042, wallInside - 0.15]} facing={-1} scale={0.85} />
      <Fastener position={[x + width / 2 - 0.042, y - height / 2 + 0.042, wallInside - 0.15]} facing={-1} scale={0.85} />
    </group>
  )
}
