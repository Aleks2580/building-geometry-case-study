import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { ApiError, saveBranchOption } from "./api";
import { branchOptionRequestSchema } from "./contracts";
import type { BranchOptionRequest, OptionResponse } from "./contracts";
import { previewResponse } from "../test/massingFixtures";
import { optionResponse } from "../test/optionFixtures";

const parentId = "550e8400-e29b-41d4-a716-446655440001";
const fetchMock = vi.fn<typeof fetch>();

function branchRequest(): BranchOptionRequest {
  const result = previewResponse();
  return {
    hard_constraints: result.hard_constraints,
    preferences: result.preferences,
    targets: result.targets,
  };
}

function childResponse(overrides: Partial<OptionResponse> = {}): OptionResponse {
  return optionResponse(undefined, { parent_id: parentId, ...overrides });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

describe("saveBranchOption", () => {
  it("posts complete replacement configuration without site, parent, or computed fields", async () => {
    const parent = optionResponse(undefined, { id: parentId });
    const originalParent = structuredClone(parent);
    const request = {
      hard_constraints: {
        setback_m: 2, floor_to_floor_m: 3, max_height_m: 12, max_floors: 3,
        site_coverage_ratio: 0.5, max_footprint_m2: 400,
      },
      preferences: { preferred_floor_count: 2, preferred_footprint_area_m2: 350 },
      targets: { gfa_target_m2: 500 },
      name: "  Reduced footprint  ",
    };
    const child = childResponse();
    fetchMock.mockResolvedValue(Response.json(child, { status: 201 }));

    await expect(saveBranchOption(parent.id, {
      ...parent.result,
      ...request,
      parent_id: "550e8400-e29b-41d4-a716-446655440099",
      site_geometry: parent.site_geometry,
      result: parent.result,
      hard_constraints: { ...request.hard_constraints, display_label: "Three floors" },
    } as BranchOptionRequest)).resolves.toEqual(child);

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(`http://localhost:8000/api/v1/options/${parentId}/branches`);
    expect(options?.method).toBe("POST");
    expect(new Headers(options?.headers).get("Content-Type")).toBe("application/json");
    expect(JSON.parse(options?.body as string)).toEqual({ ...request, name: "Reduced footprint" });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(child.site_geometry).toEqual(parent.site_geometry);
    expect(child.parent_id).toBe(parent.id);
    expect(parent).toEqual(originalParent);
  });

  it.each([undefined, null])("supports an optional name of %s", async (name) => {
    const child = childResponse({ name: null });
    fetchMock.mockResolvedValue(Response.json(child, { status: 201 }));

    await expect(saveBranchOption(parentId, { ...branchRequest(), name })).resolves.toEqual(child);

    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string) as Record<string, unknown>;
    if (name === undefined) expect(body).not.toHaveProperty("name");
    else expect(body.name).toBeNull();
  });

  it.each(["", "  \t\n", "a".repeat(201), "Invalid\0name"])(
    "rejects an invalid name before submitting",
    async (name) => {
      await expect(saveBranchOption(parentId, { ...branchRequest(), name })).rejects.toBeInstanceOf(ZodError);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each(["hard_constraints", "preferences", "targets"] as const)(
    "requires the replacement %s section",
    async (field) => {
      const request = { ...branchRequest(), [field]: undefined };
      expect(branchOptionRequestSchema.safeParse(request).success).toBe(false);
      await expect(saveBranchOption(parentId, request)).rejects.toBeInstanceOf(ZodError);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each(["not-a-uuid", "../options", "", `${parentId}/branches`])(
    "rejects an invalid parent identifier before submitting",
    async (id) => {
      await expect(saveBranchOption(id, branchRequest())).rejects.toBeInstanceOf(ZodError);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("matches UUID identity independently of letter case", async () => {
    const child = childResponse();
    fetchMock.mockResolvedValue(Response.json(child, { status: 201 }));

    await expect(saveBranchOption(parentId.toUpperCase(), branchRequest())).resolves.toEqual(child);
    expect(fetchMock.mock.calls[0][0]).toBe(`http://localhost:8000/api/v1/options/${parentId}/branches`);
  });

  it.each(["feasible", "feasible_target_unmet", "infeasible", "generation_failed"] as const)(
    "retains a %s saved snapshot and its diagnostic context",
    async (status) => {
      const result = previewResponse();
      result.feasibility.status = status;
      if (status === "infeasible" || status === "generation_failed") {
        result.footprint_geometry = null;
        result.floor_plate_geometry = null;
        result.generated_footprint_geometry = null;
        result.metrics = {
          ...result.metrics, footprint_area_m2: null, floor_count: null, height_m: null,
          gfa_m2: null, site_coverage_ratio: null,
          generated_footprint_area_m2: null, generated_gfa_capacity_m2: null,
        };
        result.feasibility.reason = status === "infeasible"
          ? "ZERO_PERMITTED_FLOORS" : "FOOTPRINT_NOT_GENERATED";
        result.feasibility.hard_constraints_satisfied = status === "infeasible" ? false : null;
        result.feasibility.diagnostics = [{
          code: result.feasibility.reason, severity: "error", message: "No building was generated.",
        }];
        result.feasibility.target_assessment.actual_m2 = null;
        result.feasibility.target_assessment.status = "not_evaluated";
      }
      const saved = optionResponse(result, { parent_id: parentId });
      fetchMock.mockResolvedValue(Response.json(saved, { status: 201 }));

      await expect(saveBranchOption(parentId, branchRequest())).resolves.toEqual(saved);
      expect(fetchMock).toHaveBeenCalledOnce();
    },
  );

  it("creates distinct siblings without changing the selected parent identifier", async () => {
    const first = childResponse();
    const second = childResponse({ id: "550e8400-e29b-41d4-a716-446655440002" });
    fetchMock.mockResolvedValueOnce(Response.json(first, { status: 201 }))
      .mockResolvedValueOnce(Response.json(second, { status: 201 }));

    await expect(saveBranchOption(parentId, branchRequest())).resolves.toEqual(first);
    await expect(saveBranchOption(parentId, branchRequest())).resolves.toEqual(second);

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      `http://localhost:8000/api/v1/options/${parentId}/branches`,
      `http://localhost:8000/api/v1/options/${parentId}/branches`,
    ]);
    expect(first.id).not.toBe(second.id);
  });

  it.each([
    { label: "a root response", make: (saved: OptionResponse) => ({ ...saved, parent_id: null }) },
    { label: "another parent's child", make: (saved: OptionResponse) => ({
      ...saved, parent_id: "550e8400-e29b-41d4-a716-446655440099",
    }) },
    { label: "the parent's own identifier", make: (saved: OptionResponse) => ({ ...saved, id: parentId }) },
    { label: "missing computed results", make: (saved: OptionResponse) => ({ ...saved, result: undefined }) },
    { label: "an invalid child UUID", make: (saved: OptionResponse) => ({ ...saved, id: "invalid" }) },
    { label: "inconsistent feasibility", make: (saved: OptionResponse) => ({
      ...saved, feasibility_status: "infeasible",
    }) },
  ])("rejects a successful response containing $label", async ({ make }) => {
    fetchMock.mockResolvedValue(Response.json(make(childResponse()), { status: 201 }));

    await expect(saveBranchOption(parentId, branchRequest())).rejects.toMatchObject({
      kind: "malformed_response", status: 201,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("requires HTTP 201 for a complete child response", async () => {
    fetchMock.mockResolvedValue(Response.json(childResponse(), { status: 200 }));

    await expect(saveBranchOption(parentId, branchRequest())).rejects.toMatchObject({
      kind: "malformed_response", status: 200,
    });
  });

  it.each([
    { status: 404, code: "PARENT_OPTION_NOT_FOUND", path: "option_id" },
    { status: 422, code: "INVALID_CONSTRAINTS", path: "hard_constraints" },
    { status: 422, code: "INVALID_PREFERENCE", path: "preferences.preferred_floor_count" },
    { status: 422, code: "INVALID_TARGET", path: "targets.gfa_target_m2" },
    { status: 422, code: "INVALID_REQUEST", path: "name" },
  ])("preserves HTTP $status $code details without retrying", async ({ status, code, path }) => {
    const error = { code, message: "Request failed.", details: [{ path, message: "Invalid value." }] };
    fetchMock.mockResolvedValue(Response.json({ error }, { status }));

    await expect(saveBranchOption(parentId, branchRequest())).rejects.toMatchObject({
      kind: "http", status, error,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("preserves uncertain network failure causes without retrying", async () => {
    const cause = new TypeError("Failed to fetch");
    fetchMock.mockRejectedValue(cause);

    await expect(saveBranchOption(parentId, branchRequest())).rejects.toMatchObject({
      kind: "network", status: null, cause,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("reports an unreadable success response without retrying or implying rollback", async () => {
    fetchMock.mockResolvedValue(new Response("not JSON", { status: 201 }));

    const failure: unknown = await saveBranchOption(parentId, branchRequest()).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ kind: "malformed_response", status: 201 });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
