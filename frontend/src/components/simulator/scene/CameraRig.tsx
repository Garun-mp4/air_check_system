'use client'

import { useEffect, useRef } from 'react'
import { OrbitControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { PerspectiveCamera, Vector3 } from 'three'

import type { SimulatorSnapshot } from '../types'
import { CameraTransition } from './cameraTransition'
import { CAMERA_MOUSE_BUTTONS, trackCameraKeyDown, trackCameraKeyUp } from './cameraInput'

type Point = [number, number, number]
type CameraCommand = { id: number; focus: Point | null }

function toWorld(point: Point): Point {
  return [point[0], point[2], point[1]]
}

export default function CameraRig({
  snapshot,
  command,
}: {
  snapshot: SimulatorSnapshot
  command: CameraCommand
}) {
  const controls = useRef<OrbitControlsImpl>(null)
  const { camera } = useThree()
  const keys = useRef(new Set<string>())
  const transition = useRef(new CameraTransition())
  const ready = useRef(false)
  const cameraSettings = snapshot.simulation.camera
  const startPosition = toWorld(cameraSettings.start_position)
  const startTarget = toWorld(cameraSettings.start_target)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { trackCameraKeyDown(event, keys.current) }
    const onKeyUp = (event: KeyboardEvent) => { trackCameraKeyUp(event, keys.current) }
    const clear = () => keys.current.clear()
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') clear()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', clear)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', clear)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])

  useEffect(() => {
    const orbit = controls.current
    if (!orbit) return
    const cancelFocus = () => transition.current.cancel()
    orbit.addEventListener('start', cancelFocus)
    return () => orbit.removeEventListener('start', cancelFocus)
  }, [])

  useEffect(() => {
    camera.position.set(...startPosition)
    if (camera instanceof PerspectiveCamera) camera.fov = cameraSettings.field_of_view_degrees
    camera.near = cameraSettings.near_plane_m
    camera.far = cameraSettings.far_plane_m
    camera.updateProjectionMatrix()
    controls.current?.target.set(...startTarget)
    controls.current?.update()
    transition.current.cancel()
    ready.current = true
  }, [camera, cameraSettings.far_plane_m, cameraSettings.field_of_view_degrees, cameraSettings.near_plane_m, startPosition[0], startPosition[1], startPosition[2], startTarget[0], startTarget[1], startTarget[2]])

  useEffect(() => {
    if (!ready.current || !controls.current) return
    const controlsTarget = controls.current.target
    if (command.focus) {
      transition.current.focus(camera.position, controlsTarget, new Vector3(...command.focus))
    } else {
      transition.current.reset(new Vector3(...startPosition), new Vector3(...startTarget))
    }
  }, [command.id])

  useFrame((_, delta) => {
    const orbit = controls.current
    if (!orbit) return
    const direction = camera.getWorldDirection(new Vector3())
    direction.y = 0
    direction.normalize()
    const right = new Vector3().crossVectors(direction, camera.up).normalize()
    const speed = cameraSettings.move_speed_m_s * (keys.current.has('shift') ? cameraSettings.fast_move_multiplier : 1) * delta
    const forward = Number(keys.current.has('w')) - Number(keys.current.has('s'))
    const sideways = Number(keys.current.has('d')) - Number(keys.current.has('a'))
    const vertical = Number(keys.current.has('e')) - Number(keys.current.has('q'))
    if (forward || sideways || vertical) {
      const movement = direction.multiplyScalar(forward * speed).addScaledVector(right, sideways * speed)
      movement.y += vertical * speed
      transition.current.move(camera.position, orbit.target, movement)
    } else {
      transition.current.advance(camera.position, orbit.target, delta, cameraSettings.transition_seconds)
    }
    orbit.update()
  })

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.085}
      minDistance={cameraSettings.focus_distance_min_m ?? 1.1}
      maxDistance={Math.max(24, snapshot.simulation.room_dimensions.outdoor_depth_m * 3)}
      minPolarAngle={Math.PI * 8 / 180}
      maxPolarAngle={Math.PI * 0.94}
      screenSpacePanning
      mouseButtons={CAMERA_MOUSE_BUTTONS}
    />
  )
}
