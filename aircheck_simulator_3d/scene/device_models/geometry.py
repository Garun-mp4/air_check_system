from __future__ import annotations

import math
from collections.abc import Sequence
from typing import Any

from aircheck_simulator_3d.scene.objects import SceneObject, add_world_label, make_box, register_pickable


def make_cylinder(
    parent: Any,
    name: str,
    center: tuple[float, float, float],
    radius: float,
    length: float,
    color: tuple[float, float, float, float],
    *,
    axis: str = "y",
    segments: int = 16,
) -> Any:
    """Create a small flat-shaded cylinder along the selected room axis."""
    from panda3d.core import Geom, GeomNode, GeomTriangles, GeomVertexData, GeomVertexFormat, GeomVertexWriter

    data = GeomVertexData(name, GeomVertexFormat.getV3n3(), Geom.UHStatic)
    vertices = GeomVertexWriter(data, "vertex")
    normals = GeomVertexWriter(data, "normal")
    primitive = GeomTriangles(Geom.UHStatic)
    half_length = length / 2

    def ring_point(index: int, axial: float) -> tuple[tuple[float, float, float], tuple[float, float, float]]:
        angle = 2 * 3.141592653589793 * index / segments
        c, s = math.cos(angle), math.sin(angle)
        if axis == "y":
            return (radius * c, axial, radius * s), (c, 0, s)
        if axis == "z":
            return (radius * c, radius * s, axial), (c, s, 0)
        if axis == "x":
            return (axial, radius * c, radius * s), (0, c, s)
        raise ValueError("cylinder axis must be x, y or z")

    for index in range(segments):
        for axial in (-half_length, half_length):
            point, normal = ring_point(index, axial)
            vertices.addData3f(*point)
            normals.addData3f(*normal)
    for index in range(segments):
        current = index * 2
        following = ((index + 1) % segments) * 2
        primitive.addVertices(current, current + 1, following + 1)
        primitive.addVertices(current, following + 1, following)

    bottom_center_index = segments * 2
    top_center_index = bottom_center_index + 1
    cap_normal = {"x": (1, 0, 0), "y": (0, 1, 0), "z": (0, 0, 1)}[axis]
    negative_normal = tuple(-component for component in cap_normal)
    cap_centers = {
        "x": ((-half_length, 0, 0), (half_length, 0, 0)),
        "y": ((0, -half_length, 0), (0, half_length, 0)),
        "z": ((0, 0, -half_length), (0, 0, half_length)),
    }[axis]
    for point, normal in zip(cap_centers, (negative_normal, cap_normal)):
        vertices.addData3f(*point)
        normals.addData3f(*normal)
    for index in range(segments):
        next_index = (index + 1) % segments
        if axis == "y":
            primitive.addVertices(bottom_center_index, index * 2, next_index * 2)
            primitive.addVertices(top_center_index, next_index * 2 + 1, index * 2 + 1)
        else:
            primitive.addVertices(bottom_center_index, next_index * 2, index * 2)
            primitive.addVertices(top_center_index, index * 2 + 1, next_index * 2 + 1)
    primitive.closePrimitive()
    geom = Geom(data)
    geom.addPrimitive(primitive)
    geom_node = GeomNode(name)
    geom_node.addGeom(geom)
    result = parent.attachNewNode(geom_node)
    result.setName(name)
    result.setPos(*center)
    result.setColor(*color)
    return result


def create_pickable_part(
    parent: Any,
    *,
    object_id: str,
    title: str,
    description: str,
    position: tuple[float, float, float],
    half_extents: tuple[float, float, float],
) -> tuple[SceneObject, Any]:
    from panda3d.core import PandaNode

    node = parent.attachNewNode(PandaNode(object_id))
    node.setPos(*position)
    visual = node.attachNewNode(PandaNode(object_id + "-model"))
    obj = register_pickable(
        node,
        object_id=object_id,
        title=title,
        description=description,
        half_extents=half_extents,
        visual=visual,
    )
    return obj, visual


def add_louver_panel(
    parent: Any,
    *,
    name: str,
    width: float,
    height: float,
    y: float,
    count: int,
    color: tuple[float, float, float, float] = (0.22, 0.29, 0.3, 1),
) -> None:
    slot_height = height * 0.045
    gap = height / (count + 1)
    for index in range(count):
        z = -height / 2 + gap * (index + 1)
        make_box(parent, f"{name}-slot-{index + 1}", (0, y, z), (width, 0.018, slot_height), color)


def add_mounting_panel(
    parent: Any,
    *,
    name: str,
    size: tuple[float, float, float],
    color: tuple[float, float, float, float] = (0.24, 0.3, 0.31, 1),
) -> None:
    width, depth, height = size
    make_box(parent, name + "-plate", (0, 0, 0), size, color, specular=(0.3, 0.34, 0.35), shininess=46)
    edge = min(depth, width, height) * 0.11
    for x in (-width / 2 + edge / 2, width / 2 - edge / 2):
        for z in (-height / 2 + edge / 2, height / 2 - edge / 2):
            make_box(parent, f"{name}-bolt-{x:.2f}-{z:.2f}", (x, -depth / 2 - 0.012, z), (edge, 0.026, edge), (0.72, 0.76, 0.74, 1), specular=(0.8, 0.8, 0.78), shininess=80)


def add_cable(
    parent: Any,
    name: str,
    points: Sequence[tuple[float, float, float]],
    color: tuple[float, float, float, float],
    *,
    thickness: float = 3.0,
) -> Any:
    from panda3d.core import LineSegs

    if len(points) < 2:
        raise ValueError("a cable route needs at least two points")
    lines = LineSegs(name)
    lines.setThickness(thickness)
    lines.setColor(*color)
    lines.moveTo(*points[0])
    for point in points[1:]:
        lines.drawTo(*point)
    path = parent.attachNewNode(lines.create())
    path.setName(name)
    path.setLightOff(1)
    return path


def add_label(parent: Any, text: str, position: tuple[float, float, float], scale: float = 0.105) -> Any:
    return add_world_label(parent, text, position, scale)
