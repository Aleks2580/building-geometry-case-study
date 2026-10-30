"""Pure massing rules and orchestration independent of transport and persistence."""

from app.massing.area_preferences import (
    FootprintAreaPreferenceDiagnosticCode,
    FootprintAreaPreferenceResult,
    FootprintAreaPreferenceStatus,
    generate_preferred_footprint,
)
from app.massing.configurable import (
    PreferenceMassingReason,
    PreferenceMassingResult,
    PreferenceMassingStatus,
    generate_massing_with_preferences,
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
from app.massing.target_floors import select_floor_count_for_target
from app.massing.targets import (
    DesignTargets,
    GfaTargetAssessment,
    GfaTargetDiagnosticCode,
    GfaTargetStatus,
    InvalidDesignTargets,
    assess_gfa_target,
    gfa_tolerance_m2,
    is_gfa_target_met,
)

__all__ = [
    "FootprintAreaPreferenceDiagnosticCode",
    "FootprintAreaPreferenceResult",
    "FootprintAreaPreferenceStatus",
    "PreferenceMassingReason",
    "PreferenceMassingResult",
    "PreferenceMassingStatus",
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
    "generate_massing_with_preferences",
    "generate_preferred_footprint",
    "select_floor_count",
    "DesignTargets",
    "GfaTargetAssessment",
    "GfaTargetDiagnosticCode",
    "GfaTargetStatus",
    "InvalidDesignTargets",
    "assess_gfa_target",
    "gfa_tolerance_m2",
    "is_gfa_target_met",
    "select_floor_count_for_target",
]
