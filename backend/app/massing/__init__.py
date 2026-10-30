"""Pure massing rules and default orchestration independent of transport and persistence."""

from app.massing.area_preferences import (
    FootprintAreaPreferenceDiagnosticCode,
    FootprintAreaPreferenceResult,
    FootprintAreaPreferenceStatus,
    generate_preferred_footprint,
)
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
from app.massing.preferences import (
    DesignPreferences,
    InvalidDesignPreferences,
    PreferenceExceedsHardLimit,
    select_floor_count,
)

__all__ = [
    "FootprintAreaPreferenceDiagnosticCode",
    "FootprintAreaPreferenceResult",
    "FootprintAreaPreferenceStatus",
    "FloorLimits",
    "InvalidFloorLimits",
    "DefaultMassingReason",
    "DefaultMassingResult",
    "DefaultMassingStatus",
    "NumericalRangeError",
    "calculate_maximum_permitted_floor_count",
    "DesignPreferences",
    "InvalidDesignPreferences",
    "PreferenceExceedsHardLimit",
    "generate_default_massing",
    "generate_preferred_footprint",
    "select_floor_count",
]
