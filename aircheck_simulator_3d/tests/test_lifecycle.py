import pytest

from aircheck_simulator_3d.app.lifecycle import Lifecycle


def test_lifecycle_closes_resources_once_in_reverse_order() -> None:
    events: list[str] = []
    lifecycle = Lifecycle()
    lifecycle.add_cleanup(lambda: events.append("first"))
    lifecycle.add_cleanup(lambda: events.append("second"))

    lifecycle.close()
    lifecycle.close()

    assert events == ["second", "first"]
    assert lifecycle.closed


def test_lifecycle_closes_resources_even_when_body_raises() -> None:
    events: list[str] = []

    with pytest.raises(RuntimeError, match="boom"):
        with Lifecycle() as lifecycle:
            lifecycle.add_cleanup(lambda: events.append("closed"))
            raise RuntimeError("boom")

    assert events == ["closed"]


def test_lifecycle_attempts_remaining_cleanup_after_failure() -> None:
    events: list[str] = []
    lifecycle = Lifecycle()
    lifecycle.add_cleanup(lambda: events.append("first"))

    def fail() -> None:
        raise RuntimeError("close failure")

    lifecycle.add_cleanup(fail)
    with pytest.raises(ExceptionGroup):
        lifecycle.close()
    assert events == ["first"]
