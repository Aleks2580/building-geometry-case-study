import {
  branchOptionRequestSchema,
  errorResponseSchema,
  massingPreviewResponseSchema,
  optionComparisonRequestSchema,
  optionComparisonResponseSchema,
  optionMetadataSchema,
  optionResponseSchema,
  optionSummarySchema,
  optionTreeSchema,
  rootOptionRequestSchema,
} from "./contracts";
import type {
  BranchOptionRequest,
  ErrorBody,
  MassingPreviewRequest,
  MassingPreviewResponse,
  OptionComparisonRequest,
  OptionComparisonResponse,
  OptionResponse,
  OptionSummary,
  OptionTree,
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

export async function listOptions(
  { limit = 50, offset = 0 }: { limit?: number; offset?: number } = {},
  signal?: AbortSignal,
): Promise<OptionSummary[]> {
  const parameters = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  const message = "Invalid saved options list response.";
  const data = await readOptions(`/api/v1/options?${parameters}`, message, signal);
  const parsed = optionSummarySchema.array().safeParse(data);
  if (!parsed.success) {
    throw new ApiError("malformed_response", message, { status: 200 });
  }
  return parsed.data;
}

export async function getOptionTree(rootId: string, signal?: AbortSignal): Promise<OptionTree> {
  const validRootId = optionMetadataSchema.shape.id.parse(rootId).toLowerCase();
  const parameters = new URLSearchParams({ root_id: validRootId });
  const message = "Invalid saved option tree response.";
  const data = await readOptions(`/api/v1/options/tree?${parameters}`, message, signal);
  const parsed = optionTreeSchema.safeParse(data);
  if (!parsed.success || parsed.data.id.toLowerCase() !== validRootId) {
    throw new ApiError("malformed_response", message, { status: 200 });
  }
  return parsed.data;
}

export async function getOption(optionId: string, signal?: AbortSignal): Promise<OptionResponse> {
  const validOptionId = optionMetadataSchema.shape.id.parse(optionId).toLowerCase();
  const message = "Invalid saved option response.";
  const data = await readOptions(`/api/v1/options/${encodeURIComponent(validOptionId)}`, message, signal);
  const parsed = optionResponseSchema.safeParse(data);
  if (!parsed.success || parsed.data.id.toLowerCase() !== validOptionId) {
    throw new ApiError("malformed_response", message, { status: 200 });
  }
  return parsed.data;
}

export async function compareOptions(
  request: OptionComparisonRequest,
  signal?: AbortSignal,
): Promise<OptionComparisonResponse> {
  const body = optionComparisonRequestSchema.parse(request);
  const message = "Invalid saved option comparison response.";
  const data = await readOptions("/api/v1/options/compare", message, signal, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const parsed = optionComparisonResponseSchema.safeParse(data);
  if (!parsed.success || parsed.data.options.some(
    (option, index) => option.id.toLowerCase() !== body.option_ids[index],
  )) {
    throw new ApiError("malformed_response", message, { status: 200 });
  }
  return parsed.data;
}

async function readOptions(
  path: string,
  invalidMessage: string,
  signal?: AbortSignal,
  init: RequestInit = {},
): Promise<unknown> {
  signal?.throwIfAborted();
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { ...init, signal });
  } catch (cause) {
    rethrowCancellation(cause, signal);
    throw new ApiError("network", "Unable to reach the options API.", { cause });
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch (cause) {
    rethrowCancellation(cause, signal);
    if (response.ok) {
      throw new ApiError("malformed_response", invalidMessage, { status: response.status, cause });
    }
    throw new ApiError("http", `Read options failed: HTTP ${response.status}`, {
      status: response.status, cause,
    });
  }
  signal?.throwIfAborted();

  if (!response.ok) {
    const parsed = errorResponseSchema.safeParse(data);
    throw new ApiError(
      "http",
      parsed.success ? parsed.data.error.message : `Read options failed: HTTP ${response.status}`,
      { status: response.status, error: parsed.success ? parsed.data.error : undefined },
    );
  }
  if (response.status !== 200) {
    throw new ApiError("malformed_response", invalidMessage, { status: response.status });
  }
  return data;
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
