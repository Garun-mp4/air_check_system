import { Vector3 } from 'three'

export class CameraTransition {
  private readonly positionGoal = new Vector3()
  private readonly targetGoal = new Vector3()
  active = false

  focus(cameraPosition: Vector3, target: Vector3, focusPoint: Vector3): void {
    const offset = focusPoint.clone().sub(target)
    this.positionGoal.copy(cameraPosition).add(offset)
    this.targetGoal.copy(focusPoint)
    this.active = true
  }

  reset(position: Vector3, target: Vector3): void {
    this.positionGoal.copy(position)
    this.targetGoal.copy(target)
    this.active = true
  }

  cancel(): void {
    this.active = false
  }

  move(cameraPosition: Vector3, target: Vector3, movement: Vector3): void {
    this.cancel()
    cameraPosition.add(movement)
    target.add(movement)
  }

  advance(cameraPosition: Vector3, target: Vector3, delta: number, duration: number): void {
    if (!this.active) return

    const easing = 1 - Math.exp(-delta / Math.max(0.08, duration))
    cameraPosition.lerp(this.positionGoal, easing)
    target.lerp(this.targetGoal, easing)
    if (cameraPosition.distanceToSquared(this.positionGoal) < 0.0001
      && target.distanceToSquared(this.targetGoal) < 0.0001) {
      cameraPosition.copy(this.positionGoal)
      target.copy(this.targetGoal)
      this.cancel()
    }
  }
}
