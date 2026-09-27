'use client'

import { useMemo } from 'react'
import { Text } from '@react-three/drei'
import type { SimulatorSnapshot } from '../types'
import { CylinderBetween, Housing } from './models/parts'
import { MAINS_ENTRY_CLEARANCE_M } from './models/geometry'
import { createWiringRoutes, wireColor, wiringGeometryKey, type Point3 } from './wiringRoutes'
import { createRoundedWireCurve } from './wireCurves'

function Wire({ points, color, kind, muted }: { points: Point3[]; color: string; kind: string; muted: boolean }) {
  const route = useMemo(
    () => createRoundedWireCurve(points),
    [points],
  )
  const radius = kind === 'power12' || kind === 'ground' ? 0.0027 : 0.0019
  return (
    <mesh>
      <tubeGeometry args={[route, Math.max(24, points.length * 6), radius, 6, false]} />
      <meshStandardMaterial color={color} roughness={0.62} metalness={0.08} transparent opacity={muted ? 0.70 : 0.94} />
    </mesh>
  )
}

function Raceway({ position, size, lidSide = 'front' }: { position: Point3; size: Point3; lidSide?: 'front' | 'outside' | 'top' }) {
  const lidPosition: Point3 = lidSide === 'front'
    ? [0, 0, -size[2] / 2 - 0.002]
    : lidSide === 'outside'
      ? [0, 0, size[2] / 2 + 0.002]
      : [0, size[1] / 2 + 0.002, 0]
  const lidSize: Point3 = lidSide === 'top' ? [size[0], 0.006, size[2]] : [size[0], size[1], 0.006]
  const coverZ = lidSide === 'outside' ? size[2] / 2 + 0.0055 : -size[2] / 2 - 0.0055
  return (
    <group position={position}>
      <Housing position={[0, 0, 0]} size={size} color="#9ba7a2" radius={0.009} metalness={0.38} roughness={0.62} />
      <Housing position={lidPosition} size={lidSize} color="#c4ccc5" radius={0.006} metalness={0.34} roughness={0.55} />
      {size[0] > size[1] ? (
        <group>
          {[-1, 1].map((side) => <mesh key={side} position={[side * size[0] * 0.24, 0, lidSide === 'top' ? size[1] / 2 + 0.0055 : coverZ]}><sphereGeometry args={[0.0035, 8, 6]} /><meshStandardMaterial color="#647174" metalness={0.72} roughness={0.3} /></mesh>)}
        </group>
      ) : null}
    </group>
  )
}

function WallRaceways({ snapshot }: { snapshot: SimulatorSnapshot }) {
  const { room_dimensions: d, layout, mount_dimensions } = snapshot.simulation
  const innerFace = d.depth_m / 2 - d.wall_thickness_m / 2
  const outerFace = d.depth_m / 2 + d.wall_thickness_m / 2
  const insideZ = innerFace - 0.025
  const outsideZ = outerFace + 0.025
  const trunkY = layout.trunk_z
  const racewayWidth = 0.062
  const racewayHeight = 0.12
  const rearWidth = d.width_m - 2 * d.wall_thickness_m
  const cabinetTop = layout.control_cabinet_center[2] + mount_dimensions.control_cabinet_height_m / 2
  const mainsEntryX = layout.control_cabinet_center[0] + mount_dimensions.control_cabinet_width_m / 2 + MAINS_ENTRY_CLEARANCE_M
  const indoorTop = layout.indoor_sensor_center[2] + mount_dimensions.indoor_panel_height_m / 2
  const fanY = d.height_m * 0.81
  const fanX = d.width_m * 0.37
  const fanDropTop = Math.min(trunkY - 0.02, fanY + 0.105)
  const exteriorWidth = Math.abs(layout.outdoor_gland_x - layout.exterior_entry_x)
  const outdoorGlandY = layout.outdoor_gland_z
  const windowLeft = -d.window_width_m / 2 - 0.065
  const windowRight = d.window_width_m / 2 + 0.065

  return (
    <group>
      {/* Surface-mounted interior trunk and drops; the covers stay visible in every view mode. */}
      <Raceway position={[0, trunkY, insideZ]} size={[rearWidth, racewayHeight, racewayWidth]} />
      <Raceway position={[layout.controller_drop_x, (cabinetTop + trunkY) / 2, insideZ]} size={[racewayWidth, trunkY - cabinetTop, racewayWidth]} />
      {/* Mains has its own path from the ceiling to the PSU, separated from the sensor/control trunk. */}
      <Raceway position={[mainsEntryX, (d.height_m + cabinetTop) / 2, insideZ]} size={[racewayWidth, d.height_m - cabinetTop, racewayWidth]} />
      <Raceway position={[layout.indoor_drop_x, (indoorTop + trunkY) / 2, insideZ]} size={[racewayWidth, trunkY - indoorTop, racewayWidth]} />
      {[-fanX, fanX].map((x) => <Raceway key={x} position={[x, (fanDropTop + trunkY) / 2, insideZ]} size={[racewayWidth, trunkY - fanDropTop, racewayWidth]} />)}
      {[windowLeft, windowRight].map((x) => <Raceway key={x} position={[x, (d.window_sill_height_m + trunkY) / 2, insideZ]} size={[racewayWidth, trunkY - d.window_sill_height_m, racewayWidth]} />)}

      {/* A sealed wall sleeve connects the room trunk to the weatherproof exterior raceway. */}
      <CylinderBetween from={[layout.exterior_entry_x, trunkY, insideZ]} to={[layout.exterior_entry_x, trunkY, outsideZ]} radius={0.031} color="#7c8988" segments={16} metalness={0.38} />
      <Raceway position={[(layout.exterior_entry_x + layout.outdoor_gland_x) / 2, trunkY, layout.exterior_channel_y]} size={[Math.max(exteriorWidth, 0.07) + racewayWidth, racewayHeight, racewayWidth]} lidSide="outside" />
      <Raceway position={[layout.outdoor_gland_x, (outdoorGlandY + trunkY) / 2, layout.exterior_channel_y]} size={[racewayWidth, trunkY - outdoorGlandY, racewayWidth]} lidSide="outside" />
    </group>
  )
}

export default function Wiring({ snapshot, visible }: { snapshot: SimulatorSnapshot; visible: boolean }) {
  const geometryKey = wiringGeometryKey(snapshot)
  const routes = useMemo(() => createWiringRoutes(snapshot), [geometryKey])
  const mainsEntryX = snapshot.simulation.layout.control_cabinet_center[0]
    + snapshot.simulation.mount_dimensions.control_cabinet_width_m / 2
    + MAINS_ENTRY_CLEARANCE_M
  return (
    <group>
      <WallRaceways snapshot={snapshot} />
      {visible ? (
        <group>
          {routes.map((route) => <Wire key={route.id} points={route.points} color={wireColor(route.kind)} kind={route.kind} muted={route.kind === 'ground'} />)}
          <Text position={[0, snapshot.simulation.layout.trunk_z + 0.12, snapshot.simulation.room_dimensions.depth_m / 2 - snapshot.simulation.room_dimensions.wall_thickness_m / 2 - 0.04]} fontSize={0.038} color="#405457" anchorX="center" anchorY="bottom" outlineWidth={0.0018} outlineColor="#edf1e9">
            230 V AC · 12 V · 5 V / 3,3 V · GND · I²C / UART · управление приводами
          </Text>
          <Text
            position={[mainsEntryX + 0.04, snapshot.simulation.room_dimensions.height_m - 0.08, snapshot.simulation.room_dimensions.depth_m / 2 - snapshot.simulation.room_dimensions.wall_thickness_m / 2 - 0.035]}
            fontSize={0.027}
            color="#6d5548"
            anchorX="left"
            anchorY="bottom"
            outlineWidth={0.0015}
            outlineColor="#edf1e9"
          >
            Ввод 230 V AC · отдельная трасса к БП
          </Text>
        </group>
      ) : null}
    </group>
  )
}
