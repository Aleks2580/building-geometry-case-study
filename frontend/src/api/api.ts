import {
  branchOptionRequestSchema,
  errorResponseSchema,
  massingPreviewResponseSchema,
  optionResponseSchema,
  rootOptionRequestSchema,
} from "./contracts";
import type {
  BranchOptionRequest,
  ErrorBody,
  MassingPreviewRequest,
  MassingPreviewResponse,
  OptionResponse,
  RootOptionRequest,
} from "./contracts";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8000";

export interface HealthResponse {
  status: string;
}

export async function getHealth(): Promise<HealthResponse> {
  const res = await fetch(`${API_BASE}/api/v1/health`);
  if (!res.ok) throw new Error(`health check failed: ${res.status}`);
  const data: unknown = await res.json();
  if (
    typeof data !== "object" ||
    data === null ||
    !("status" in data) ||
    typeof data.status !== "string"
  ) {
    throw new Error("invalid health response");
  }
  return { status: data.status };
}

export class ApiError extends Error {
  readonly status: number | null;
  readonly error: ErrorBody | null;
  readonly cause: unknown;

  constructor(
    readonly kind: "http" | "network" | "malformed_response",
    message: string,
    options: { status?: number; error?: ErrorBody; cause?: unknown } = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.status = options.status ?? null;
    this.error = options.error ?? null;
    this.cause = options.cause;
  }
}

function rethrowCancellation(cause: unknown, signal?: AbortSignal): void {
  signal?.throwIfAborted();
  if ((cause instanceof Error || cause instanceof DOMException) && cause.name === "AbortError") {
    throw cause;
  }
}

export async function previewMassing(
  request: MassingPreviewRequest,
  signal?: AbortSignal,
): Promise<MassingPreviewResponse> {
  signal?.throwIfAborted();
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/api/v1/massing/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal,
    });
  } catch (cause) {
    rethrowCancellation(cause, signal);
    throw new ApiError("network", "Unable to reach the massing API.", { cause });
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch (cause) {
    rethrowCancellation(cause, signal);
    if (response.ok) {
      throw new ApiError("malformed_response", "Invalid massing preview response.", {
        status: response.status, cause,
      });
    }
    throw new ApiError("http", `Massing preview failed: HTTP ${response.status}`, {
      status: response.status, cause,
    });
  }
  signal?.throwIfAborted();

  if (!response.ok) {
    const parsed = errorResponseSchema.safeParse(data);
    throw new ApiError(
      "http",
      parsed.success ? parsed.data.error.message : `Massing preview failed: HTTP ${response.status}`,
      { status: response.status, error: parsed.success ? parsed.data.error : undefined },
    );
  }

  const parsed = massingPreviewResponseSchema.safeParse(data);
  if (!parsed.success) {
    throw new ApiError("malformed_response", "Invalid massing preview response.", {
      status: response.status,
    });
  }
  return parsed.data;
}

export async function saveRootOption(request: RootOptionRequest): Promise<OptionResponse> {
  const body = rootOptionRequestSchema.parse(request);
  const saved = await saveOption("/api/v1/options", body);
  if (saved.parent_id !== null) {
    throw new ApiError("malformed_response", "Invalid saved option response.", { status: 201 });
  }
  return saved;
}

export async function saveBranchOption(
  parentId: string,
  request: BranchOptionRequest,
): Promise<OptionResponse> {
  const validParentId = optionResponseSchema.shape.id.parse(parentId).toLowerCase();
  const body = branchOptionRequestSchema.parse(request);
  const saved = await saveOption(`/api/v1/options/${encodeURIComponent(validParentId)}/branches`, body);
  if (saved.parent_id?.toLowerCase() !== validParentId || saved.id.toLowerCase() === validParentId) {
    throw new ApiError("malformed_response", "Invalid saved option response.", { status: 201 });
  }
  return saved;
}

async function saveOption(path: string, body: unknown): Promise<OptionResponse> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (cause) {
    throw new ApiError("network", "Unable to reach the options API.", { cause });
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch (cause) {
    if (response.ok) {
      throw new ApiError("malformed_response", "Invalid saved option response.", {
        status: response.status, cause,
      });
    }
    throw new ApiError("http", `Save option failed: HTTP ${response.status}`, {
      status: response.status, cause,
    });
  }

  if (!response.ok) {
    const parsed = errorResponseSchema.safeParse(data);
    throw new ApiError(
      "http",
      parsed.success ? parsed.data.error.message : `Save option failed: HTTP ${response.status}`,
      { status: response.status, error: parsed.success ? parsed.data.error : undefined },
    );
  }

  const parsed = optionResponseSchema.safeParse(data);
  if (response.status !== 201 || !parsed.success) {
    throw new ApiError("malformed_response", "Invalid saved option response.", {
      status: response.status,
    });
  }
  return parsed.data;
}
