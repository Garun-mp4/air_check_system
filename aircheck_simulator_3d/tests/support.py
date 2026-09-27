from __future__ import annotations

from dataclasses import dataclass

from aircheck_simulator_3d.app.config import AppConfig, load_config
from aircheck_simulator_3d.devices.device_layer import DeviceLayer
from aircheck_simulator_3d.simulation.engine import SimulationEngine
from aircheck_simulator_3d.simulation.factory import create_initial_state
from aircheck_simulator_3d.simulation.state import SimulationState


@dataclass
class SimulationHarness:
    """Test composition for the headless simulation and device layers."""

    config: AppConfig
    state: SimulationState
    device_layer: DeviceLayer
    simulation_engine: SimulationEngine


def new_simulation(config: AppConfig | None = None) -> SimulationHarness:
    resolved_config = config or load_config()
    state = create_initial_state(resolved_config)
    devices = DeviceLayer(state, resolved_config.devices)
    engine = SimulationEngine(state, devices, resolved_config.physics, resolved_config.scene)
    return SimulationHarness(resolved_config, state, devices, engine)
