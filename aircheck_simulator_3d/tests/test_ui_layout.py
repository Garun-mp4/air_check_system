from __future__ import annotations

import pytest

from aircheck_simulator_3d.ui.layout import overlay_layout


@pytest.mark.parametrize("aspect", [1.20, 1.333, 1.35, 1.52, 1.53, 1.60, 16 / 9, 2.10])
def test_overlay_controls_fit_without_collisions_at_supported_aspects(aspect: float) -> None:
    layout = overlay_layout(aspect)
    top_controls = [
        (center - layout.navigation_half_width, center + layout.navigation_half_width)
        for center in layout.navigation_centers
    ]
    top_controls.extend(
        (
            (layout.backend_center - layout.backend_half_width, layout.backend_center + layout.backend_half_width),
            (layout.dashboard_center - layout.dashboard_half_width, layout.dashboard_center + layout.dashboard_half_width),
        )
    )
    for left, right in top_controls:
        assert -aspect <= left < right <= aspect
    for previous, current in zip(top_controls, top_controls[1:]):
        assert previous[1] <= current[0]

    modes = [
        (center - layout.mode_half_width, center + layout.mode_half_width)
        for center in layout.mode_centers
    ]
    demo = (layout.demo_center - layout.demo_half_width, layout.demo_center + layout.demo_half_width)
    assert all(-aspect <= left < right <= aspect for left, right in modes)
    assert demo[1] <= aspect
    assert modes[-1][1] <= demo[0]

    hud_right = -aspect + 1.26
    device_left = aspect - 1.08
    assert hud_right <= device_left


def test_overlay_layout_rejects_invalid_aspect_ratio() -> None:
    with pytest.raises(ValueError, match="aspect ratio must be positive"):
        overlay_layout(0)
