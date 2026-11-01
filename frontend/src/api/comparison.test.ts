import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { compareOptions } from "./api";
import { optionComparisonRequestSchema, optionComparisonResponseSchema } from "./contracts";
import type { OptionComparisonRequest } from "./contracts";
import { optionComparisonResponse } from "../test/comparisonFixtures";
import { backendPreviewResponse } from "../test/backendPreviewFixtures";
import { optionResponse } from "../test/optionFixtures";

const fetchMock = vi.fn<typeof fetch>();
const leftId = "550e8400-e29b-41d4-a716-446655440000";
const rightId = "550e8400-e29b-41d4-a716-446655440001";
const request: OptionComparisonRequest = { option_ids: [leftId, rightId] };

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

describe("compareOptions", () => {
  it("posts exactly the ordered normalized UUID pair and passes cancellation", async () => {
    const response = optionComparisonResponse();
    const controller = new AbortController();
    fetchMock.mockResolvedValue(Response.json(response));

    await expect(compareOptions({ option_ids: [leftId.toUpperCase(), rightId] }, controller.signal))
      .resolves.toEqual(response);

    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("http://localhost:8000/api/v1/options/compare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
  });

  it("validates identity casing without altering snapshot metadata", async () => {
    const response = optionComparisonResponse();
    response.options[0].id = leftId.toUpperCase();
    response.options[1].id = rightId.toUpperCase();
    fetchMock.mockResolvedValue(Response.json(response));

    await expect(compareOptions(request)).resolves.toEqual(response);
  });

  it.each([
    null, {}, [], { option_ids: null }, { option_ids: [] },
    { option_ids: [leftId] }, { option_ids: [leftId, rightId, leftId] },
    { option_ids: [leftId, "invalid"] }, { option_ids: [42, rightId] },
    { option_ids: [leftId, leftId] }, { option_ids: [leftId, leftId.toUpperCase()] },
    { option_ids: [leftId, rightId], site: {} },
  ])("rejects malformed selections before making a request %#", async (body) => {
    expect(optionComparisonRequestSchema.safeParse(body).success).toBe(false);
    await expect(compareOptions(body as OptionComparisonRequest)).rejects.toBeInstanceOf(ZodError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    { ids: [rightId, leftId], label: "swapped" },
    { ids: [leftId, leftId], label: "duplicate" },
    { ids: [leftId, "550e8400-e29b-41d4-a716-446655440002"], label: "unrelated" },
  ])("rejects $label response identities", async ({ ids }) => {
    const response = optionComparisonResponse();
    response.options[0].id = ids[0]!;
    response.options[1].id = ids[1]!;
    fetchMock.mockResolvedValue(Response.json(response));

    await expect(compareOptions(request)).rejects.toMatchObject({
      kind: "malformed_response", status: 200, message: "Invalid saved option comparison response.",
    });
  });

  it("preserves signed and tiny supplied differences without recomputation", async () => {
    const response = optionComparisonResponse();
    response.inputs.hard_constraints.setback_m = {
      left: 0.3, right: 0.30000000000000004, changed: true, difference: 5.551115123125783e-17,
    };
    response.inputs.targets.gfa_target_m2 = { left: 0, right: 100, changed: true, difference: 100 };
    fetchMock.mockResolvedValue(Response.json(response));

    const comparison = await compareOptions(request);

    expect(comparison).toEqual(response);
    expect(comparison.metrics.floor_count.difference).toBe(-2);
    expect(comparison.metrics.gfa_m2.difference).toBe(-1292);
    expect(comparison.inputs.hard_constraints.setback_m.changed).toBe(true);
    expect(comparison.inputs.hard_constraints.setback_m.difference).toBe(5.551115123125783e-17);
    expect(Object.keys(comparison.metrics)).toEqual(Object.keys(comparison.options[0].result.metrics));
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([
    { left: null, right: null, changed: false, difference: null },
    { left: null, right: 0, changed: true, difference: null },
    { left: 7, right: null, changed: true, difference: null },
  ])("retains unavailable numeric values and differences %#", async (values) => {
    const response = optionComparisonResponse();
    response.metrics.gfa_m2 = values;
    fetchMock.mockResolvedValue(Response.json(response));

    const comparison = await compareOptions(request);

    expect(comparison.metrics.gfa_m2).toEqual(values);
  });

  it.each(["feasible", "feasible_target_unmet", "infeasible", "generation_failed"] as const)(
    "retains %s and complete feasibility and diagnostic objects", async (status) => {
      const response = optionComparisonResponse();
      const rightFeasibility = response.options[1].result.feasibility;
      response.options[1].feasibility_status = status;
      rightFeasibility.status = status;
      rightFeasibility.reason = "FOOTPRINT_NOT_GENERATED";
      rightFeasibility.hard_constraints_satisfied = null;
      rightFeasibility.target_assessment = {
        requested_m2: 5000, actual_m2: null, shortfall_m2: null,
        status: "not_evaluated", diagnostic_code: null,
      };
      rightFeasibility.diagnostics = [
        {
          code: "FOOTPRINT_NOT_GENERATED", severity: "error", message: "First diagnostic.",
          path: "hard_constraints.max_footprint_m2",
          details: { cap_m2: 100, attempted: true, outcome: null, strategy: "inset" },
        },
        {
          code: "BUILDABLE_REGION_SPLIT", severity: "info", message: "Second diagnostic.",
          path: null, details: { components: 2 },
        },
      ];
      response.feasibility = {
        status: { left: "feasible", right: status, changed: status !== "feasible" },
        reason: { left: null, right: rightFeasibility.reason, changed: true },
        hard_constraints_satisfied: { left: true, right: null, changed: true },
        target_assessment: {
          left: response.options[0].result.feasibility.target_assessment,
          right: rightFeasibility.target_assessment,
          changed: true,
        },
      };
      response.diagnostics = { left: [], right: rightFeasibility.diagnostics, changed: true };
      fetchMock.mockResolvedValue(Response.json(response));

      await expect(compareOptions(request)).resolves.toEqual(response);
    },
  );

  it("preserves structural site changes, holes, split setbacks and absent footprints", async () => {
    const response = optionComparisonResponse();
    const holedResult = backendPreviewResponse("holed");
    response.options[1] = optionResponse(holedResult, { id: rightId, parent_id: null });
    response.inputs.site_geometry = {
      left: response.options[0].site_geometry, right: response.options[1].site_geometry, changed: true,
    };
    fetchMock.mockResolvedValueOnce(Response.json(response));
    const holed = await compareOptions(request);
    expect(holed.options[1].site_geometry.coordinates).toHaveLength(2);
    expect(holed.inputs.site_geometry).toEqual(response.inputs.site_geometry);

    const footprint = response.options[0].result.buildable_geometry!;
    response.options[0].result.buildable_geometry = {
      type: "MultiPolygon", coordinates: [footprint.type === "Polygon" ? footprint.coordinates : footprint.coordinates[0]!],
    };
    response.options[0].result.footprint_geometry = null;
    response.options[0].result.floor_plate_geometry = null;
    fetchMock.mockResolvedValueOnce(Response.json(response));

    await expect(compareOptions(request)).resolves.toEqual(response);
  });
});

describe("comparison response validation", () => {
  it.each([
    null, [], {},
    { ...optionComparisonResponse(), options: [] },
    { ...optionComparisonResponse(), options: [optionResponse()] },
    { ...optionComparisonResponse(), options: [...optionComparisonResponse().options, optionResponse()] },
    { ...optionComparisonResponse(), inputs: null },
    { ...optionComparisonResponse(), metrics: {} },
    { ...optionComparisonResponse(), feasibility: {} },
    { ...optionComparisonResponse(), diagnostics: { left: [], right: [] } },
  ])("rejects malformed successful transport data %#", async (response) => {
    fetchMock.mockResolvedValue(Response.json(response));
    await expect(compareOptions(request)).rejects.toMatchObject({ kind: "malformed_response", status: 200 });
  });

  it("requires every comparison field and comparison metadata", () => {
    const response = optionComparisonResponse();
    const groups = [
      response.inputs.hard_constraints, response.inputs.preferences,
      response.inputs.targets, response.metrics, response.feasibility,
    ];
    for (const group of groups) {
      for (const key of Object.keys(group)) {
        const value = Reflect.get(group, key) as unknown;
        Reflect.deleteProperty(group, key);
        expect(optionComparisonResponseSchema.safeParse(response).success, key).toBe(false);
        Reflect.set(group, key, value);
      }
    }
    for (const key of ["left", "right", "changed", "difference"]) {
      const value = Reflect.get(response.metrics.gfa_m2, key) as unknown;
      Reflect.deleteProperty(response.metrics.gfa_m2, key);
      expect(optionComparisonResponseSchema.safeParse(response).success, key).toBe(false);
      Reflect.set(response.metrics.gfa_m2, key, value);
    }
    expect(optionComparisonResponseSchema.safeParse(response).success).toBe(true);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects non-finite comparison values %s", (value) => {
      const response = optionComparisonResponse();
      response.metrics.gfa_m2.difference = value;
      expect(optionComparisonResponseSchema.safeParse(response).success).toBe(false);
      response.metrics.gfa_m2.difference = null;
      response.metrics.gfa_m2.left = value;
      expect(optionComparisonResponseSchema.safeParse(response).success).toBe(false);
    },
  );

  it.each([Number.MAX_SAFE_INTEGER + 1, 1.5])("rejects unsafe or fractional count data %s", (value) => {
    const response = optionComparisonResponse();
    for (const comparison of [
      response.metrics.floor_count, response.metrics.maximum_permitted_floor_count,
      response.inputs.hard_constraints.max_floors, response.inputs.preferences.preferred_floor_count,
    ]) {
      for (const key of ["left", "right", "difference"] as const) {
        const original = comparison[key];
        comparison[key] = value;
        expect(optionComparisonResponseSchema.safeParse(response).success).toBe(false);
        comparison[key] = original;
      }
    }
  });

  it("accepts additive response fields through the existing API v1 policy", () => {
    const response = optionComparisonResponse();
    expect(optionComparisonResponseSchema.parse({ ...response, future_field: "supported" })).toEqual(response);
  });
});

describe("comparison failures and cancellation", () => {
  it.each([
    { status: 404, code: "OPTION_NOT_FOUND", path: "option_ids[1]" },
    { status: 422, code: "INVALID_COMPARISON", path: "option_ids" },
  ])("retains structured $status errors", async ({ status, code, path }) => {
    const error = { code, message: "Comparison failed.", details: [{ path, message: "Selection unavailable." }] };
    fetchMock.mockResolvedValue(Response.json({ error }, { status }));
    await expect(compareOptions(request)).rejects.toMatchObject({ kind: "http", status, message: error.message, error });
  });

  it.each(["Unavailable", JSON.stringify({ error: { code: 42 } })])("handles invalid error bodies", async (body) => {
    fetchMock.mockResolvedValue(new Response(body, { status: 503 }));
    await expect(compareOptions(request)).rejects.toMatchObject({ kind: "http", status: 503, error: null });
  });

  it("preserves network failures and never retries", async () => {
    const cause = new TypeError("Failed to fetch");
    fetchMock.mockRejectedValue(cause);
    await expect(compareOptions(request)).rejects.toMatchObject({ kind: "network", status: null, cause });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects non-JSON success data", async () => {
    fetchMock.mockResolvedValue(new Response("not JSON"));
    await expect(compareOptions(request)).rejects.toMatchObject({ kind: "malformed_response", status: 200 });
  });

  it.each([201, 202])("requires HTTP 200 rather than %s", async (status) => {
    fetchMock.mockResolvedValue(Response.json(optionComparisonResponse(), { status }));
    await expect(compareOptions(request)).rejects.toMatchObject({ kind: "malformed_response", status });
  });

  it("does not fetch an already aborted request", async () => {
    const controller = new AbortController();
    const reason = new DOMException("Superseded", "AbortError");
    controller.abort(reason);
    await expect(compareOptions(request, controller.signal)).rejects.toBe(reason);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("propagates the original fetch cancellation", async () => {
    const reason = new DOMException("Superseded", "AbortError");
    fetchMock.mockRejectedValue(reason);
    await expect(compareOptions(request, new AbortController().signal)).rejects.toBe(reason);
  });

  it.each([false, true])("discards late body data or parsing errors after cancellation (%s)", async (rejectBody) => {
    const controller = new AbortController();
    const reason = new Error("A newer pair was submitted");
    fetchMock.mockResolvedValue({
      ok: true, status: 200,
      json: () => {
        controller.abort(reason);
        return rejectBody ? Promise.reject(new SyntaxError("Interrupted body")) : Promise.resolve(optionComparisonResponse());
      },
    } as Response);
    await expect(compareOptions(request, controller.signal)).rejects.toBe(reason);
  });
});
