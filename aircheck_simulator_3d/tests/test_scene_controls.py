from panda3d.core import (
    BitMask32,
    Camera,
    CollisionBox,
    CollisionNode,
    NodePath,
    PandaNode,
    PerspectiveLens,
    Point2,
    Point3,
    TransparencyAttrib,
)

from aircheck_simulator_3d.app.config import load_config
from aircheck_simulator_3d.presentation.camera_controller import _lerp_angle
from aircheck_simulator_3d.presentation.viewport import apply_window_aspect, window_aspect_ratio
from aircheck_simulator_3d.scene.cutaway import CutawayController, CutawayMode
from aircheck_simulator_3d.scene.objects import PICKING_MASK_BIT, SceneObject
from aircheck_simulator_3d.scene.picking import ScenePicker
from aircheck_simulator_3d.scene.scene_builder import StandScene


def _wall() -> tuple[SceneObject, NodePath]:
    node = NodePath(PandaNode("wall"))
    visual = node.attachNewNode(PandaNode("wall-visual"))
    collision = CollisionNode("wall-picker")
    collision.addSolid(CollisionBox(Point3(0), 1, 1, 1))
    collider = node.attachNewNode(collision)
    return SceneObject("wall.cutaway", "Wall", "Cutaway wall", node, visual, collider, (0, 0, 0)), visual


def test_default_camera_and_stand_config_are_externalized() -> None:
    config = load_config()

    assert config.scene.room_width_m == 6.0
    assert config.scene.window_width_m < config.scene.room_width_m
    assert config.camera.start_position != config.camera.start_target
    assert config.graphics.shadows_enabled


def test_stand_contains_physical_aircheck_devices_and_pick_targets() -> None:
    config = load_config()
    base = type("SceneBase", (), {})()
    base.render = NodePath(PandaNode("render"))
    base.loader = None
    scene = StandScene(base, config.scene)
    required = {
        "stand.platform",
        "room.floor",
        "room.ceiling",
        "wall.cutaway",
        "window.assembly",
        "environment.outdoor",
        "device.esp32",
        "sensor.scd41.indoor",
        "sensor.sps30.indoor",
        "sensor.sht45.outdoor",
        "sensor.sps30.outdoor",
        "window.reed_switch",
        "window.magnet",
        "window.actuator",
        "window.limit_open",
        "window.limit_close",
        "fan.intake",
        "fan.exhaust",
        "power.psu_12v",
        "power.dc_dc",
        "power.mosfet_module",
        "power.h_bridge",
        "power.fuses",
        "power.terminal_blocks",
    }
    try:
        assert required.issubset(scene.objects)
        assert scene.root.find("**/window-movable-glass").isEmpty() is False
        assert scene.root.find("**/rear-wall-section-1").isEmpty() is False
        assert scene.root.find("**/intake-filter-pleat-1").isEmpty() is False
        assert scene.root.find("**/outdoor-weather-hood").isEmpty() is False
        assert scene.root.find("**/power-12v-intake").isEmpty() is False
    finally:
        scene.close()


def test_mouse_ray_can_select_each_required_device_target() -> None:
    config = load_config()
    render = NodePath(PandaNode("render"))
    lens = PerspectiveLens()
    lens.setFov(52)
    camera_path = render.attachNewNode(Camera("camera", lens))
    base = type("SceneBase", (), {})()
    base.render = render
    base.camera = camera_path
    base.camNode = camera_path
    base.mouseWatcherNode = _MouseWatcher()
    scene = StandScene(base, config.scene)
    cutaway = CutawayController(scene.cutaway_wall)
    picker = ScenePicker(base, scene.objects)
    required = (
        "device.esp32",
        "sensor.scd41.indoor",
        "sensor.sps30.indoor",
        "sensor.sht45.outdoor",
        "sensor.sps30.outdoor",
        "window.reed_switch",
        "window.magnet",
        "window.actuator",
        "window.limit_open",
        "window.limit_close",
        "fan.intake",
        "fan.exhaust",
        "power.psu_12v",
        "power.dc_dc",
        "power.mosfet_module",
        "power.h_bridge",
    )
    try:
        for object_id in required:
            target = scene.objects[object_id]
            position = target.node.getPos(render)
            point = Point3(position.getX(), position.getY(), position.getZ())
            if object_id == "window.magnet":
                camera_offset = Point3(-2.0, 0, 0)
            elif object_id.endswith(".outdoor"):
                camera_offset = Point3(0, 2.0, 0)
            else:
                camera_offset = Point3(0, -2.0, 0)
            camera_path.setPos(render, point + camera_offset)
            camera_path.lookAt(render, point)
            projected = Point2()
            assert lens.project(camera_path.getRelativePoint(render, point), projected)
            base.mouseWatcherNode.point = projected
            selected = picker.update()
            assert selected is not None and selected.object_id == object_id
    finally:
        picker.close()
        scene.close()


def test_cutaway_modes_update_visibility_transparency_and_picker_mask() -> None:
    wall, visual = _wall()
    controller = CutawayController(wall)
    pick_mask = BitMask32.bit(PICKING_MASK_BIT)

    assert controller.mode is CutawayMode.TRANSPARENT
    assert visual.getState().hasAttrib(TransparencyAttrib.getClassType())
    assert wall.collider.node().getIntoCollideMask().isZero()

    controller.set_mode(CutawayMode.VISIBLE)
    assert not wall.node.isHidden()
    assert not visual.getState().hasAttrib(TransparencyAttrib.getClassType())
    assert wall.collider.node().getIntoCollideMask() == pick_mask

    controller.cycle()
    assert controller.mode is CutawayMode.TRANSPARENT
    controller.cycle()
    assert controller.mode is CutawayMode.HIDDEN
    assert wall.node.isHidden()
    assert wall.collider.node().getIntoCollideMask().isZero()

    controller.cycle()
    assert controller.mode is CutawayMode.VISIBLE
    assert not wall.node.isHidden()


def test_angle_interpolation_uses_shortest_path() -> None:
    assert _lerp_angle(179, -179, 0.5) == 180
    assert _lerp_angle(20, 80, 0.5) == 50


def test_resize_updates_camera_lens_and_ui_layout_aspect() -> None:
    lens = PerspectiveLens()
    seen: list[float] = []
    aspect = window_aspect_ratio(1440, 900)
    assert aspect == 1.6
    apply_window_aspect(aspect, lens, seen.append)
    assert abs(lens.getAspectRatio() - aspect) < 1e-6
    assert seen == [aspect]
    assert window_aspect_ratio(1440, 0) == 0


class _MouseWatcher:
    def __init__(self) -> None:
        self.point = Point2(0, 0)

    def hasMouse(self) -> bool:
        return True

    def getMouse(self) -> Point2:
        return self.point


def test_picker_tracks_hover_selection_and_clears_on_empty_click() -> None:
    from aircheck_simulator_3d.scene.objects import register_pickable

    render = NodePath(PandaNode("render"))
    lens = PerspectiveLens()
    lens.setFov(52)
    camera_path = render.attachNewNode(Camera("camera", lens))
    camera_path.setPos(0, -5, 0)
    camera_path.lookAt(render, Point3(0, 0, 0))
    node = render.attachNewNode(PandaNode("target"))
    target = register_pickable(
        node,
        object_id="zone.test",
        title="Test zone",
        description="A pickable test volume.",
        half_extents=(0.5, 0.5, 0.5),
    )
    base = type("Base", (), {})()
    base.camera = camera_path
    base.camNode = camera_path
    base.render = render
    base.mouseWatcherNode = _MouseWatcher()
    picker = ScenePicker(base, {target.object_id: target})
    try:
        assert picker.update() is target
        assert target.is_hovered
        assert picker.select_at_mouse() is target
        assert picker.selected is target
        assert target.is_selected
        base.mouseWatcherNode.point = Point2(0.95, 0.95)
        assert picker.update() is None
        assert picker.hovered is None
        assert picker.select_at_mouse() is None
        assert picker.selected is None
    finally:
        picker.close()


class _FakeWindow:
    def __init__(self) -> None:
        self.width = 1000
        self.height = 800
        self.pointer = (500, 400)
        self.cursor_hidden = False

    def getPointer(self, _: int) -> "_FakeWindow":
        return self

    def getX(self) -> int:
        return self.pointer[0]

    def getY(self) -> int:
        return self.pointer[1]

    def getXSize(self) -> int:
        return self.width

    def getYSize(self) -> int:
        return self.height

    def movePointer(self, _pointer: int, x: int, y: int) -> None:
        self.pointer = (x, y)

    def requestProperties(self, properties: object) -> None:
        self.cursor_hidden = properties.getCursorHidden()


def _fake_camera_base() -> tuple[object, NodePath, _FakeWindow]:
    from aircheck_simulator_3d.app.config import load_config

    render = NodePath(PandaNode("render"))
    lens = PerspectiveLens()
    camera_path = render.attachNewNode(Camera("camera", lens))
    base = type("Base", (), {})()
    base.render = render
    base.camera = camera_path
    base.camLens = lens
    base.win = _FakeWindow()
    base.disableMouse = lambda: None
    return base, camera_path, base.win


def test_camera_fly_motion_wheel_rmb_focus_and_reset() -> None:
    from aircheck_simulator_3d.app.config import load_config
    from aircheck_simulator_3d.presentation.camera_controller import CameraController

    base, camera_path, window = _fake_camera_base()
    config = load_config().camera
    camera = CameraController(base, config)
    orientation = camera_path.getQuat(base.render)
    directions = {
        "w": orientation.getForward(),
        "s": -orientation.getForward(),
        "a": -orientation.getRight(),
        "d": orientation.getRight(),
        "q": Point3(0, 0, -1) - Point3(0, 0, 0),
        "e": Point3(0, 0, 1) - Point3(0, 0, 0),
    }
    for key, expected_direction in directions.items():
        camera.reset(animate=False)
        start = camera_path.getPos(base.render)
        camera.set_key(key, True)
        camera.update(0.1)
        camera.set_key(key, False)
        displacement = camera_path.getPos(base.render) - start
        assert displacement.length() > 0.01
        assert displacement.normalized().dot(expected_direction.normalized()) > 0.9

    camera.reset(animate=False)
    for _ in range(6):
        camera.set_key("w", True)
        camera.update(0.1)
    normal_distance = (camera_path.getPos(base.render) - Point3(*config.start_position)).length()
    camera.reset(animate=False)
    for _ in range(6):
        camera.set_key("w", True)
        camera.set_key("shift", True)
        camera.update(0.1)
    fast_distance = (camera_path.getPos(base.render) - Point3(*config.start_position)).length()
    assert fast_distance > normal_distance * 2
    camera.set_key("w", False)
    camera.set_key("shift", False)

    camera.add_wheel_step(1)
    before_wheel = camera_path.getPos(base.render)
    for _ in range(8):
        camera.update(0.1)
    assert camera_path.getPos(base.render) != before_wheel

    heading_before = camera_path.getH(base.render)
    camera.set_looking(True)
    assert window.cursor_hidden
    window.pointer = (window.width // 2 + 80, window.height // 2 - 24)
    camera.update(0.016)
    assert camera_path.getH(base.render) != heading_before
    assert window.pointer == (window.width // 2, window.height // 2)
    camera.set_looking(False)
    assert not window.cursor_hidden

    camera.focus((0, 0, 0))
    for _ in range(8):
        camera.update(0.1)
    focus_direction = -camera_path.getPos(base.render)
    focus_direction.normalize()
    view_direction = camera_path.getQuat(base.render).getForward()
    assert view_direction.dot(focus_direction) > 0.98

    camera.reset()
    for _ in range(8):
        camera.update(0.1)
    assert (camera_path.getPos(base.render) - Point3(*config.start_position)).length() < 0.01


def test_input_bindings_route_escape_cutaway_and_camera_actions() -> None:
    from aircheck_simulator_3d.presentation.camera_controller import CameraController
    from aircheck_simulator_3d.presentation.input_controller import InputController

    base, camera_path, window = _fake_camera_base()
    handlers: dict[str, tuple[object, list[object]]] = {}

    def accept(event: str, callback: object, extra_args: list[object]) -> None:
        handlers[event] = (callback, extra_args)

    base.accept = accept
    base.ignore = lambda event: handlers.pop(event, None)
    config = load_config()
    camera = CameraController(base, config.camera)
    wall, _ = _wall()
    cutaway = CutawayController(wall)
    selected_object = type("Selected", (), {"node": camera_path, "focus_point": (0, 0, 0)})()
    picker = type("Picker", (), {"selected": selected_object, "select_at_mouse": lambda self: selected_object})()
    menu_changes: list[bool] = []
    controls = InputController(base, camera, picker, cutaway, menu_changes.append)

    callback, args = handlers["w"]
    callback(*args)
    camera.update(0.1)
    callback, args = handlers["w-up"]
    callback(*args)
    assert camera_path.getPos(base.render) != Point3(*config.camera.start_position)

    handlers["mouse3"][0](*handlers["mouse3"][1])
    assert camera.looking and window.cursor_hidden
    handlers["mouse3-up"][0](*handlers["mouse3-up"][1])
    assert not camera.looking and not window.cursor_hidden

    original_mode = cutaway.mode
    handlers["c"][0](*handlers["c"][1])
    assert cutaway.mode is not original_mode
    handlers["escape"][0](*handlers["escape"][1])
    assert controls.menu_open and menu_changes[-1] is True
    handlers["escape"][0](*handlers["escape"][1])
    assert not controls.menu_open and menu_changes[-1] is False

    controls.close()
    assert not handlers
