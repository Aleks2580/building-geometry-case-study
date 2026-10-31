from collections.abc import Sequence

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.v1.schemas.massing import ErrorResponse


def validation_response(code: str, message: str, *, path: str) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content=ErrorResponse.model_validate(
            {"error": {"code": code, "message": message, "details": [{"path": path, "message": message}]}}
        ).model_dump(mode="json"),
    )


def not_found_response(code: str, message: str, *, path: str, detail: str) -> JSONResponse:
    return JSONResponse(
        status_code=404,
        content=ErrorResponse.model_validate(
            {"error": {"code": code, "message": message, "details": [{"path": path, "message": detail}]}}
        ).model_dump(mode="json"),
    )


async def request_validation_error_handler(request: Request, error: RequestValidationError) -> JSONResponse:
    errors = error.errors()
    section_codes = {
        "site": "INVALID_SITE_GEOMETRY",
        "hard_constraints": "INVALID_CONSTRAINTS",
        "preferences": "INVALID_PREFERENCE",
        "targets": "INVALID_TARGET",
    }
    first_path = errors[0]["loc"] if errors else ()
    section = first_path[1] if len(first_path) > 1 and first_path[0] == "body" else None
    code = section_codes.get(section, "INVALID_REQUEST") if isinstance(section, str) else "INVALID_REQUEST"
    # Selection errors share one code, including malformed JSON and forbidden fields.
    if getattr(request.scope.get("route"), "name", None) == "compare_saved_options":
        code = "INVALID_COMPARISON"
    # Validation inputs and exception contexts can contain complete user payloads
    # or non-finite numbers. Expose only paths and messages in the public envelope.
    payload = {
        "error": {
            "code": code,
            "message": "Request validation failed.",
            "details": [{"path": _request_path(item["loc"]), "message": item["msg"]} for item in errors],
        }
    }
    return JSONResponse(status_code=422, content=ErrorResponse.model_validate(payload).model_dump(mode="json"))


def _request_path(location: Sequence[str | int]) -> str:
    parts = location[1:] if location and location[0] == "body" else location
    # Coordinate ordinates use an int/float union to preserve original integers.
    # Pydantic branch labels identify validators, not fields in the request body.
    if len(parts) > 1 and parts[-1] in ("int", "float") and isinstance(parts[-2], int):
        parts = parts[:-1]
    path = ""
    for part in parts:
        path += f"[{part}]" if isinstance(part, int) else f".{part}" if path else part
    return path or "body"
