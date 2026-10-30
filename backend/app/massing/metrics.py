"""Exact arithmetic for finite derived massing metrics."""

from math import isfinite


class NumericalRangeError(OverflowError):
    """A required derived metric cannot be represented by a finite float."""


def multiply_metric(value: float, count: int, *, metric_name: str) -> float:
    """Multiply a finite stored float by an integer before the final float conversion."""
    if count == 0 or value == 0:
        return 0.0
    numerator, denominator = value.as_integer_ratio()
    try:
        product = (numerator * count) / denominator
    except (OverflowError, ZeroDivisionError) as error:
        raise NumericalRangeError(f"{metric_name} must be representable as a finite float.") from error
    if not isfinite(product):
        raise NumericalRangeError(f"{metric_name} must be representable as a finite float.")
    return float(product)
