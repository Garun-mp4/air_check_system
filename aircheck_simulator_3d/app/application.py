from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Protocol

from aircheck_simulator_3d.app.config import AppConfig, CameraConfig, GraphicsConfig, SceneConfig
from aircheck_simulator_3d.app.lifecycle import Lifecycle
from aircheck_simulator_3d.app.runtime import ApplicationRuntime
from aircheck_simulator_3d.devices.device_layer import DeviceLayer
from aircheck_simulator_3d.networking.workers import NetworkIntegration
from aircheck_simulator_3d.scene.window import PandaWindow
from aircheck_simulator_3d.simulation.factory import create_initial_state
from aircheck_simulator_3d.simulation.state import SimulationState
from aircheck_simulator_3d.simulation.engine import SimulationEngine

LOGGER = logging.getLogger("aircheck.application")


class WindowView(Protocol):
    def run(self, smoke_test_seconds: float | None = None) -> None: ...

    def close(self) -> None: ...


class Application:
    def __init__(
        self,
        config: AppConfig,
        window_factory: Callable[[GraphicsConfig], WindowView] | None = None,
    ) -> None:
        self.config = config
        self._window_factory = window_factory
        self.state = create_initial_state(config)
        self.device_layer = DeviceLayer(self.state, self.config.devices)
        self.simulation_engine = SimulationEngine(
            self.state,
            self.device_layer,
            self.config.physics,
            self.config.scene,
        )

    def run(self, smoke_test_seconds: float | None = None) -> None:
        LOGGER.info("Opening Panda3D window for device %s", self.config.devices.device_id)
        lifecycle = Lifecycle()
        try:
            if self._window_factory is None:
                network = NetworkIntegration(self.config.backend, self.config.devices.device_id)
                lifecycle.add_cleanup(network.close)
                network.start()
                view = PandaWindow(
                    self.config,
                    self.device_layer,
                    self.simulation_engine,
                    network,
                )
            else:
                view = self._window_factory(self.config.graphics)
            lifecycle.add_cleanup(view.close)
            view.run(smoke_test_seconds=smoke_test_seconds)
        finally:
            lifecycle.close()
            LOGGER.info("AirCheck 3D Simulator stopped")
