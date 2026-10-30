import math

import pytest

from app.massing import (
    DesignTargets,
    GfaTargetAssessment,
    InvalidDesignTargets,
    assess_gfa_target,
    gfa_tolerance_m2,
)


def _assess(
    target: float | None,
    *,
    actual: float | None = 100.0,
    upper: float | None = 500.0,
    generated: float | None = 400.0,
    site_area: float | None = 1_000.0,
    floors: int | None = 6,
) -> GfaTargetAssessment:
    return assess_gfa_target(
        DesignTargets(target),
        actual_gfa_m2=actual,
        gfa_upper_bound_m2=upper,
        generated_gfa_capacity_m2=generated,
        site_area_m2=site_area,
        maximum_permitted_floor_count=floors,
    )


def test_design_targets_allow_absent_zero_positive_and_tiny_values() -> None:
    assert DesignTargets().gfa_target_m2 is None
    assert DesignTargets(0).gfa_target_m2 == 0.0
    assert DesignTargets(125).gfa_target_m2 == 125.0
    assert DesignTargets(125.5).gfa_target_m2 == 125.5
    assert DesignTargets(math.nextafter(0.0, math.inf)).gfa_target_m2 > 0


@pytest.mark.parametrize(
    "value",
    [-1, True, False, "125", math.nan, math.inf, -math.inf, 10**400],
)
def test_invalid_design_targets_are_rejected(value: object) -> None:
    with pytest.raises(InvalidDesignTargets):
        DesignTargets(value)  # type: ignore[arg-type]


def test_design_targets_are_frozen_and_slotted() -> None:
    target = DesignTargets(125)

    with pytest.raises(AttributeError):
        target.gfa_target_m2 = 150  # type: ignore[misc]
    assert not hasattr(target, "__dict__")


def test_absent_target_is_not_requested_with_a_positive_building() -> None:
    result = _assess(None)

    assert result == GfaTargetAssessment(None, "not_requested", None, None)


def test_absent_target_is_not_requested_without_a_building() -> None:
    result = _assess(None, actual=None, upper=None, generated=None, site_area=None, floors=None)

    assert result == GfaTargetAssessment(None, "not_requested", None, None)


def test_supplied_target_without_a_building_is_not_evaluated() -> None:
    result = _assess(125, actual=None, upper=None, generated=None, site_area=None, floors=None)

    assert result == GfaTargetAssessment(125.0, "not_evaluated", None, None)


def test_zero_target_requires_a_positive_building() -> None:
    assert _assess(0) == GfaTargetAssessment(0.0, "met", None, None)
    assert _assess(0, actual=None, upper=None, generated=None, site_area=None, floors=None) == GfaTargetAssessment(
        0.0,
        "not_evaluated",
        None,
        None,
    )


def test_exact_target_is_met_using_actual_gfa() -> None:
    assert _assess(100) == GfaTargetAssessment(100.0, "met", None, None)


def test_subnormal_gfa_shortfall_is_not_hidden_by_one_ulp() -> None:
    actual = 5e-324
    target = 1e-323
    tolerance = gfa_tolerance_m2(1e-160, 1, comparison_scale_m2=target)
    result = _assess(
        target,
        actual=actual,
        upper=target,
        generated=target,
        site_area=1e-160,
        floors=1,
    )

    assert math.isfinite(tolerance)
    assert tolerance >= 0
    assert result.status == "unmet"
    assert result.shortfall_m2 == 5e-324


def test_target_inside_tolerance_is_met_and_next_float_outside_is_unmet() -> None:
    actual = 100.0
    tolerance = gfa_tolerance_m2(1_000.0, 6, comparison_scale_m2=actual)
    at_boundary = actual + tolerance
    outside = math.nextafter(at_boundary, math.inf)

    assert at_boundary > actual
    assert _assess(at_boundary).status == "met"
    result = _assess(outside)
    assert result.status == "unmet"
    assert result.shortfall_m2 == pytest.approx(outside - actual)


def test_target_beyond_tolerance_reports_positive_shortfall() -> None:
    result = _assess(250)

    assert result.status == "unmet"
    assert result.shortfall_m2 == 150.0
    assert result.diagnostic_code == "TARGET_UNMET_WITH_PREFERENCES"


def test_hard_bound_diagnostic_has_precedence() -> None:
    result = _assess(600, upper=500, generated=400)

    assert result.status == "unmet"
    assert result.shortfall_m2 == 500.0
    assert result.diagnostic_code == "TARGET_EXCEEDS_UPPER_BOUND"


def test_generated_capacity_diagnostic_is_used_inside_hard_bound() -> None:
    result = _assess(450, upper=500, generated=400)

    assert result.status == "unmet"
    assert result.diagnostic_code == "TARGET_BEYOND_GENERATED_CAPACITY"


def test_preference_diagnostic_is_used_when_generated_capacity_is_sufficient() -> None:
    result = _assess(250, upper=500, generated=300)

    assert result.status == "unmet"
    assert result.diagnostic_code == "TARGET_UNMET_WITH_PREFERENCES"


def test_unknown_generated_capacity_does_not_become_zero() -> None:
    result = _assess(250, upper=500, generated=None)

    assert result.status == "unmet"
    assert result.shortfall_m2 == 150.0
    assert result.diagnostic_code is None


def test_unknown_capacity_still_reports_hard_bound_exceedance() -> None:
    result = _assess(600, upper=500, generated=None)

    assert result.status == "unmet"
    assert result.diagnostic_code == "TARGET_EXCEEDS_UPPER_BOUND"


def test_actual_gfa_controls_assessment_over_nominal_values() -> None:
    result = _assess(250, actual=249.9999999, upper=300, generated=200)

    assert result.status == "met"
    assert result.shortfall_m2 is None
    assert result.diagnostic_code is None


def test_assessment_objects_are_frozen_and_slotted() -> None:
    result = _assess(100)

    with pytest.raises(AttributeError):
        result.status = "unmet"  # type: ignore[misc]
    assert not hasattr(result, "__dict__")


def test_invalid_targets_object_type_is_rejected() -> None:
    with pytest.raises(TypeError, match="targets must be a DesignTargets instance"):
        assess_gfa_target(
            object(),  # type: ignore[arg-type]
            actual_gfa_m2=100.0,
            gfa_upper_bound_m2=500.0,
            generated_gfa_capacity_m2=400.0,
            site_area_m2=1_000.0,
            maximum_permitted_floor_count=6,
        )


@pytest.mark.parametrize(
    ("kwargs", "message"),
    [
        ({"actual_gfa_m2": 0.0}, "actual_gfa_m2"),
        ({"actual_gfa_m2": math.nan}, "actual_gfa_m2"),
        ({"actual_gfa_m2": 100.0, "gfa_upper_bound_m2": -1.0}, "gfa_upper_bound_m2"),
        ({"actual_gfa_m2": 100.0, "generated_gfa_capacity_m2": 600.0}, "generated_gfa_capacity_m2"),
        ({"actual_gfa_m2": 600.0}, "actual_gfa_m2"),
        ({"actual_gfa_m2": 100.0, "site_area_m2": 0.0}, "site_area_m2"),
        ({"actual_gfa_m2": 100.0, "maximum_permitted_floor_count": 0}, "maximum_permitted_floor_count"),
    ],
)
def test_invalid_assessment_scalars_and_invariants_are_rejected(
    kwargs: dict[str, object],
    message: str,
) -> None:
    arguments: dict[str, object] = {
        "actual_gfa_m2": 100.0,
        "gfa_upper_bound_m2": 500.0,
        "generated_gfa_capacity_m2": 400.0,
        "site_area_m2": 1_000.0,
        "maximum_permitted_floor_count": 6,
    }
    arguments.update(kwargs)

    with pytest.raises((ValueError, TypeError), match=message):
        assess_gfa_target(DesignTargets(250), **arguments)  # type: ignore[arg-type]


def test_large_floor_counts_keep_tolerance_finite_and_conservative() -> None:
    tolerance = gfa_tolerance_m2(
        1e-160,
        2**1074,
        comparison_scale_m2=2_024.0,
    )

    assert math.isfinite(tolerance)
    assert tolerance < 0.01


def test_large_material_shortfall_is_not_hidden_by_floor_count_tolerance() -> None:
    result = _assess(
        2_100.0,
        actual=2_024.0,
        upper=3_000.0,
        generated=2_500.0,
        site_area=1e-160,
        floors=2**1074,
    )

    assert result.status == "unmet"
    assert result.shortfall_m2 == 76.0


def test_finite_but_excessive_propagation_is_capped_before_material_shortfall() -> None:
    tolerance = gfa_tolerance_m2(
        1e-160,
        10**10,
        comparison_scale_m2=2_024.0,
    )
    result = _assess(
        2_100.0,
        actual=2_024.0,
        upper=3_000.0,
        generated=2_500.0,
        site_area=1e-160,
        floors=10**10,
    )

    assert tolerance < 0.01
    assert result.status == "unmet"
    assert result.shortfall_m2 == 76.0


def test_gfa_tolerance_rejects_non_positive_or_non_finite_inputs() -> None:
    with pytest.raises(ValueError):
        gfa_tolerance_m2(0.0, 1, comparison_scale_m2=1.0)
    with pytest.raises(ValueError):
        gfa_tolerance_m2(1.0, 0, comparison_scale_m2=1.0)
    with pytest.raises(ValueError):
        gfa_tolerance_m2(1.0, 1, comparison_scale_m2=math.inf)
