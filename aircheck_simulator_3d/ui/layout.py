from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class OverlayLayout:
    navigation_centers: tuple[float, ...]
    navigation_half_width: float
    backend_center: float
    backend_half_width: float
    dashboard_center: float
    dashboard_half_width: float
    mode_centers: tuple[float, ...]
    mode_half_width: float
    demo_center: float
    demo_half_width: float


def overlay_layout(aspect: float) -> OverlayLayout:
    """Return aspect2d anchors for the top and bottom application bars."""
    if aspect <= 0:
        raise ValueError("aspect ratio must be positive")

    if aspect < 1.53:
        navigation_centers = (-0.56, -0.29, -0.02, 0.25)
        navigation_half_width = 0.11
        backend_center = aspect - 0.66
        backend_half_width = 0.13
        dashboard_center = aspect - 0.23
        dashboard_half_width = 0.18
    else:
        navigation_centers = (-0.64, -0.31, 0.02, 0.35)
        navigation_half_width = 0.15
        backend_center = aspect - 0.79
        backend_half_width = 0.18
        dashboard_center = aspect - 0.30
        dashboard_half_width = 0.23

    if aspect < 1.35:
        mode_centers = (-0.50, -0.25, 0.0, 0.25, 0.50)
        mode_half_width = 0.115
        demo_center = aspect - 0.24
        demo_half_width = 0.17
    else:
        mode_centers = (-0.62, -0.31, 0.0, 0.31, 0.62)
        mode_half_width = 0.14
        demo_center = aspect - 0.31
        demo_half_width = 0.23

    return OverlayLayout(
        navigation_centers=navigation_centers,
        navigation_half_width=navigation_half_width,
        backend_center=backend_center,
        backend_half_width=backend_half_width,
        dashboard_center=dashboard_center,
        dashboard_half_width=dashboard_half_width,
        mode_centers=mode_centers,
        mode_half_width=mode_half_width,
        demo_center=demo_center,
        demo_half_width=demo_half_width,
    )
