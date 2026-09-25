from aircheck_simulator_3d.ui.scene_overlay import SceneOverlay


def test_dashboard_action_opens_only_the_configured_url() -> None:
    opened: list[str] = []

    def open_url(url: str) -> bool:
        opened.append(url)
        return True

    overlay = object.__new__(SceneOverlay)
    overlay._dashboard_url = "https://aircheck.example/dashboard"
    overlay._browser_open = open_url

    overlay.open_dashboard()

    assert opened == ["https://aircheck.example/dashboard"]


def test_dashboard_action_is_a_noop_without_a_configured_url() -> None:
    opened: list[str] = []

    def open_url(url: str) -> bool:
        opened.append(url)
        return True

    overlay = object.__new__(SceneOverlay)
    overlay._dashboard_url = ""
    overlay._browser_open = open_url

    overlay.open_dashboard()

    assert opened == []
