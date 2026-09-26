"""Shared visual tokens for the AirCheck simulator interface."""

from __future__ import annotations


class UiTheme:
    """Colors for a calm technical interface inspired by the physical stand."""

    canvas = (0.93, 0.96, 0.94, 0.97)
    panel = (0.96, 0.98, 0.97, 0.97)
    panel_elevated = (0.99, 0.995, 0.985, 0.99)
    panel_muted = (0.88, 0.93, 0.91, 0.98)
    border = (0.72, 0.80, 0.77, 1.0)

    ink = (0.08, 0.16, 0.18, 1.0)
    secondary = (0.23, 0.36, 0.37, 1.0)
    muted = (0.39, 0.50, 0.50, 1.0)
    on_accent = (0.98, 1.0, 0.99, 1.0)

    accent = (0.04, 0.43, 0.37, 1.0)
    accent_soft = (0.79, 0.92, 0.87, 1.0)
    control = (0.88, 0.93, 0.91, 1.0)
    control_hover = (0.79, 0.89, 0.85, 1.0)
    control_pressed = (0.12, 0.48, 0.41, 1.0)
    control_disabled = (0.85, 0.88, 0.87, 0.75)

    good = (0.12, 0.48, 0.31, 1.0)
    warning = (0.68, 0.39, 0.08, 1.0)
    error = (0.68, 0.18, 0.17, 1.0)

    # One 8 px rhythm keeps panel padding and control gaps consistent.
    spacing_unit_px = 8


THEME = UiTheme()
