import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { ApiError, saveRootOption } from "./api";
import { optionResponseSchema, rootOptionRequestSchema } from "./contracts";
import type { OptionResponse } from "./contracts";
import { previewRequest, previewResponse } from "../test/massingFixtures";
import { optionResponse } from "../test/optionFixtures";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

describe("saveRootOption", () => {
  it("posts only configuration and an optional trimmed name, then returns the complete saved snapshot", async () => {
    const result = previewResponse();
    const saved = optionResponse(result);
    fetchMock.mockResolvedValue(Response.json(saved, { status: 201 }));

    await expect(saveRootOption({
      ...result,
      name: "  Rectangle study  ",
      parent_id: "550e8400-e29b-41d4-a716-446655440001",
      result,
      width: 40,
      hard_constraints: { ...result.hard_constraints, display_label: "Six floors" },
    } as Parameters<typeof saveRootOption>[0])).resolves.toEqual(saved);

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:8000/api/v1/options");
    expect(options?.method).toBe("POST");
    expect(new Headers(options?.headers).get("Content-Type")).toBe("application/json");
    expect(JSON.parse(options?.body as string)).toEqual({
      site: result.site,
      hard_constraints: result.hard_constraints,
      preferences: result.preferences,
      targets: result.targets,
      name: "Rectangle study",
    });
    expect(saved.parent_id).toBeNull();
    expect(saved.result).toEqual(result);
    expect(saved.site_geometry).toEqual(result.site);
    expect(saved).toMatchObject({
      id: "550e8400-e29b-41d4-a716-446655440000",
      schema_version: 1,
      algorithm_version: "massing-v1;shapely=2.1.2;geos=3.13.1",
      created_at: "2026-10-31T08:00:00Z",
      feasibility_status: "feasible",
    });
  });

  it.each([undefined, null])("supports an unnamed root with name %s", async (name) => {
    const saved = optionResponse(undefined, { name: null });
    fetchMock.mockResolvedValue(Response.json(saved, { status: 201 }));

    await expect(saveRootOption({ ...previewRequest(), name })).resolves.toEqual(saved);

    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string) as Record<string, unknown>;
    if (name === undefined) expect(body).not.toHaveProperty("name");
    else expect(body.name).toBeNull();
    expect(body.preferences).toEqual(previewResponse().preferences);
    expect(body.targets).toEqual(previewResponse().targets);
  });

  it("counts Unicode codepoints for the backend's name length limit", () => {
    expect(rootOptionRequestSchema.parse({
      ...previewRequest(), name: `  ${"🏢".repeat(200)}  `,
    }).name).toBe("🏢".repeat(200));
    expect(rootOptionRequestSchema.safeParse({
      ...previewRequest(), name: "🏢".repeat(201),
    }).success).toBe(false);
  });

  it.each(["", "  \t\n", "a".repeat(201), "Invalid\0name"])(
    "rejects invalid names before sending a request",
    async (name) => {
      await expect(saveRootOption({ ...previewRequest(), name })).rejects.toBeInstanceOf(ZodError);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each(["feasible", "feasible_target_unmet", "infeasible", "generation_failed"] as const)(
    "retains a saved %s result without frontend geometry or metric recomputation",
    async (status) => {
      const result = previewResponse();
      result.feasibility.status = status;
      if (status === "infeasible" || status === "generation_failed") {
        result.footprint_geometry = null;
        result.floor_plate_geometry = null;
        result.generated_footprint_geometry = null;
        result.metrics = {
          ...result.metrics,
          footprint_area_m2: null,
          floor_count: null,
          height_m: null,
          gfa_m2: null,
          site_coverage_ratio: null,
          generated_footprint_area_m2: null,
          generated_gfa_capacity_m2: null,
        };
        result.feasibility.hard_constraints_satisfied = status === "infeasible" ? false : null;
        result.feasibility.reason = status === "infeasible"
          ? "ZERO_PERMITTED_FLOORS" : "FOOTPRINT_NOT_GENERATED";
        result.feasibility.target_assessment.actual_m2 = null;
        result.feasibility.target_assessment.status = "not_evaluated";
      }
      const saved = optionResponse(result);
      fetchMock.mockResolvedValue(Response.json(saved, { status: 201 }));

      await expect(saveRootOption(previewRequest())).resolves.toEqual(saved);
      expect(fetchMock).toHaveBeenCalledOnce();
    },
  );

  it("accepts additive response fields while retaining known saved fields", async () => {
    const saved = optionResponse();
    fetchMock.mockResolvedValue(Response.json({
      ...saved,
      future_metadata: true,
      result: { ...saved.result, future_result: 1 },
    }, { status: 201 }));

    await expect(saveRootOption(previewRequest())).resolves.toEqual(saved);
  });

  it("parses general child metadata but rejects it as a successful root save", async () => {
    const child = optionResponse(undefined, { parent_id: "550e8400-e29b-41d4-a716-446655440001" });
    expect(optionResponseSchema.parse(child)).toEqual(child);
    fetchMock.mockResolvedValue(Response.json(child, { status: 201 }));

    await expect(saveRootOption(previewRequest())).rejects.toMatchObject({
      kind: "malformed_response", status: 201,
    });
  });

  it.each([
    { label: "null", make: () => null },
    { label: "a preview instead of a saved snapshot", make: () => previewResponse() },
    { label: "missing parent metadata", make: (saved: OptionResponse) => ({ ...saved, parent_id: undefined }) },
    { label: "an invalid UUID", make: (saved: OptionResponse) => ({ ...saved, id: "not-a-uuid" }) },
    { label: "an invalid parent UUID", make: (saved: OptionResponse) => ({ ...saved, parent_id: "not-a-uuid" }) },
    { label: "a zero schema version", make: (saved: OptionResponse) => ({ ...saved, schema_version: 0 }) },
    { label: "a missing algorithm version", make: (saved: OptionResponse) => ({ ...saved, algorithm_version: undefined }) },
    { label: "a naive timestamp", make: (saved: OptionResponse) => ({ ...saved, created_at: "2026-10-31T08:00:00" }) },
    { label: "an impossible timestamp", make: (saved: OptionResponse) => ({ ...saved, created_at: "2026-02-30T08:00:00Z" }) },
    { label: "missing saved configuration", make: (saved: OptionResponse) => ({ ...saved, preferences: undefined }) },
    { label: "a missing computed result", make: (saved: OptionResponse) => ({ ...saved, result: undefined }) },
    { label: "incomplete nested metrics", make: (saved: OptionResponse) => ({
      ...saved, result: { ...saved.result, metrics: {} },
    }) },
    { label: "inconsistent saved feasibility", make: (saved: OptionResponse) => ({
      ...saved, feasibility_status: "infeasible",
    }) },
  ])("rejects a successful response containing $label", async ({ make }) => {
    fetchMock.mockResolvedValue(Response.json(make(optionResponse()), { status: 201 }));

    await expect(saveRootOption(previewRequest())).rejects.toMatchObject({
      kind: "malformed_response", status: 201, message: "Invalid saved option response.",
    });
  });

  it("requires HTTP 201 even when another success status contains a valid snapshot", async () => {
    fetchMock.mockResolvedValue(Response.json(optionResponse(), { status: 200 }));

    await expect(saveRootOption(previewRequest())).rejects.toMatchObject({
      kind: "malformed_response", status: 200,
    });
  });

  it("preserves structured validation codes, paths, and messages", async () => {
    const error = {
      code: "INVALID_REQUEST",
      message: "Request validation failed.",
      details: [{ path: "name", message: "String should have at most 200 characters." }],
    };
    fetchMock.mockResolvedValue(Response.json({ error }, { status: 422 }));

    await expect(saveRootOption(previewRequest())).rejects.toMatchObject({
      kind: "http", status: 422, message: error.message, error,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each(["Internal Server Error", JSON.stringify({ error: { code: 42 } })])(
    "retains HTTP errors when the body is not a valid structured envelope",
    async (body) => {
      fetchMock.mockResolvedValue(new Response(body, { status: 500 }));

      await expect(saveRootOption(previewRequest())).rejects.toMatchObject({
        kind: "http", status: 500, message: "Save option failed: HTTP 500", error: null,
      });
    },
  );

  it("preserves network failure causes without retrying a non-idempotent save", async () => {
    const cause = new TypeError("Failed to fetch");
    fetchMock.mockRejectedValue(cause);

    await expect(saveRootOption(previewRequest())).rejects.toMatchObject({
      kind: "network", status: null, cause,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("reports unreadable successful JSON without assuming insertion failed or retrying", async () => {
    fetchMock.mockResolvedValue(new Response("not JSON", { status: 201 }));

    const failure: unknown = await saveRootOption(previewRequest()).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ kind: "malformed_response", status: 201 });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("retains timezone-aware timestamps with explicit offsets", () => {
    const saved = optionResponse(undefined, { created_at: "2026-10-31T11:00:00+03:00" });
    expect(optionResponseSchema.parse(saved)).toEqual(saved);
  });
});
