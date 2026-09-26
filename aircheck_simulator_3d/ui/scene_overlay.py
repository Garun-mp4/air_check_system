from __future__ import annotations

import logging
import webbrowser
from collections.abc import Callable, Mapping
from typing import Any

from aircheck_simulator_3d.app.config import DeveloperParameter, GraphicsConfig, ScenarioPreset
from aircheck_simulator_3d.networking.contracts import BackendForecast
from aircheck_simulator_3d.presentation.visualization_mode import VISUALIZATION_MODES, VisualizationMode
from aircheck_simulator_3d.scene.cutaway import CutawayMode
from aircheck_simulator_3d.scene.objects import SceneObject
from aircheck_simulator_3d.ui.developer_panel import DeveloperPanel
from aircheck_simulator_3d.ui.device_panel import DevicePanel
from aircheck_simulator_3d.ui.hud_panel import HudPanel
from aircheck_simulator_3d.ui.scenario_panel import ScenarioPanel

LOGGER = logging.getLogger("aircheck.application.ui")


class SceneOverlay:
    """Small, live application UI composed from focused HUD and detail panels."""

    _MENU_ITEMS = ("SIM", "SCENARIOS", "VIEW", "DEVICES", "BACKEND", "DASHBOARD", "DEBUG", "HELP")
    _SENSOR_OBJECT_IDS = (
        "sensor.scd41.indoor", "sensor.sps30.indoor", "sensor.sht45.outdoor", "sensor.sps30.outdoor"
    )

    def __init__(
        self,
        base: Any,
        config: GraphicsConfig,
        dashboard_url: str = "",
        browser_open: Callable[[str], bool] | None = None,
        scenarios: tuple[ScenarioPreset, ...] = (),
        developer_parameters: Mapping[str, DeveloperParameter] | None = None,
    ) -> None:
        from direct.gui.DirectGui import DirectButton, DirectFrame, DirectLabel
        from direct.gui import DirectGuiGlobals as DGG
        from direct.gui.OnscreenText import OnscreenText
        from panda3d.core import Filename, TextNode

        self._base = base
        self._aspect = base.getAspectRatio()
        self._dashboard_url = dashboard_url
        self._browser_open = browser_open or webbrowser.open
        self._actions: dict[str, Callable[..., Any]] = {}
        self._modal: str | None = None
        self._visualization_mode = VisualizationMode.NORMAL
        self._backend_online = False
        self._backend_message: str | None = None
        self._forecast: BackendForecast | None = None
        self._last_telemetry_at: str | None = None
        self._pending_commands = 0
        self._state = None
        self._speed_display = 1.0
        self._scenario_name = "Normal Room"
        self._demo_status = None
        font_candidates = (
            config.ui_font_path,
            "C:/Windows/Fonts/segoeui.ttf",
            "C:/Windows/Fonts/arial.ttf",
        )
        self._font = None
        attempted: set[str] = set()
        for font_path in font_candidates:
            if font_path in attempted:
                continue
            attempted.add(font_path)
            try:
                self._font = base.loader.loadFont(str(Filename.fromOsSpecific(font_path)))
            except Exception:
                LOGGER.warning("Could not load UI font candidate %s", font_path, exc_info=True)
            if self._font is not None:
                if font_path != config.ui_font_path:
                    LOGGER.warning("Configured UI font unavailable; using fallback %s", font_path)
                break
        if self._font is None:
            raise RuntimeError(f"could not load a UI font (configured: {config.ui_font_path})")

        self._hud = HudPanel(base, config, self._font)
        self._device_panel = DevicePanel(base, config, self._font)
        self._scenario_panel = ScenarioPanel(base, config, self._font, scenarios, self._select_scenario)
        self._developer_panel = DeveloperPanel(
            base,
            config,
            self._font,
            developer_parameters or {},
            self._adjust_parameter,
            self._step_speed,
        )

        self._top_buttons = []
        commands = (
            self._toggle_simulation,
            self._toggle_scenarios,
            self._cycle_visualization,
            self._toggle_devices,
            self._toggle_backend_details,
            self.open_dashboard,
            self._toggle_developer,
            self._toggle_help,
        )
        for item, callback in zip(self._MENU_ITEMS, commands, strict=True):
            self._top_buttons.append(
                DirectButton(
                    parent=base.aspect2d,
                    text=item,
                    text_fg=(*config.text_rgb, 1),
                    text_scale=0.024,
                    text_font=self._font,
                    frameColor=(0.025, 0.07, 0.1, 0.94),
                    frameSize=(-0.17, 0.17, -0.045, 0.045),
                    command=callback,
                    relief=DGG.RAISED,
                )
            )

        self._mode_buttons = {}
        for mode in VISUALIZATION_MODES:
            button = DirectButton(
                parent=base.aspect2d,
                text=mode.value.upper(),
                text_fg=(*config.text_rgb, 1),
                text_scale=0.022,
                text_font=self._font,
                frameColor=(0.025, 0.07, 0.1, 0.94),
                frameSize=(-0.18, 0.18, -0.043, 0.043),
                command=self._select_visualization,
                extraArgs=[mode],
                relief=DGG.RAISED,
            )
            self._mode_buttons[mode] = button
        self._demo_button = DirectButton(
            parent=base.aspect2d,
            text="AUTO DEMO",
            text_fg=(*config.text_rgb, 1),
            text_scale=0.025,
            text_font=self._font,
            frameColor=(0.035, 0.24, 0.2, 0.98),
            frameSize=(-0.27, 0.27, -0.048, 0.048),
            command=self._start_demo,
            relief=DGG.RAISED,
        )
        self._status = OnscreenText(
            parent=base.aspect2d,
            text="",
            pos=(0, -0.77),
            align=TextNode.ACenter,
            fg=(0.78, 0.89, 0.91, 0.96),
            shadow=(0.01, 0.025, 0.04, 0.8),
            scale=0.026,
            font=self._font,
        )
        self._cursor = OnscreenText(
            parent=base.aspect2d,
            text="·",
            pos=(0, 0),
            align=TextNode.ACenter,
            fg=(0.72, 0.84, 0.87, 0.75),
            scale=0.055,
            mayChange=True,
            font=self._font,
        )
        self._backend_frame = DirectFrame(
            parent=base.aspect2d,
            frameColor=(0.018, 0.052, 0.078, 0.98),
            frameSize=(-0.75, 0.75, -0.50, 0.50),
            pos=(0, 0, 0),
            relief=DGG.FLAT,
            state=DGG.DISABLED,
        )
        self._backend_text = DirectLabel(
            parent=self._backend_frame,
            text="",
            text_fg=(*config.text_rgb, 1),
            text_scale=0.034,
            text_align=TextNode.ALeft,
            text_font=self._font,
            text_wordwrap=42,
            frameColor=(0, 0, 0, 0),
            pos=(-0.66, 0, 0.38),
            relief=DGG.FLAT,
        )
        self._backend_frame.hide()
        self._help_frame = DirectFrame(
            parent=base.aspect2d,
            frameColor=(0.018, 0.052, 0.078, 0.98),
            frameSize=(-0.80, 0.80, -0.67, 0.67),
            pos=(0, 0, 0),
            relief=DGG.FLAT,
            state=DGG.DISABLED,
        )
        self._help_text = DirectLabel(
            parent=self._help_frame,
            text=(
                "AIRCheck 3D SIMULATOR\n\n"
                "W A S D — свободная камера · Q / E — вертикаль · Shift — быстрее\n"
                "ПКМ + мышь — обзор · колесо — наезд · ЛКМ — выбрать устройство\n"
                "F — фокус · R — исходная камера · C — cutaway-режим\n"
                "O / K — окно · I / X — вентиляторы · V — фильтр · Space — пауза\n"
                "1…6 — скорость 1× / 2× / 5× / 10× / 30× / 60×\n\n"
                "Сценарии запускаются из SCENARIOS. AUTO DEMO ждёт прогноз, команду,\n"
                "фактическое исполнение и ACK от AirCheck backend.\n"
                "Нажмите Esc или HELP, чтобы закрыть это окно."
            ),
            text_fg=(*config.text_rgb, 1),
            text_scale=0.038,
            text_align=TextNode.ALeft,
            text_font=self._font,
            text_wordwrap=36,
            frameColor=(0, 0, 0, 0),
            pos=(-0.70, 0, 0.48),
            relief=DGG.FLAT,
        )
        self._help_frame.hide()
        self._layout(self._aspect)

    @property
    def modal_open(self) -> bool:
        return self._modal is not None

    @property
    def visualization_mode(self) -> VisualizationMode:
        return self._visualization_mode

    def set_action_handlers(self, **handlers: Callable[..., Any]) -> None:
        self._actions = dict(handlers)

    def set_simulation_speed(self, speed: float) -> None:
        self._speed_display = speed

    def set_backend_status(
        self,
        online: bool,
        forecast: BackendForecast | None,
        message: str | None = None,
    ) -> None:
        self._backend_online = online
        self._forecast = forecast
        self._backend_message = message

    def set_last_telemetry(self, accepted_at: str) -> None:
        self._last_telemetry_at = accepted_at

    def set_scenario_name(self, name: str) -> None:
        self._scenario_name = name

    def set_visualization_mode(self, mode: VisualizationMode, *, notify: bool = True) -> None:
        if not isinstance(mode, VisualizationMode):
            raise ValueError(f"unsupported visualization mode: {mode!r}")
        self._visualization_mode = mode
        for current, button in self._mode_buttons.items():
            button["frameColor"] = (0.035, 0.25, 0.21, 0.98) if current is mode else (0.025, 0.07, 0.1, 0.94)
        if notify:
            self._invoke("visualization_mode", mode)

    def open_dashboard(self) -> None:
        if not self._dashboard_url:
            return
        try:
            if not self._browser_open(self._dashboard_url):
                LOGGER.warning("could not open AirCheck dashboard URL: %s", self._dashboard_url)
        except Exception:
            LOGGER.exception("failed to open AirCheck dashboard URL")

    def update(
        self,
        cutaway_mode: CutawayMode,
        hovered: SceneObject | None,
        selected: SceneObject | None,
        mouse: tuple[float, float] | None,
        state: Any,
        *,
        pending_commands: int,
        last_telemetry_at: str | None,
        developer_values: Mapping[str, float],
        demo_status: Any,
    ) -> None:
        self._state = state
        self._pending_commands = pending_commands
        self._last_telemetry_at = last_telemetry_at or self._last_telemetry_at
        self._demo_status = demo_status
        phase = demo_status.phase if demo_status is not None else "READY"
        self._hud.update(
            state,
            self._forecast,
            self._backend_online,
            self._scenario_name,
            phase,
        )
        self._device_panel.update(
            selected,
            state,
            backend_online=self._backend_online,
            backend_message=self._backend_message,
            last_telemetry_at=self._last_telemetry_at,
            pending_commands=pending_commands,
        )
        self._developer_panel.update(developer_values, state.simulation_speed)
        wall = {
            CutawayMode.VISIBLE: "VISIBLE",
            CutawayMode.TRANSPARENT: "TRANSPARENT",
            CutawayMode.HIDDEN: "HIDDEN",
        }[cutaway_mode]
        selected_text = f"SELECTED · {selected.title}" if selected is not None else (
            f"HOVER · {hovered.title}" if hovered is not None else ""
        )
        self._status.setText(
            f"WALL {wall}  ·  VIEW {self._visualization_mode.value.upper()}  ·  {selected_text}"
        )
        active_demo = bool(demo_status and demo_status.active)
        self._demo_button["text"] = "STOP DEMO" if active_demo else "AUTO DEMO"
        self._demo_button["command"] = self._stop_demo if active_demo else self._start_demo
        if demo_status is not None and demo_status.phase == "DEMO COMPLETE":
            self._demo_button["text"] = "DEMO COMPLETE"
            self._demo_button["command"] = self._start_demo
        self._backend_text["text"] = self._backend_summary()
        if mouse is None:
            self._cursor.hide()
        else:
            self._cursor.show()
            self._cursor.setPos(mouse[0], mouse[1])
        self._cursor["fg"] = (0.32, 1.0, 0.76, 0.95) if hovered else (0.72, 0.84, 0.87, 0.72)
        self._cursor.setText("+" if hovered else "·")

    def set_menu_open(self, open_: bool) -> None:
        if open_:
            self._open_modal("help")
        elif self._modal == "help":
            self._close_modal()

    def pointer_over_ui(self) -> bool:
        watcher = self._base.mouseWatcherNode
        if not watcher.hasMouse():
            return False
        point = watcher.getMouse()
        x, z = point.getX(), point.getY()
        if self.modal_open:
            return abs(x) <= 1.05 and abs(z) <= 0.82
        if z >= 0.84 or z <= -0.72:
            return True
        left = -self._aspect + 0.02 <= x <= -self._aspect + 0.80 and 0.10 <= z <= 0.77
        right = self._aspect - 0.84 <= x <= self._aspect - 0.02 and -0.17 <= z <= 0.68
        return left or right

    def toggle_devices_panel(self) -> None:
        self._device_panel.set_visible(not self._device_panel.visible)

    def _invoke(self, name: str, *args: Any) -> Any:
        callback = self._actions.get(name)
        return callback(*args) if callback is not None else None

    def _select_scenario(self, scenario_id: str) -> None:
        self._invoke("scenario", scenario_id)
        self._close_modal()

    def _adjust_parameter(self, name: str, direction: int) -> None:
        self._invoke("adjust", name, direction)

    def _step_speed(self, direction: int) -> None:
        self._invoke("speed_step", direction)

    def _select_visualization(self, mode: VisualizationMode) -> None:
        self.set_visualization_mode(mode)

    def _cycle_visualization(self) -> None:
        index = VISUALIZATION_MODES.index(self._visualization_mode)
        self.set_visualization_mode(VISUALIZATION_MODES[(index + 1) % len(VISUALIZATION_MODES)])

    def _toggle_simulation(self) -> None:
        self._invoke("toggle_simulation")

    def _toggle_scenarios(self) -> None:
        self._toggle_modal("scenarios")

    def _toggle_developer(self) -> None:
        self._toggle_modal("developer")

    def _toggle_help(self) -> None:
        self._toggle_modal("help")

    def _toggle_backend_details(self) -> None:
        self._toggle_modal("backend")

    def _toggle_devices(self) -> None:
        self.toggle_devices_panel()

    def _start_demo(self) -> None:
        self._close_modal()
        self._invoke("start_demo")

    def _stop_demo(self) -> None:
        self._invoke("stop_demo")

    def _toggle_modal(self, modal: str) -> None:
        if self._modal == modal:
            self._close_modal()
        else:
            self._open_modal(modal)

    def _open_modal(self, modal: str) -> None:
        self._close_modal()
        self._modal = modal
        for element in (*self._mode_buttons.values(), self._demo_button, self._status):
            element.hide()
        if modal == "scenarios":
            self._scenario_panel.show()
        elif modal == "developer":
            self._developer_panel.show()
        elif modal == "help":
            self._help_frame.show()
        elif modal == "backend":
            self._backend_frame.show()

    def _close_modal(self) -> None:
        self._scenario_panel.hide()
        self._developer_panel.hide()
        self._help_frame.hide()
        self._backend_frame.hide()
        self._modal = None
        for element in (*self._mode_buttons.values(), self._demo_button, self._status):
            element.show()

    def _backend_summary(self) -> str:
        status = "ONLINE" if self._backend_online else "OFFLINE"
        if self._backend_message:
            status += f"\nStatus detail: {self._backend_message}"
        forecast = self._forecast
        prediction = (
            f"{forecast.predicted_co2_15min:.0f} ppm"
            if forecast is not None
            else "not available"
        )
        model = forecast.model_name if forecast and forecast.model_name else "—"
        return (
            f"BACKEND / {status}\n\n"
            f"Device: {self._state.controller.device_id if self._state else '—'}\n"
            f"Last telemetry: {self._last_telemetry_at or 'not sent yet'}\n"
            f"Commands executing: {self._pending_commands}\n"
            f"CO2 forecast (+15 min): {prediction}\n"
            f"ML model: {model}\n\n"
            "Backend status and forecast are received from the existing AirCheck API."
        )

    def on_resize(self, aspect: float) -> None:
        self._aspect = aspect
        self._layout(aspect)
        self._hud.on_resize(aspect)
        self._device_panel.on_resize(aspect)

    def _layout(self, aspect: float) -> None:
        start = -aspect + 0.32
        end = aspect - 0.32
        step = (end - start) / max(1, len(self._top_buttons) - 1)
        for index, button in enumerate(self._top_buttons):
            button.setPos(start + index * step, 0, 0.92)
        mode_start = -min(1.12, aspect - 0.18)
        mode_end = -mode_start
        mode_step = (mode_end - mode_start) / max(1, len(self._mode_buttons) - 1)
        for index, button in enumerate(self._mode_buttons.values()):
            button.setPos(mode_start + index * mode_step, 0, -0.91)
        self._demo_button.setPos(0, 0, -0.68)

    def close(self) -> None:
        self._close_modal()
        self._hud.close()
        self._device_panel.close()
        self._scenario_panel.close()
        self._developer_panel.close()
        for element in (
            *self._top_buttons,
            *self._mode_buttons.values(),
            self._demo_button,
            self._status,
            self._cursor,
            self._backend_frame,
            self._help_frame,
        ):
            element.destroy()
