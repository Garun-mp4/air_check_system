from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any

from aircheck_simulator_3d.scene.objects import PICKING_MASK_BIT, SceneObject


LOGGER = logging.getLogger("aircheck.application.scene.picking")


class ScenePicker:
    """Ray-based hover and selection. Only explicitly registered scene targets are pickable."""

    def __init__(
        self,
        base: Any,
        objects: dict[str, SceneObject],
        on_hover: Callable[[SceneObject | None], None] | None = None,
        on_selection: Callable[[SceneObject | None], None] | None = None,
    ) -> None:
        from panda3d.core import BitMask32, CollisionHandlerQueue, CollisionNode, CollisionRay
        from panda3d.core import CollisionTraverser

        self._base = base
        self._objects = objects
        self._on_hover = on_hover
        self._on_selection = on_selection
        self._hovered_id: str | None = None
        self._selected_id: str | None = None
        self._traverser = CollisionTraverser("aircheck-scene-picker")
        self._queue = CollisionHandlerQueue()
        ray = CollisionRay()
        ray_node = CollisionNode("aircheck-mouse-ray")
        ray_node.addSolid(ray)
        ray_node.setFromCollideMask(BitMask32.bit(PICKING_MASK_BIT))
        ray_node.setIntoCollideMask(BitMask32.allOff())
        self._ray_path = base.camera.attachNewNode(ray_node)
        self._ray = ray
        self._traverser.addCollider(self._ray_path, self._queue)

    @property
    def hovered(self) -> SceneObject | None:
        return self._objects.get(self._hovered_id) if self._hovered_id else None

    @property
    def selected(self) -> SceneObject | None:
        return self._objects.get(self._selected_id) if self._selected_id else None

    def update(self, enabled: bool = True) -> SceneObject | None:
        target = self._cast() if enabled else None
        target_id = target.object_id if target else None
        if target_id != self._hovered_id:
            previous_id = self._hovered_id
            self._hovered_id = target_id
            self._refresh_highlights(previous_id, target_id)
            if self._on_hover is not None:
                self._on_hover(target)
            LOGGER.debug("Hover target changed: %s", target_id or "none")
        return target

    def select_at_mouse(self) -> SceneObject | None:
        target = self._cast()
        old_id = self._selected_id
        self._selected_id = target.object_id if target else None
        self._refresh_highlights(old_id, self._selected_id)
        if self._on_selection is not None:
            self._on_selection(target)
        LOGGER.info("Scene selection changed: %s", self._selected_id or "none")
        return target

    def select(self, object_id: str | None) -> SceneObject | None:
        if object_id is not None and object_id not in self._objects:
            raise KeyError(f"unknown scene object: {object_id}")
        old_id = self._selected_id
        self._selected_id = object_id
        target = self._objects.get(object_id) if object_id else None
        self._refresh_highlights(old_id, object_id)
        if self._on_selection is not None:
            self._on_selection(target)
        return target

    def _cast(self) -> SceneObject | None:
        watcher = self._base.mouseWatcherNode
        if not watcher.hasMouse():
            return None
        mouse = watcher.getMouse()
        camera_node = self._base.camNode
        if hasattr(camera_node, "node"):
            camera_node = camera_node.node()
        if not self._ray.setFromLens(camera_node, mouse.getX(), mouse.getY()):
            return None
        self._queue.clearEntries()
        self._traverser.traverse(self._base.render)
        if self._queue.getNumEntries() == 0:
            return None
        self._queue.sortEntries()
        for index in range(self._queue.getNumEntries()):
            into_path = self._queue.getEntry(index).getIntoNodePath()
            tagged_path = into_path.findNetTag("aircheck.pick_id")
            if not tagged_path.isEmpty():
                return self._objects.get(tagged_path.getTag("aircheck.pick_id"))
        return None

    def _refresh_highlights(self, *object_ids: str | None) -> None:
        for object_id in set(item for item in object_ids if item is not None):
            target = self._objects.get(object_id)
            if target is not None:
                target.set_highlight(object_id == self._hovered_id, object_id == self._selected_id)

    def close(self) -> None:
        self._traverser.removeCollider(self._ray_path)
        self._ray_path.removeNode()
