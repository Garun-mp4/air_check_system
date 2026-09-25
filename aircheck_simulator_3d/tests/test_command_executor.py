from pathlib import Path
import math

from aircheck_simulator_3d.app.application import Application
from aircheck_simulator_3d.app.config import load_config
from aircheck_simulator_3d.devices.command_executor import DeviceCommandExecutor
from aircheck_simulator_3d.networking.contracts import CommandTarget, PendingControlCommand
from aircheck_simulator_3d.devices.models import WindowMotorState


CONFIG_DIR = Path(__file__).parents[1] / "config"


def _command(command_id: int, target: CommandTarget, desired_state: bool) -> PendingControlCommand:
    return PendingControlCommand(command_id, target, desired_state)


def test_window_command_is_acknowledgeable_only_after_actual_travel_finishes() -> None:
    app = Application(load_config(CONFIG_DIR, {}))
    app.simulation_engine.set_speed(1.0)
    executor = DeviceCommandExecutor(app.device_layer)
    command = _command(41, CommandTarget.WINDOW, True)

    executor.enqueue(command)
    assert executor.update() == ()
    assert app.state.window.motor_state is WindowMotorState.OPENING
    assert not app.state.window.open_limit_switch

    completed: tuple[int, ...] = ()
    travel_steps = math.ceil(app.config.devices.window_travel_seconds / app.state.fixed_step_seconds) + 2
    for _ in range(travel_steps):
        app.simulation_engine.advance(app.state.fixed_step_seconds)
        completed = executor.update()
        if completed:
            break

    assert completed == (41,)
    assert app.state.window.actual_position_percent == 100
    assert app.state.window.open_limit_switch
    assert app.state.window.reed_switch
    assert app.state.window.motor_state is WindowMotorState.STOPPED


def test_commands_for_one_actuator_run_in_order_and_wait_for_each_endpoint() -> None:
    app = Application(load_config(CONFIG_DIR, {}))
    app.simulation_engine.set_speed(1.0)
    executor = DeviceCommandExecutor(app.device_layer)
    executor.enqueue(_command(51, CommandTarget.WINDOW, True))
    executor.enqueue(_command(52, CommandTarget.WINDOW, False))

    assert executor.update() == ()
    assert app.state.window.motor_state is WindowMotorState.OPENING
    first_completed: tuple[int, ...] = ()
    travel_steps = math.ceil(app.config.devices.window_travel_seconds / app.state.fixed_step_seconds) + 2
    for _ in range(travel_steps):
        app.simulation_engine.advance(app.state.fixed_step_seconds)
        first_completed = executor.update()
        if first_completed:
            break
    assert first_completed == (51,)
    assert app.state.window.open_limit_switch

    assert executor.update() == ()
    assert app.state.window.motor_state is WindowMotorState.CLOSING
    second_completed: tuple[int, ...] = ()
    for _ in range(travel_steps):
        app.simulation_engine.advance(app.state.fixed_step_seconds)
        second_completed = executor.update()
        if second_completed:
            break
    assert second_completed == (52,)
    assert app.state.window.close_limit_switch
    assert app.state.window.motor_state is WindowMotorState.STOPPED


def test_fan_command_completes_from_device_layer_state_and_can_be_retried() -> None:
    app = Application(load_config(CONFIG_DIR, {}))
    executor = DeviceCommandExecutor(app.device_layer)
    command = _command(61, CommandTarget.INTAKE, True)

    executor.enqueue(command)
    assert executor.update() == (61,)
    assert app.state.ventilation.intake.enabled

    executor.enqueue(command)
    assert executor.update() == (61,)

    executor.acknowledgement_accepted((61,))
    executor.enqueue(command)
    assert executor.update() == (61,)
