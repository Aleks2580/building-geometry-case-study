"""Pure massing rules and default orchestration independent of transport and persistence."""

from app.massing.defaults import (
    DefaultMassingReason,
    DefaultMassingResult,
    DefaultMassingStatus,
    NumericalRangeError,
    generate_default_massing,
)
from app.massing.floors import (
    FloorLimits,
    InvalidFloorLimits,
    calculate_maximum_permitted_floor_count,
)

__all__ = [
    "FloorLimits",
    "InvalidFloorLimits",
    "DefaultMassingReason",
    "DefaultMassingResult",
    "DefaultMassingStatus",
    "NumericalRangeError",
    "calculate_maximum_permitted_floor_count",
    "generate_default_massing",
]
