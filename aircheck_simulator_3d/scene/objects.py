from __future__ import annotations

from dataclasses import dataclass
from typing import Any


PICKING_MASK_BIT = 2


@dataclass
class SceneObject:
    object_id: str
    title: str
    description: str
    node: Any
    visual: Any
    collider: Any
    focus_point: tuple[float, float, float]
    is_hovered: bool = False
    is_selected: bool = False

    def set_highlight(self, hovered: bool, selected: bool) -> None:
        self.is_hovered = hovered
        self.is_selected = selected
        if selected:
            self.node.setColorScale(0.58, 0.91, 1.28, 1)
        elif hovered:
            self.node.setColorScale(1.22, 1.08, 0.62, 1)
        else:
            self.node.clearColorScale()


def make_box(
    parent: Any,
    name: str,
    center: tuple[float, float, float],
    size: tuple[float, float, float],
    color: tuple[float, float, float, float],
    *,
    specular: tuple[float, float, float] = (0.14, 0.17, 0.2),
    shininess: float = 24.0,
) -> Any:
    from panda3d.core import (
        Geom,
        GeomNode,
        GeomTriangles,
        GeomVertexData,
        GeomVertexFormat,
        GeomVertexWriter,
        LColor,
        Material,
        TransparencyAttrib,
    )

    faces = (
        ((1, 0, 0), ((1, -1, -1), (1, 1, -1), (1, 1, 1), (1, -1, 1))),
        ((-1, 0, 0), ((-1, 1, -1), (-1, -1, -1), (-1, -1, 1), (-1, 1, 1))),
        ((0, 1, 0), ((1, 1, -1), (-1, 1, -1), (-1, 1, 1), (1, 1, 1))),
        ((0, -1, 0), ((-1, -1, -1), (1, -1, -1), (1, -1, 1), (-1, -1, 1))),
        ((0, 0, 1), ((-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1))),
        ((0, 0, -1), ((-1, 1, -1), (1, 1, -1), (1, -1, -1), (-1, -1, -1))),
    )
    data = GeomVertexData(name, GeomVertexFormat.getV3n3(), Geom.UHStatic)
    vertices = GeomVertexWriter(data, "vertex")
    normals = GeomVertexWriter(data, "normal")
    triangles = GeomTriangles(Geom.UHStatic)
    for face_index, (normal, points) in enumerate(faces):
        start = face_index * 4
        for point in points:
            vertices.addData3f(*point)
            normals.addData3f(*normal)
        triangles.addVertices(start, start + 1, start + 2)
        triangles.addVertices(start, start + 2, start + 3)
    triangles.closePrimitive()
    geom = Geom(data)
    geom.addPrimitive(triangles)
    geom_node = GeomNode(name)
    geom_node.addGeom(geom)
    visual = parent.attachNewNode(geom_node)
    visual.setName(name)
    visual.setScale(size[0] / 2, size[1] / 2, size[2] / 2)
    visual.setPos(*center)

    material = Material(name + "-material")
    material.setDiffuse(LColor(*color))
    material.setSpecular(LColor(*specular, 1))
    material.setShininess(shininess)
    visual.setMaterial(material, 1)
    visual.setColor(*color)
    if color[3] < 1:
        visual.setTransparency(TransparencyAttrib.MAlpha)
        visual.setDepthWrite(False)
        visual.setBin("transparent", 10)
    return visual


def register_pickable(
    parent: Any,
    *,
    object_id: str,
    title: str,
    description: str,
    half_extents: tuple[float, float, float],
    focus_point: tuple[float, float, float] = (0, 0, 0),
    visual: Any | None = None,
) -> SceneObject:
    from panda3d.core import BitMask32, CollisionBox, CollisionNode, PandaNode, Point3

    parent.setTag("aircheck.pick_id", object_id)
    collider_node = CollisionNode(object_id + "-pick-volume")
    collider_node.setFromCollideMask(BitMask32.allOff())
    collider_node.setIntoCollideMask(BitMask32.bit(PICKING_MASK_BIT))
    collider_node.addSolid(CollisionBox(Point3(0, 0, 0), *half_extents))
    collider = parent.attachNewNode(collider_node)
    return SceneObject(
        object_id=object_id,
        title=title,
        description=description,
        node=parent,
        visual=visual if visual is not None else parent,
        collider=collider,
        focus_point=focus_point,
    )


def add_world_label(parent: Any, text: str, position: tuple[float, float, float], scale: float = 0.13) -> Any:
    from panda3d.core import TextNode

    label = TextNode("aircheck-label-" + text.casefold().replace(" ", "-"))
    label.setText(text)
    label.setAlign(TextNode.ACenter)
    label.setTextColor(0.76, 0.9, 0.94, 1)
    label.setShadow(0.02, 0.02)
    label.setShadowColor(0.02, 0.05, 0.08, 0.8)
    label_path = parent.attachNewNode(label)
    label_path.setPos(*position)
    label_path.setScale(scale)
    label_path.setBillboardPointEye()
    label_path.setLightOff(1)
    return label_path
