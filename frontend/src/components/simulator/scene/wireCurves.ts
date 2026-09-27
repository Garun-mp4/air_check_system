import { CurvePath, LineCurve3, QuadraticBezierCurve3, Vector3 } from 'three'
import type { Point3 } from './wiringRoutes'

const POINT_EPSILON_M = 0.0001
export const WIRE_CORNER_RADIUS_M = 0.018

/**
 * Keep wiring inside its orthogonal route and soften only the actual corners.
 * A Catmull-Rom spline can overshoot these right-angle routes and form large
 * loops above the wall, which is especially visible in the wiring view.
 */
export function createRoundedWireCurve(points: readonly Point3[]): CurvePath<Vector3> {
  if (points.length < 2 || points.some((point) => point.some((coordinate) => !Number.isFinite(coordinate)))) {
    throw new Error('A wire route needs at least two finite points')
  }

  const vertices = points.reduce<Vector3[]>((unique, point) => {
    const vertex = new Vector3(...point)
    if (unique.length === 0 || unique[unique.length - 1].distanceTo(vertex) > POINT_EPSILON_M) unique.push(vertex)
    return unique
  }, [])
  if (vertices.length < 2) throw new Error('A wire route needs at least two distinct points')

  const curve = new CurvePath<Vector3>()
  let current = vertices[0].clone()

  for (let index = 1; index < vertices.length - 1; index += 1) {
    const previous = vertices[index - 1]
    const corner = vertices[index]
    const next = vertices[index + 1]
    const incomingLength = previous.distanceTo(corner)
    const outgoingLength = corner.distanceTo(next)
    const incoming = corner.clone().sub(previous).normalize()
    const outgoing = next.clone().sub(corner).normalize()
    const directionDot = incoming.dot(outgoing)

    // Collinear points need no bend. A reversal is retained as a hard turn.
    if (directionDot > 0.9999 || directionDot < -0.9999) continue

    const radius = Math.min(WIRE_CORNER_RADIUS_M, incomingLength * 0.45, outgoingLength * 0.45)
    if (radius <= POINT_EPSILON_M) continue

    const beforeCorner = corner.clone().addScaledVector(incoming, -radius)
    const afterCorner = corner.clone().addScaledVector(outgoing, radius)
    addLine(curve, current, beforeCorner)
    curve.add(new QuadraticBezierCurve3(beforeCorner, corner.clone(), afterCorner))
    current = afterCorner
  }

  addLine(curve, current, vertices[vertices.length - 1])
  return curve
}

function addLine(curve: CurvePath<Vector3>, start: Vector3, end: Vector3): void {
  if (start.distanceTo(end) > POINT_EPSILON_M) curve.add(new LineCurve3(start.clone(), end.clone()))
}
