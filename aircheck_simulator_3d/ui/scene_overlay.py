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
from aircheck_simulator_3d.ui.layout import overlay_layout
from aircheck_simulator_3d.ui.scenario_panel import ScenarioPanel
from aircheck_simulator_3d.ui.theme import THEME

LOGGER = logging.getLogger("aircheck.application.ui")

MODE_LABELS_RU = {
    VisualizationMode.NORMAL: "ОБЫЧНЫЙ",
    VisualizationMode.AIRFLOW: "ПОТОК",
    VisualizationMode.SENSORS: "ДАТЧИКИ",
    VisualizationMode.WIRING: "ПРОВОДА",
    VisualizationMode.TECHNICAL: "ТЕХНИКА",
}


class SceneOverlay:
    """Screen-space navigation and live information for the 3D stand."""

    _MENU_ITEMS = ("СИМУЛЯЦИЯ", "СЦЕНАРИИ", "УСТРОЙСТВА", "ИНСТРУМЕНТЫ")
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
        self._tools_open = False
        self._tools_x = 0.0
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

        self._header = DirectFrame(
            parent=base.aspect2d,
            frameColor=THEME.panel_elevated,
            frameSize=(-self._aspect, self._aspect, -0.08, 0.08),
            pos=(0, 0, 0.91),
            relief=DGG.FLAT,
            state=DGG.DISABLED,
        )
        self._brand = DirectLabel(
            parent=base.aspect2d,
            text="AIRCHECK 3D",
            text_fg=THEME.ink,
            text_scale=0.038,
            text_font=self._font,
            text_align=TextNode.ALeft,
            frameColor=(0, 0, 0, 0),
            pos=(0, 0, 0.93),
            relief=DGG.FLAT,
        )
        self._brand_subtitle = DirectLabel(
            parent=base.aspect2d,
            text="ЦИФРОВОЙ СТЕНД",
            text_fg=THEME.muted,
            text_scale=0.020,
            text_font=self._font,
            text_align=TextNode.ALeft,
            frameColor=(0, 0, 0, 0),
            pos=(0, 0, 0.875),
            relief=DGG.FLAT,
        )

        callbacks = (
            self._toggle_simulation,
            self._toggle_scenarios,
            self._toggle_devices,
            self._toggle_tools,
        )
        self._top_buttons = [
            self._make_button(DirectButton, DGG, item, callback, (-0.15, 0.15, -0.052, 0.052))
            for item, callback in zip(self._MENU_ITEMS, callbacks, strict=True)
        ]
        self._backend_status_button = self._make_button(
            DirectButton, DGG, "● НЕТ СВЯЗИ", self._toggle_backend_details, (-0.18, 0.18, -0.052, 0.052)
        )
        self._dashboard_button = self._make_button(
            DirectButton, DGG, "ВЕБ-ПАНЕЛЬ", self.open_dashboard, (-0.23, 0.23, -0.052, 0.052), primary=True
        )

        self._tools_frame = DirectFrame(
            parent=base.aspect2d,
            frameColor=THEME.panel_elevated,
            frameSize=(-0.36, 0.36, -0.25, 0.25),
            pos=(0, 0, 0),
            relief=DGG.FLAT,
            state=DGG.DISABLED,
        )
        DirectLabel(
            parent=self._tools_frame,
            text="ИНСТРУМЕНТЫ",
            text_fg=THEME.muted,
            text_scale=0.025,
            text_font=self._font,
            text_align=TextNode.ALeft,
            frameColor=(0, 0, 0, 0),
            pos=(-0.30, 0, 0.17),
            relief=DGG.FLAT,
        )
        tool_actions = (
            ("СОСТОЯНИЕ BACKEND", self._toggle_backend_details),
            ("ОТЛАДКА СИМУЛЯЦИИ", self._toggle_developer),
            ("СПРАВКА И УПРАВЛЕНИЕ", self._toggle_help),
        )
        self._tool_buttons = []
        for index, (title, callback) in enumerate(tool_actions):
            self._tool_buttons.append(
                self._make_button(
                    DirectButton,
                    DGG,
                    title,
                    callback,
                    (-0.31, 0.31, -0.047, 0.047),
                    parent=self._tools_frame,
                    text_scale=0.025,
                )
            )
            self._tool_buttons[-1].setPos(0, 0, 0.075 - index * 0.11)
        self._tools_frame.hide()

        self._footer = DirectFrame(
            parent=base.aspect2d,
            frameColor=THEME.panel_elevated,
            frameSize=(-self._aspect, self._aspect, -0.075, 0.075),
            pos=(0, 0, -0.92),
            relief=DGG.FLAT,
            state=DGG.DISABLED,
        )
        self._mode_buttons = {}
        for mode in VISUALIZATION_MODES:
            button = self._make_button(
                DirectButton,
                DGG,
                MODE_LABELS_RU[mode],
                self._select_visualization,
                (-0.14, 0.14, -0.043, 0.043),
                extra_args=[mode],
                text_scale=0.027,
            )
            self._mode_buttons[mode] = button

        self._demo_button = self._make_button(
            DirectButton,
            DGG,
            "АВТОДЕМО",
            self._start_demo,
            (-0.23, 0.23, -0.047, 0.047),
            primary=True,
            text_scale=0.029,
        )
        self._status = OnscreenText(
            parent=base.aspect2d,
            text="",
            pos=(0, -0.918),
            align=TextNode.ALeft,
            fg=THEME.secondary,
            scale=0.029,
            font=self._font,
        )
        self._cursor = OnscreenText(
            parent=base.aspect2d,
            text="·",
            pos=(0, 0),
            align=TextNode.ACenter,
            fg=THEME.accent,
            scale=0.055,
            mayChange=True,
            font=self._font,
        )

        self._backend_frame = DirectFrame(
            parent=base.aspect2d,
            frameColor=THEME.panel,
            frameSize=(-0.82, 0.82, -0.55, 0.55),
            pos=(0, 0, 0),
            relief=DGG.FLAT,
            state=DGG.DISABLED,
        )
        self._backend_text = DirectLabel(
            parent=self._backend_frame,
            text="",
            text_fg=THEME.ink,
            text_scale=0.036,
            text_align=TextNode.ALeft,
            text_font=self._font,
            text_wordwrap=48,
            frameColor=(0, 0, 0, 0),
            pos=(-0.70, 0, 0.43),
            relief=DGG.FLAT,
        )
        self._backend_frame.hide()

        self._help_frame = DirectFrame(
            parent=base.aspect2d,
            frameColor=THEME.panel,
            frameSize=(-0.82, 0.82, -0.63, 0.63),
            pos=(0, 0, 0),
            relief=DGG.FLAT,
            state=DGG.DISABLED,
        )
        self._help_text = DirectLabel(
            parent=self._help_frame,
            text=(
                "СПРАВКА ПО УПРАВЛЕНИЮ\n\n"
                "W A S D — перемещение камеры · Q / E — вниз / вверх · Shift — быстрее\n"
                "Зажмите ПКМ — обзор · колесо — приблизить / отдалить\n"
                "ЛКМ — выбрать узел · F — фокус · R — исходный вид · C — режим стены\n"
                "O / K — открыть / закрыть окно · I / X — вентиляторы · V — фильтр\n"
                "Пробел — пауза · 1…6 — скорость от 1× до 60×\n\n"
                "Сценарии задают условия среды. Автодемонстрация ждёт прогноз, команду и ACK\n"
                "от AirCheck backend; без backend модель помещения продолжает работу.\n\n"
                "Нажмите Esc, чтобы закрыть окно справки."
            ),
            text_fg=THEME.ink,
            text_scale=0.034,
            text_align=TextNode.ALeft,
            text_font=self._font,
            text_wordwrap=51,
            frameColor=(0, 0, 0, 0),
            pos=(-0.72, 0, 0.48),
            relief=DGG.FLAT,
        )
        self._help_frame.hide()
        self._layout(self._aspect)
        self.set_visualization_mode(VisualizationMode.NORMAL, notify=False)

    def _make_button(
        self,
        button_type: Any,
        dgg: Any,
        text: str,
        command: Callable[..., Any],
        frame_size: tuple[float, float, float, float],
        *,
        parent: Any | None = None,
        extra_args: list[Any] | None = None,
        primary: bool = False,
        text_scale: float = 0.030,
    ) -> Any:
        return button_type(
            parent=parent if parent is not None else self._base.aspect2d,
            text=text,
            text_fg=THEME.on_accent if primary else THEME.ink,
            text_scale=text_scale,
            text_font=self._font,
            frameColor=(THEME.accent, THEME.accent, THEME.control_pressed, THEME.control_disabled)
            if primary
            else (THEME.control, THEME.control_hover, THEME.control_pressed, THEME.control_disabled),
            frameSize=frame_size,
            command=command,
            extraArgs=extra_args or [],
            relief=dgg.FLAT,
        )

    @property
    def modal_open(self) -> bool:
        return self._modal is not None

    @property
    def interaction_overlay_open(self) -> bool:
        return self._modal is not None or self._tools_open

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
            active = current is mode
            button["frameColor"] = (
                (THEME.accent, THEME.accent, THEME.control_pressed, THEME.control_disabled)
                if active
                else (THEME.control, THEME.control_hover, THEME.control_pressed, THEME.control_disabled)
            )
            button["text_fg"] = THEME.on_accent if active else THEME.ink
        if notify:
            self._invoke("visualization_mode", mode)

    def open_dashboard(self) -> None:
        if not self._dashboard_url:
            LOGGER.warning("dashboard URL is not configured")
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
        self._hud.update(state, self._forecast, self._backend_online, self._scenario_name, phase)
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
            CutawayMode.VISIBLE: "ВИДИМАЯ",
            CutawayMode.TRANSPARENT: "ПРОЗРАЧНАЯ",
            CutawayMode.HIDDEN: "СКРЫТАЯ",
        }[cutaway_mode]
        self._status.setText(f"СТЕНА  ·  {wall}")
        active_demo = bool(demo_status and demo_status.active)
        self._demo_button["text"] = "ОСТАНОВИТЬ ДЕМО" if active_demo else "АВТОДЕМО"
        if demo_status is not None and demo_status.phase == "DEMO COMPLETE":
            self._demo_button["text"] = "ДЕМО ЗАВЕРШЕНО"
        self._demo_button["command"] = self._stop_demo if active_demo else self._start_demo
        self._simulation_button["text"] = (
            "ПРОДОЛЖИТЬ" if state.simulation_speed == 0 else f"ПАУЗА  ·  {state.simulation_speed:g}×"
        )
        if self._backend_online:
            self._backend_status_button["text"] = "● СВЯЗЬ ЕСТЬ"
            self._backend_status_button["frameColor"] = (THEME.accent_soft, THEME.accent_soft, THEME.control_pressed, THEME.control_disabled)
            self._backend_status_button["text_fg"] = THEME.good
        else:
            self._backend_status_button["text"] = "● НЕТ СВЯЗИ"
            self._backend_status_button["frameColor"] = (THEME.panel_muted, THEME.panel_muted, THEME.control_pressed, THEME.control_disabled)
            self._backend_status_button["text_fg"] = THEME.warning
        self._backend_text["text"] = self._backend_summary()
        if mouse is None:
            self._cursor.hide()
        else:
            self._cursor.show()
            self._cursor.setPos(mouse[0], mouse[1])
        self._cursor["fg"] = THEME.accent if hovered else THEME.muted
        self._cursor.setText("+" if hovered else "·")

    def set_menu_open(self, open_: bool) -> None:
        if open_:
            if not self.interaction_overlay_open:
                self._open_modal("help")
        else:
            self._tools_open = False
            self._tools_frame.hide()
            self._close_modal()

    def pointer_over_ui(self) -> bool:
        watcher = self._base.mouseWatcherNode
        if not watcher.hasMouse():
            return False
        point = watcher.getMouse()
        x, z = point.getX(), point.getY()
        if self.modal_open:
            return abs(x) <= 1.05 and abs(z) <= 0.82
        if z >= 0.82 or z <= -0.84:
            return True
        hud_bounds = (-self._aspect + 0.14, -self._aspect + 1.26, 0.07, 0.79)
        if hud_bounds[0] <= x <= hud_bounds[1] and hud_bounds[2] <= z <= hud_bounds[3]:
            return True
        device_bounds = (self._aspect - 1.08, self._aspect - 0.12, -0.39, 0.47)
        if (
            self._device_panel.visible
            and device_bounds[0] <= x <= device_bounds[1]
            and device_bounds[2] <= z <= device_bounds[3]
        ):
            return True
        return self._tools_open and abs(x - self._tools_x) <= 0.38 and 0.33 <= z <= 0.86

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

    def _toggle_simulation(self) -> None:
        self._invoke("toggle_simulation")

    def _toggle_scenarios(self) -> None:
        self._tools_open = False
        self._tools_frame.hide()
        self._toggle_modal("scenarios")

    def _toggle_developer(self) -> None:
        self._tools_open = False
        self._tools_frame.hide()
        self._toggle_modal("developer")

    def _toggle_help(self) -> None:
        self._tools_open = False
        self._tools_frame.hide()
        self._toggle_modal("help")

    def _toggle_backend_details(self) -> None:
        self._tools_open = False
        self._tools_frame.hide()
        self._toggle_modal("backend")

    def _toggle_devices(self) -> None:
        self.toggle_devices_panel()

    def _toggle_tools(self) -> None:
        if self._modal is not None:
            return
        self._tools_open = not self._tools_open
        self._tools_frame.show() if self._tools_open else self._tools_frame.hide()

    def _start_demo(self) -> None:
        self._tools_open = False
        self._tools_frame.hide()
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
        self._tools_open = False
        self._tools_frame.hide()
        self._close_modal()
        self._modal = modal
        for element in (*self._mode_buttons.values(), self._demo_button, self._footer, self._status):
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
        for element in (*self._mode_buttons.values(), self._demo_button, self._footer, self._status):
            element.show()

    def _backend_summary(self) -> str:
        status = "В СЕТИ" if self._backend_online else "НЕТ СВЯЗИ"
        if self._backend_message:
            status += f"\nПодробности: {self._backend_message}"
        forecast = self._forecast
        prediction = (
            f"{forecast.predicted_co2_15min:.0f} ppm"
            if forecast is not None
            else "пока нет данных"
        )
        model = forecast.model_name if forecast and forecast.model_name else "—"
        return (
            f"СОСТОЯНИЕ BACKEND  /  {status}\n\n"
            f"Устройство: {self._state.controller.device_id if self._state else '—'}\n"
            f"Последняя телеметрия: {self._last_telemetry_at or 'ещё не отправлялась'}\n"
            f"Команд выполняется: {self._pending_commands}\n"
            f"Прогноз CO₂ через 15 минут: {prediction}\n"
            f"Модель прогноза: {model}\n\n"
            "Статус и прогноз получены от существующего AirCheck API."
        )

    def on_resize(self, aspect: float) -> None:
        self._aspect = aspect
        self._layout(aspect)
        self._hud.on_resize(aspect)
        self._device_panel.on_resize(aspect)

    def _layout(self, aspect: float) -> None:
        layout = overlay_layout(aspect)
        self._header["frameSize"] = (-aspect, aspect, -0.08, 0.08)
        self._footer["frameSize"] = (-aspect, aspect, -0.075, 0.075)
        self._brand.setPos(-aspect + 0.14, 0, 0.935)
        self._brand_subtitle.setPos(-aspect + 0.14, 0, 0.875)

        for button, x in zip(self._top_buttons, layout.navigation_centers, strict=True):
            button.setPos(x, 0, 0.91)
            button["frameSize"] = (
                -layout.navigation_half_width,
                layout.navigation_half_width,
                -0.052,
                0.052,
            )
        self._simulation_button = self._top_buttons[0]
        self._backend_status_button.setPos(layout.backend_center, 0, 0.91)
        self._backend_status_button["frameSize"] = (
            -layout.backend_half_width,
            layout.backend_half_width,
            -0.052,
            0.052,
        )
        self._dashboard_button.setPos(layout.dashboard_center, 0, 0.91)
        self._dashboard_button["frameSize"] = (
            -layout.dashboard_half_width,
            layout.dashboard_half_width,
            -0.052,
            0.052,
        )
        self._tools_x = layout.navigation_centers[-1]
        self._tools_frame.setPos(self._tools_x, 0, 0.57)

        for button, x in zip(self._mode_buttons.values(), layout.mode_centers, strict=True):
            button.setPos(x, 0, -0.92)
            button["frameSize"] = (
                -layout.mode_half_width,
                layout.mode_half_width,
                -0.043,
                0.043,
            )
        self._demo_button.setPos(layout.demo_center, 0, -0.92)
        self._demo_button["frameSize"] = (
            -layout.demo_half_width,
            layout.demo_half_width,
            -0.047,
            0.047,
        )
        self._status.setPos(-aspect + 0.16, -0.918)

    def close(self) -> None:
        self._close_modal()
        self._hud.close()
        self._device_panel.close()
        self._scenario_panel.close()
        self._developer_panel.close()
        for element in (
            self._header,
            self._brand,
            self._brand_subtitle,
            *self._top_buttons,
            self._backend_status_button,
            self._dashboard_button,
            self._tools_frame,
            *self._mode_buttons.values(),
            self._demo_button,
            self._footer,
            self._status,
            self._cursor,
            self._backend_frame,
            self._help_frame,
        ):
            element.destroy()
