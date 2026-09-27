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
  const sideWidth = (width - windowWidth) / 2
  return (
    <group>
      <mesh position={[0, -0.36, 0]} receiveShadow>
        <boxGeometry args={[width + 1.2, 0.34, depth + 1.2]} />
        <meshStandardMaterial color="#344953" roughness={0.88} />
      </mesh>
      <mesh position={[0, -0.185, 0]}>
        <boxGeometry args={[width + 1.18, 0.025, depth + 1.18]} />
        <meshStandardMaterial color="#39a69a" metalness={0.18} roughness={0.46} />
      </mesh>
      <mesh position={[0, -0.105, 0]} receiveShadow>
        <boxGeometry args={[width, 0.16, depth]} />
        <meshStandardMaterial color="#d7dfd7" roughness={0.9} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.019, 0]} receiveShadow>
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial color="#ece9d5" roughness={0.96} />
      </mesh>

      <WallPanel size={[wall, height, depth]} position={[-width / 2, height / 2, 0]} color="#cadbd9" />
      <WallPanel size={[wall, height, depth]} position={[width / 2, height / 2, 0]} color="#cadbd9" />

      {/* The near facade is the cutaway wall, matching the Panda3D room coordinates. */}
      {cutaway !== 'hidden' ? (
        <group>
          <WallPanel size={[width, height, wall]} position={[0, height / 2, -backZ]} color="#dde8e7" opacity={wallOpacity} />
        </group>
      ) : null}

      {/* The window is on the far wall; its opening remains part of the room shell. */}
      <group>
        <WallPanel size={[windowWidth, sill, wall]} position={[0, sill / 2, backZ]} opacity={1} />
        <WallPanel size={[windowWidth, height - sill - windowHeight, wall]} position={[0, sill + windowHeight + (height - sill - windowHeight) / 2, backZ]} opacity={1} />
        <WallPanel size={[sideWidth, windowHeight, wall]} position={[-windowWidth / 2 - sideWidth / 2, sill + windowHeight / 2, backZ]} opacity={1} />
        <WallPanel size={[sideWidth, windowHeight, wall]} position={[windowWidth / 2 + sideWidth / 2, sill + windowHeight / 2, backZ]} opacity={1} />
        <WallTrim width={width} height={height} wall={wall} backZ={backZ} />
      </group>

      <mesh position={[0, height + 0.12, 0]} receiveShadow>
        <boxGeometry args={[width + 0.34, 0.2, depth + 0.34]} />
        <meshStandardMaterial color="#f4f7f3" roughness={0.78} transparent opacity={cutaway === 'visible' ? 0.16 : 0.1} depthWrite={false} />
      </mesh>

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.56, 0]} receiveShadow>
        <planeGeometry args={[width + depth + 18, depth + width + 18]} />
        <meshStandardMaterial color="#9aca98" roughness={1} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.53, 0]} receiveShadow>
        <planeGeometry args={[width + 2.8, depth + 2.8]} />
        <meshStandardMaterial color="#b5d5aa" roughness={1} />
      </mesh>
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
