import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'

import { CameraTransition } from './cameraTransition'

describe('CameraTransition', () => {
  it('keeps keyboard movement instead of easing back to the picked object', () => {
    const transition = new CameraTransition()
    const cameraPosition = new Vector3(6, 3, -8)
    const orbitTarget = new Vector3(0, 1, 0)
    const focusPoint = new Vector3(2, 1.5, 0.5)

    transition.focus(cameraPosition, orbitTarget, focusPoint)
    transition.move(cameraPosition, orbitTarget, new Vector3(0, 0, -0.2))

    const movedCameraPosition = cameraPosition.clone()
    const movedOrbitTarget = orbitTarget.clone()
    transition.advance(cameraPosition, orbitTarget, 1 / 60, 0.55)

    expect(transition.active).toBe(false)
    expect(cameraPosition.distanceTo(movedCameraPosition)).toBe(0)
    expect(orbitTarget.distanceTo(movedOrbitTarget)).toBe(0)
  })

  it('stops easing as soon as the user starts an OrbitControls gesture', () => {
    const transition = new CameraTransition()
    const cameraPosition = new Vector3(6, 3, -8)
    const orbitTarget = new Vector3(0, 1, 0)

    transition.focus(cameraPosition, orbitTarget, new Vector3(2, 1.5, 0.5))
    transition.cancel()
    cameraPosition.add(new Vector3(0.1, 0, 0))

    const adjustedCameraPosition = cameraPosition.clone()
    transition.advance(cameraPosition, orbitTarget, 1 / 60, 0.55)

    expect(transition.active).toBe(false)
    expect(cameraPosition.distanceTo(adjustedCameraPosition)).toBe(0)
  })

  it('still eases to the selected object when the user leaves the camera alone', () => {
    const transition = new CameraTransition()
    const cameraPosition = new Vector3(6, 3, -8)
    const orbitTarget = new Vector3(0, 1, 0)
    const focusPoint = new Vector3(2, 1.5, 0.5)
    const positionOffset = cameraPosition.clone().sub(orbitTarget)

    transition.focus(cameraPosition, orbitTarget, focusPoint)
    transition.advance(cameraPosition, orbitTarget, 10, 0.55)

    expect(transition.active).toBe(false)
    expect(orbitTarget.distanceTo(focusPoint)).toBeLessThan(0.01)
    expect(cameraPosition.distanceTo(focusPoint.clone().add(positionOffset))).toBeLessThan(0.01)
  })
})
