'use client'

import type { SimulatorSnapshot, CutawayMode } from '../types'

function WallPanel({
  size,
  position,
  color = '#e6eeec',
  opacity = 1,
}: {
  size: [number, number, number]
  position: [number, number, number]
  color?: string
  opacity?: number
}) {
  return (
    <mesh position={position} castShadow receiveShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} roughness={0.92} transparent={opacity < 1} opacity={opacity} depthWrite={opacity === 1} />
    </mesh>
  )
}

export default function RoomShell({ snapshot, cutaway }: { snapshot: SimulatorSnapshot; cutaway: CutawayMode }) {
  const d = snapshot.simulation.room_dimensions
  const { width_m: width, depth_m: depth, height_m: height, wall_thickness_m: wall } = d
  const sill = d.window_sill_height_m
  const windowWidth = d.window_width_m
  const windowHeight = d.window_height_m
  const backZ = depth / 2
  const wallOpacity = cutaway === 'visible' ? 1 : cutaway === 'transparent' ? 0.22 : 0
  const fanCenterX = width * 0.37
  const fanCenterY = height * 0.81
  const ventilationOpening = 0.225
  const openings = [
    { x: 0, y0: sill, y1: sill + windowHeight, width: windowWidth },
    { x: -fanCenterX, y0: fanCenterY - ventilationOpening / 2, y1: fanCenterY + ventilationOpening / 2, width: ventilationOpening },
    { x: fanCenterX, y0: fanCenterY - ventilationOpening / 2, y1: fanCenterY + ventilationOpening / 2, width: ventilationOpening },
  ]
  const rearWallPanels = buildRearWallPanels(width, height, wall, backZ, openings)
  return (
    <group>
      <mesh position={[0, -0.36, 0]} receiveShadow>
        <boxGeometry args={[width + 1.2, 0.34, depth + 1.2]} />
        <meshStandardMaterial color="#42555a" roughness={0.9} />
      </mesh>
      <mesh position={[0, -0.185, 0]}>
        <boxGeometry args={[width + 1.18, 0.025, depth + 1.18]} />
        <meshStandardMaterial color="#478d82" metalness={0.12} roughness={0.52} />
      </mesh>
      <mesh position={[0, -0.105, 0]} receiveShadow>
        <boxGeometry args={[width, 0.16, depth]} />
        <meshStandardMaterial color="#d5d0c2" roughness={0.92} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.019, 0]} receiveShadow>
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial color="#d8d0bd" roughness={0.92} />
      </mesh>
      <FloorSeams width={width} depth={depth} />

      <WallPanel size={[wall, height, depth]} position={[-width / 2, height / 2, 0]} color="#e0e0d7" />
      <WallPanel size={[wall, height, depth]} position={[width / 2, height / 2, 0]} color="#e0e0d7" />

      {/* The near facade is the cutaway wall, matching the Panda3D room coordinates. */}
      {cutaway !== 'hidden' ? (
        <group>
          <WallPanel size={[width, height, wall]} position={[0, height / 2, -backZ]} color="#dedfd8" opacity={wallOpacity} />
        </group>
      ) : null}

      {/* Leave actual apertures for the window and both through-wall fan sleeves. */}
      <group>{rearWallPanels.map((panel, index) => <WallPanel key={index} size={panel.size} position={panel.position} color="#e0e5df" />)}</group>
      <WallTrim width={width} height={height} wall={wall} backZ={backZ} />

      <mesh position={[0, height + 0.12, 0]} receiveShadow>
        <boxGeometry args={[width + 0.34, 0.2, depth + 0.34]} />
        <meshStandardMaterial color="#f7f4ec" roughness={0.82} transparent opacity={cutaway === 'visible' ? 0.16 : 0.1} depthWrite={false} />
      </mesh>
      <WallBaseboards width={width} depth={depth} wall={wall} height={0.085} />
    </group>
  )
}

type WallOpening = { x: number; y0: number; y1: number; width: number }

function buildRearWallPanels(width: number, height: number, wall: number, backZ: number, openings: WallOpening[]) {
  const levels = Array.from(new Set([0, height, ...openings.flatMap(({ y0, y1 }) => [y0, y1])])).sort((a, b) => a - b)
  const panels: { size: [number, number, number]; position: [number, number, number] }[] = []
  for (let level = 0; level < levels.length - 1; level += 1) {
    const y0 = levels[level]
    const y1 = levels[level + 1]
    const centerY = (y0 + y1) / 2
    const intervals = openings
      .filter((opening) => centerY > opening.y0 && centerY < opening.y1)
      .map((opening) => ({ start: opening.x - opening.width / 2, end: opening.x + opening.width / 2 }))
      .sort((a, b) => a.start - b.start)
    let cursor = -width / 2
    for (const interval of intervals) {
      if (interval.start > cursor) {
        const panelWidth = interval.start - cursor
        panels.push({ size: [panelWidth, y1 - y0, wall], position: [cursor + panelWidth / 2, centerY, backZ] })
      }
      cursor = Math.max(cursor, interval.end)
    }
    if (cursor < width / 2) {
      const panelWidth = width / 2 - cursor
      panels.push({ size: [panelWidth, y1 - y0, wall], position: [cursor + panelWidth / 2, centerY, backZ] })
    }
  }
  return panels
}

function FloorSeams({ width, depth }: { width: number; depth: number }) {
  const boardWidth = 0.32
  const count = Math.floor(width / boardWidth)
  return (
    <group>
      {Array.from({ length: count - 1 }, (_, index) => <mesh key={index} position={[-width / 2 + (index + 1) * boardWidth, -0.014, 0]}><boxGeometry args={[0.003, 0.002, depth - 0.12]} /><meshStandardMaterial color="#b8ae99" roughness={0.95} /></mesh>)}
      {[-depth / 2 + 0.45, -depth / 2 + 1.25, -depth / 2 + 2.05, -depth / 2 + 2.85].map((z) => (
        <mesh key={z} position={[0, -0.013, z]}><boxGeometry args={[width - 0.05, 0.0015, 0.002]} /><meshStandardMaterial color="#c4baa5" roughness={0.95} /></mesh>
      ))}
    </group>
  )
}

function WallBaseboards({ width, depth, wall, height }: { width: number; depth: number; wall: number; height: number }) {
  const z = depth / 2 - wall / 2 - 0.025
  return (
    <group>
      <mesh position={[0, height / 2, z]} castShadow><boxGeometry args={[width - wall, height, 0.035]} /><meshStandardMaterial color="#c4cbc3" roughness={0.76} /></mesh>
      <mesh position={[-width / 2 + wall / 2, height / 2, 0]}><boxGeometry args={[0.035, height, depth - wall]} /><meshStandardMaterial color="#c4cbc3" roughness={0.76} /></mesh>
      <mesh position={[width / 2 - wall / 2, height / 2, 0]}><boxGeometry args={[0.035, height, depth - wall]} /><meshStandardMaterial color="#c4cbc3" roughness={0.76} /></mesh>
    </group>
  )
}

function WallTrim({ width, height, wall, backZ }: { width: number; height: number; wall: number; backZ: number }) {
  const trim = 0.055
  return (
    <group>
      <mesh position={[0, height, backZ]} castShadow><boxGeometry args={[width, trim, wall + trim]} /><meshStandardMaterial color="#b7cbc9" roughness={0.72} /></mesh>
      <mesh position={[0, 0.03, backZ]} castShadow><boxGeometry args={[width, trim, wall + trim]} /><meshStandardMaterial color="#b7cbc9" roughness={0.72} /></mesh>
      <mesh position={[-width / 2, height / 2, backZ]}><boxGeometry args={[trim, height, wall + trim]} /><meshStandardMaterial color="#b7cbc9" roughness={0.72} /></mesh>
      <mesh position={[width / 2, height / 2, backZ]}><boxGeometry args={[trim, height, wall + trim]} /><meshStandardMaterial color="#b7cbc9" roughness={0.72} /></mesh>
    </group>
  )
}
