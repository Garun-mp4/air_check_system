from __future__ import annotations

from collections import defaultdict, deque

from aircheck_simulator_3d.devices.device_layer import DeviceLayer
from aircheck_simulator_3d.devices.models import WindowMotorState
from aircheck_simulator_3d.networking.contracts import CommandTarget, PendingControlCommand


class DeviceCommandExecutor:
    """Applies backend commands on the simulation thread and completes them from actual state."""

    _TARGETS = (CommandTarget.EXHAUST, CommandTarget.INTAKE, CommandTarget.WINDOW)

    def __init__(self, devices: DeviceLayer) -> None:
        self._devices = devices
        self._queued: dict[CommandTarget, deque[PendingControlCommand]] = defaultdict(deque)
        self._active: dict[CommandTarget, PendingControlCommand] = {}
        self._seen_command_ids: set[int] = set()
        self._completed_unacknowledged: set[int] = set()
        self._duplicate_acknowledgements: deque[int] = deque()

    @property
    def active_commands(self) -> tuple[PendingControlCommand, ...]:
        return tuple(self._active[target] for target in self._TARGETS if target in self._active)

    @property
    def pending_count(self) -> int:
        return len(self._active) + sum(len(commands) for commands in self._queued.values())

    def enqueue(self, command: PendingControlCommand) -> None:
        if command.command_id in self._seen_command_ids:
            if command.command_id in self._completed_unacknowledged:
                self._duplicate_acknowledgements.append(command.command_id)
            return
        self._seen_command_ids.add(command.command_id)
        self._queued[command.target].append(command)

    def update(self) -> tuple[int, ...]:
        completed = list(self._duplicate_acknowledgements)
        self._duplicate_acknowledgements.clear()
        for target in self._TARGETS:
            command = self._active.get(target)
            if command is None:
                commands = self._queued[target]
                if not commands:
                    continue
                command = commands.popleft()
                self._active[target] = command
                self._apply(command)

            self._maintain_target(command)
            if self._is_complete(command):
                completed.append(command.command_id)
                self._completed_unacknowledged.add(command.command_id)
                del self._active[target]
        return tuple(completed)

    def acknowledgement_accepted(self, command_ids: tuple[int, ...]) -> None:
        for command_id in command_ids:
            self._completed_unacknowledged.discard(command_id)
            self._seen_command_ids.discard(command_id)

    def _apply(self, command: PendingControlCommand) -> None:
        if command.target is CommandTarget.EXHAUST:
            self._devices.set_exhaust_enabled(command.desired_state)
        elif command.target is CommandTarget.INTAKE:
            self._devices.set_intake_enabled(command.desired_state)
        elif command.target is CommandTarget.WINDOW:
            if command.desired_state:
                self._devices.request_window_open()
            else:
                self._devices.request_window_close()

    def _maintain_target(self, command: PendingControlCommand) -> None:
        state = self._devices.simulation_state
        if command.target is CommandTarget.EXHAUST:
            if state.ventilation.exhaust.enabled != command.desired_state:
                self._devices.set_exhaust_enabled(command.desired_state)
        elif command.target is CommandTarget.INTAKE:
            if state.ventilation.intake.enabled != command.desired_state:
                self._devices.set_intake_enabled(command.desired_state)
        else:
            target_position = 100.0 if command.desired_state else 0.0
            if state.window.target_position_percent != target_position:
                if command.desired_state:
                    self._devices.request_window_open()
                else:
                    self._devices.request_window_close()

    def _is_complete(self, command: PendingControlCommand) -> bool:
        state = self._devices.simulation_state
        if command.target is CommandTarget.EXHAUST:
            return state.ventilation.exhaust.enabled is command.desired_state
        if command.target is CommandTarget.INTAKE:
            return state.ventilation.intake.enabled is command.desired_state
        expected_limit = (
            state.window.open_limit_switch if command.desired_state else state.window.close_limit_switch
        )
        return expected_limit and state.window.motor_state is WindowMotorState.STOPPED
