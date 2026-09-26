from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from aircheck_simulator_3d.app.config import DeviceConfig, PhysicsConfig, SceneConfig
from aircheck_simulator_3d.scene.device_models.geometry import make_cylinder
from aircheck_simulator_3d.simulation.state import AirflowState


@dataclass
class _Track:
    name: str
    start: tuple[float, float, float]
    end: tuple[float, float, float]
    maximum_flow_m3_h: float
    particles: tuple[Any, ...]
    phase: float = 0.0


class AirflowVisualization:
    """Lightweight particles whose visibility and speed follow modeled room flows."""

    def __init__(
        self,
        parent: Any,
        scene: SceneConfig,
        devices: DeviceConfig,
        physics: PhysicsConfig,
        particles_per_track: int = 12,
    ) -> None:
        from panda3d.core import PandaNode, TransparencyAttrib

        self._root = parent.attachNewNode(PandaNode("aircheck-airflow-overlay"))
        self._root.hide()
        if particles_per_track < 1:
            raise ValueError("particles_per_track must be positive")
        self._particles_per_track = particles_per_track
        self._transparency = TransparencyAttrib.MAlpha
        width = scene.room_width_m
        depth = scene.room_depth_m
        height = scene.room_height_m
        back_y = depth / 2
        fan_z = height * 0.73
        outside_y = back_y + scene.outdoor_depth_m / 5
        inside_y = back_y - depth / 6
        window_x_offset = scene.window_width_m / 3
        window_center_z = scene.window_sill_height_m + scene.window_height_m / 2
        window_vertical_offset = scene.window_height_m / 6
        self._tracks = (
            self._make_track(
                "window-in",
                (-window_x_offset, outside_y, window_center_z - window_vertical_offset),
                (-window_x_offset, inside_y, window_center_z - window_vertical_offset),
                physics.window_max_airflow_m3_h,
                (0.21, 0.94, 0.79, 1),
            ),
            self._make_track(
                "window-out",
                (window_x_offset, inside_y, window_center_z + window_vertical_offset),
                (window_x_offset, outside_y, window_center_z + window_vertical_offset),
                physics.window_max_airflow_m3_h,
                (0.48, 0.76, 1.0, 1),
            ),
            self._make_track(
                "intake",
                (-width * 0.37, outside_y, fan_z),
                (-width * 0.37, inside_y, fan_z),
                devices.intake_airflow_m3_h,
                (0.25, 0.94, 0.66, 1),
            ),
            self._make_track(
                "exhaust",
                (width * 0.37, inside_y, fan_z),
                (width * 0.37, outside_y, fan_z),
                devices.exhaust_airflow_m3_h,
                (1.0, 0.65, 0.28, 1),
            ),
        )
        self._flow: AirflowState | None = None
        self._visible = False

    def _make_track(
        self,
        name: str,
        start: tuple[float, float, float],
        end: tuple[float, float, float],
        maximum_flow_m3_h: float,
        color: tuple[float, float, float, float],
    ) -> _Track:
        particles = []
        for index in range(self._particles_per_track):
            particle = make_cylinder(
                self._root,
                f"airflow-{name}-{index + 1}",
                start,
                0.032,
                0.035,
                color,
                axis="y",
                segments=8,
            )
            particle.setTwoSided(True)
            particle.setLightOff(1)
            particle.setDepthTest(False)
            particle.setDepthWrite(False)
            particle.setTransparency(self._transparency)
            particles.append(particle)
        for particle in particles:
            particle.hide()
        return _Track(name, start, end, maximum_flow_m3_h, tuple(particles))

    def set_visible(self, visible: bool) -> None:
        self._visible = visible
        self._root.show() if visible else self._root.hide()

    def apply(self, airflow: AirflowState, delta_seconds: float) -> None:
        self._flow = airflow
        if not self._visible:
            return
        values = {
            "window-in": airflow.window_m3_h,
            "window-out": airflow.window_m3_h,
            "intake": airflow.intake_m3_h,
            "exhaust": airflow.exhaust_m3_h,
        }
        for track in self._tracks:
            flow = values[track.name]
            ratio = flow_ratio(flow, track.maximum_flow_m3_h)
            active_count = active_particle_count(flow, track.maximum_flow_m3_h, self._particles_per_track)
            track.phase = (track.phase + max(0.0, delta_seconds) * (0.15 + 3.0 * ratio)) % 1.0
            for index, particle in enumerate(track.particles):
                if index >= active_count:
                    particle.hide()
                    continue
                t = (track.phase + index / self._particles_per_track) % 1.0
                position = tuple(
                    start + (end - start) * t
                    for start, end in zip(track.start, track.end, strict=True)
                )
                particle.setPos(*position)
                particle.setColorScale(0.55 + ratio * 0.45, 0.55 + ratio * 0.45, 0.55 + ratio * 0.45, 0.48 + ratio * 0.52)
                particle.show()

    def close(self) -> None:
        self._root.removeNode()


def airflow_magnitudes(airflow: AirflowState) -> dict[str, float]:
    return {
        "window": airflow.window_m3_h,
        "intake": airflow.intake_m3_h,
        "exhaust": airflow.exhaust_m3_h,
        "total": airflow.total_effective_m3_h,
    }


def flow_ratio(flow_m3_h: float, nominal_flow_m3_h: float) -> float:
    if flow_m3_h <= 0 or nominal_flow_m3_h <= 0:
        return 0.0
    return min(1.0, flow_m3_h / nominal_flow_m3_h)


def active_particle_count(flow_m3_h: float, nominal_flow_m3_h: float, maximum_particles: int) -> int:
    if flow_m3_h <= 0 or nominal_flow_m3_h <= 0 or maximum_particles < 1:
        return 0
    return max(1, min(maximum_particles, round(flow_ratio(flow_m3_h, nominal_flow_m3_h) * maximum_particles)))
