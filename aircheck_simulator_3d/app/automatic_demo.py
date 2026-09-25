from __future__ import annotations

from dataclasses import dataclass

from aircheck_simulator_3d.app.config import DemoConfig
from aircheck_simulator_3d.networking.contracts import BackendForecast
from aircheck_simulator_3d.simulation.state import SimulationState


@dataclass(frozen=True)
class AutomaticDemoStatus:
    active: bool
    phase: str
    detail: str


class AutomaticDemoController:
    """Presentation of a backend-driven sequence; it never creates actuator commands."""

    IDLE = "READY"
    BUILDUP = "CO2 BUILD-UP"
    FORECAST = "BACKEND ML FORECAST"
    COMMAND = "BACKEND COMMAND"
    EXECUTING = "ACTUATOR EXECUTION"
    WAITING_ACK = "WAITING FOR ACK"
    ACKNOWLEDGED = "ACKNOWLEDGED · OBSERVING AIR"
    COMPLETE = "DEMO COMPLETE"

    def __init__(self, config: DemoConfig) -> None:
        self._config = config
        self._active = False
        self._phase = self.IDLE
        self._forecast: BackendForecast | None = None
        self._command_ids: set[int] = set()
        self._applied_ids: set[int] = set()
        self._acknowledged_ids: set[int] = set()
        self._peak_co2 = 0.0
        self._baseline_co2 = 0.0
        self._build_up_started_at = 0.0

    @property
    def status(self) -> AutomaticDemoStatus:
        if not self._active:
            detail = (
                "CO2 снизился после исполнения команды backend"
                if self._phase == self.COMPLETE
                else "Запустите автоматическую демонстрацию"
            )
            return AutomaticDemoStatus(False, self._phase, detail)
        details = {
            self.BUILDUP: "Рост CO2 в модели комнаты; ожидается прогноз после новой телеметрии",
            self.FORECAST: self._forecast_detail(),
            self.COMMAND: "Получена команда из очереди AirCheck; Simulator выполняет её через Device Layer",
            self.EXECUTING: "Ожидание фактического положения окна или состояния вентилятора и ACK",
            self.WAITING_ACK: "Привод достиг целевого состояния; ожидается подтверждение AirCheck backend",
            self.ACKNOWLEDGED: "Backend подтвердил фактическое состояние; наблюдаем изменение CO2",
            self.COMPLETE: "CO2 снизился после исполнения команды backend",
        }
        return AutomaticDemoStatus(self._active, self._phase, details.get(self._phase, ""))

    def start(self, state: SimulationState) -> None:
        self._active = True
        self._phase = self.BUILDUP
        self._forecast = None
        self._command_ids.clear()
        self._applied_ids.clear()
        self._acknowledged_ids.clear()
        self._baseline_co2 = state.indoor.co2_ppm
        self._peak_co2 = state.indoor.co2_ppm
        self._build_up_started_at = state.elapsed_seconds

    def stop(self) -> None:
        self._active = False
        self._phase = self.IDLE

    def forecast_received(self, forecast: BackendForecast | None) -> None:
        if self._active and forecast is not None and self._phase in {
            self.BUILDUP, "WAITING FOR BACKEND FORECAST"
        }:
            self._forecast = forecast
            if self._phase != self.BUILDUP:
                self._phase = self.FORECAST

    def command_received(self, command_id: int) -> None:
        if self._active:
            self._command_ids.add(command_id)
            self._phase = self.COMMAND

    def command_started(self, command_id: int) -> None:
        if self._active and command_id in self._command_ids and command_id not in self._applied_ids:
            self._phase = self.EXECUTING

    def command_applied(self, command_ids: tuple[int, ...]) -> None:
        if not self._active:
            return
        self._applied_ids.update(set(command_ids) & self._command_ids)
        if self._applied_ids:
            self._phase = self.WAITING_ACK

    def acknowledgement_accepted(self, command_ids: tuple[int, ...]) -> None:
        if not self._active:
            return
        self._acknowledged_ids.update(set(command_ids) & self._applied_ids)
        if self._acknowledged_ids:
            self._phase = self.ACKNOWLEDGED
            self._peak_co2 = max(self._peak_co2, self._baseline_co2)

    def update(self, state: SimulationState, backend_online: bool) -> AutomaticDemoStatus:
        if not self._active:
            return self.status
        if not backend_online and self._phase in {self.BUILDUP, self.FORECAST}:
            return AutomaticDemoStatus(True, self._phase, "Backend offline: физическая модель продолжает работу, ждём reconnect")
        if (
            self._phase == self.BUILDUP
            and state.elapsed_seconds - self._build_up_started_at >= self._config.automatic_build_up_seconds
        ):
            self._phase = self.FORECAST if self._forecast is not None else "WAITING FOR BACKEND FORECAST"
        self._peak_co2 = max(self._peak_co2, state.indoor.co2_ppm)
        if self._phase == self.ACKNOWLEDGED:
            threshold = self._config.automatic_co2_drop_ppm
            if state.indoor.co2_ppm <= self._peak_co2 - threshold:
                self._phase = self.COMPLETE
                self._active = False
        return self.status

    def _forecast_detail(self) -> str:
        forecast = self._forecast
        if forecast is None:
            return "Ожидается модельный прогноз от AirCheck backend"
        model = f" · {forecast.model_name}" if forecast.model_name else ""
        return f"Прогноз backend через 15 мин: {forecast.predicted_co2_15min:.0f} ppm{model}; ждём команду"
