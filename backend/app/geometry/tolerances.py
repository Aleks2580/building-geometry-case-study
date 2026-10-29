"""Comparison tolerances for geometry measured in square metres."""


def area_tolerance_m2(site_area_m2: float) -> float:
    """Return the comparison tolerance for a validated positive site area."""
    return max(1e-8, 1e-9 * max(site_area_m2, 1.0))
