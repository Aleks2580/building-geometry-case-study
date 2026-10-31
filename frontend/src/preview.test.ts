import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, previewMassing } from "./api";
import type { MassingPreviewResponse } from "./api/contracts";
import { previewRequest, previewResponse } from "./test/massingFixtures";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

describe("previewMassing", () => {
  it("serializes configuration without inventing optional fields", async () => {
    const request = previewRequest();
    const response = previewResponse();
    fetchMock.mockResolvedValue(Response.json(response));

    await expect(previewMassing(request)).resolves.toEqual(response);

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:8000/api/v1/massing/preview");
    expect(options?.method).toBe("POST");
    expect(new Headers(options?.headers).get("Content-Type")).toBe("application/json");
    expect(options?.body).toBe(JSON.stringify(request));
  });

  it("preserves explicit nulls, preferences, a zero target, and the abort signal", async () => {
    const request = {
      ...previewRequest(),
      hard_constraints: {
        setback_m: 0,
        floor_to_floor_m: 3.5,
        max_floors: 6,
        max_height_m: null,
        site_coverage_ratio: null,
        max_footprint_m2: null,
      },
      preferences: { preferred_floor_count: 2, preferred_footprint_area_m2: null },
      targets: { gfa_target_m2: 0 },
    };
    const controller = new AbortController();
    fetchMock.mockResolvedValue(Response.json(previewResponse()));

    await previewMassing(request, controller.signal);

    const options = fetchMock.mock.calls[0][1];
    expect(options?.body).toBe(JSON.stringify(request));
    expect(options?.signal).toBe(controller.signal);
  });

  it("preserves a target shortfall as a successful preview", async () => {
    const response = previewResponse();
    response.targets = { gfa_target_m2: 4000 };
    response.feasibility = {
      ...response.feasibility,
      status: "feasible_target_unmet",
      target_assessment: {
        requested_m2: 4000,
        actual_m2: 3876,
        shortfall_m2: 124,
        status: "unmet",
        diagnostic_code: "TARGET_EXCEEDS_UPPER_BOUND",
      },
      diagnostics: [{
        code: "TARGET_EXCEEDS_UPPER_BOUND",
        severity: "warning",
        message: "The GFA target exceeds the hard GFA upper bound.",
        path: "targets.gfa_target_m2",
        details: { requested_m2: 4000, actual_m2: 3876, shortfall_m2: 124 },
      }],
    };
    fetchMock.mockResolvedValue(Response.json(response));

    await expect(previewMassing(previewRequest())).resolves.toEqual(response);
  });

  it.each(["infeasible", "generation_failed"] as const)(
    "returns %s with null building values and retained context",
    async (status) => {
      const response = previewResponse();
      response.generated_footprint_geometry = null;
      response.footprint_geometry = null;
      response.floor_plate_geometry = null;
      response.metrics = {
        ...response.metrics,
        generated_footprint_area_m2: null,
        generated_gfa_capacity_m2: null,
        footprint_area_m2: null,
        floor_count: null,
        height_m: null,
        gfa_m2: null,
        site_coverage_ratio: null,
      };
      response.feasibility = {
        ...response.feasibility,
        status,
        reason: status === "infeasible" ? "ZERO_PERMITTED_FLOORS" : "FOOTPRINT_NOT_GENERATED",
        hard_constraints_satisfied: status === "infeasible" ? false : null,
        target_assessment: {
          requested_m2: 0,
          actual_m2: null,
          shortfall_m2: null,
          status: "not_evaluated",
          diagnostic_code: null,
        },
      };
      if (status === "infeasible") {
        response.hard_constraints.max_height_m = 3;
        response.metrics.maximum_permitted_floor_count = 0;
        response.metrics.gfa_upper_bound_m2 = 0;
      }
      fetchMock.mockResolvedValue(Response.json(response));

      await expect(previewMassing(previewRequest())).resolves.toEqual(response);
    },
  );

  it("accepts an empty buildable result without replacing nulls with zero", async () => {
    const response = previewResponse();
    response.buildable_geometry = null;
    response.selected_buildable_geometry = null;
    response.generated_footprint_geometry = null;
    response.footprint_geometry = null;
    response.floor_plate_geometry = null;
    response.metrics = {
      ...response.metrics,
      buildable_area_m2: 0,
      selected_buildable_area_m2: 0,
      footprint_area_upper_bound_m2: 0,
      gfa_upper_bound_m2: 0,
      generated_footprint_area_m2: null,
      generated_gfa_capacity_m2: null,
      footprint_area_m2: null,
      floor_count: null,
      height_m: null,
      gfa_m2: null,
      site_coverage_ratio: null,
    };
    response.setback = { component_count: 0, retained_area_m2: 0, discarded_area_m2: 0 };
    response.feasibility = {
      ...response.feasibility,
      status: "infeasible",
      reason: "EMPTY_BUILDABLE_REGION",
      hard_constraints_satisfied: false,
      target_assessment: { ...response.feasibility.target_assessment, actual_m2: null },
    };
    fetchMock.mockResolvedValue(Response.json(response));

    await expect(previewMassing(previewRequest())).resolves.toEqual(response);
  });

  it("preserves polygon holes and complete MultiPolygon setback coordinates", async () => {
    const response = previewResponse();
    const hole: [number, number][] = [[5, 5], [5, 10], [10, 10], [10, 5], [5, 5]];
    response.site.coordinates.push(hole);
    response.buildable_geometry = {
      type: "MultiPolygon",
      coordinates: [response.site.coordinates, previewRequest().site.coordinates],
    };
    response.setback.component_count = 2;
    response.feasibility.diagnostics = [{
      code: "BUILDABLE_REGION_SPLIT",
      severity: "info",
      message: "The largest component was selected.",
      path: null,
      details: { component_count: 2, retained: true, discarded: "secondary", note: null },
    }];
    fetchMock.mockResolvedValue(Response.json(response));

    await expect(previewMassing(previewRequest())).resolves.toEqual(response);
  });

  it("preserves requested, effective, and actual footprint preference values", async () => {
    const response = previewResponse();
    response.preferences = { preferred_floor_count: null, preferred_footprint_area_m2: 700 };
    response.preference_results.footprint_area = {
      original_hard_area_upper_bound_m2: 646,
      requested_area_m2: 700,
      effective_target_m2: 646,
      actual_area_m2: 646,
      difference_m2: -54,
      effective_target_undershoot_m2: 0,
      status: "clamped",
      diagnostic_codes: ["PREFERENCE_CLAMPED_TO_HARD_CAP"],
    };
    fetchMock.mockResolvedValue(Response.json(response));

    await expect(previewMassing(previewRequest())).resolves.toEqual(response);
  });

  it("accepts additive response fields while returning the known contract", async () => {
    const response = previewResponse();
    fetchMock.mockResolvedValue(Response.json({
      ...response,
      extra_context: "future API extension",
      metrics: { ...response.metrics, extra_metric: 1 },
    }));

    await expect(previewMassing(previewRequest())).resolves.toEqual(response);
  });

  it("applies backend defaults when optional echoed configuration fields are omitted", async () => {
    const response = previewResponse();
    fetchMock.mockResolvedValue(Response.json({
      ...response,
      hard_constraints: previewRequest().hard_constraints,
      preferences: undefined,
      targets: undefined,
    }));

    await expect(previewMassing(previewRequest())).resolves.toEqual(response);
  });

  it.each([
    { label: "null", make: () => null },
    {
      label: "missing metrics",
      make: (response: MassingPreviewResponse) => ({ ...response, metrics: undefined }),
    },
    {
      label: "a numeric string",
      make: (response: MassingPreviewResponse) => ({
        ...response, metrics: { ...response.metrics, gfa_m2: "3876" },
      }),
    },
    {
      label: "an unknown feasibility status",
      make: (response: MassingPreviewResponse) => ({
        ...response, feasibility: { ...response.feasibility, status: "unknown" },
      }),
    },
    {
      label: "invalid coordinate dimensions",
      make: (response: MassingPreviewResponse) => ({
        ...response,
        footprint_geometry: {
          type: "Polygon", coordinates: [[[0, 0, 0], [1, 0], [1, 1], [0, 0, 0]]],
        },
      }),
    },
    {
      label: "MultiPolygon building geometry",
      make: (response: MassingPreviewResponse) => ({
        ...response,
        footprint_geometry: { type: "MultiPolygon", coordinates: [response.site.coordinates] },
      }),
    },
    {
      label: "a nonnullable metric set to null",
      make: (response: MassingPreviewResponse) => ({
        ...response, metrics: { ...response.metrics, site_area_m2: null },
      }),
    },
    {
      label: "a null preferences object",
      make: (response: MassingPreviewResponse) => ({ ...response, preferences: null }),
    },
    {
      label: "an unsafe integer floor count",
      make: (response: MassingPreviewResponse) => ({
        ...response,
        metrics: { ...response.metrics, floor_count: Number.MAX_SAFE_INTEGER + 1 },
      }),
    },
  ])("rejects a successful response containing $label", async ({ make }) => {
    fetchMock.mockResolvedValue(Response.json(make(previewResponse())));

    await expect(previewMassing(previewRequest())).rejects.toMatchObject({
      kind: "malformed_response",
      status: 200,
      message: "Invalid massing preview response.",
    });
  });

  it("normalizes malformed successful JSON", async () => {
    fetchMock.mockResolvedValue(new Response("not JSON"));

    const error: unknown = await previewMassing(previewRequest()).catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ kind: "malformed_response", status: 200 });
  });

  it("preserves structured API errors, field paths, and unknown future codes", async () => {
    const error = {
      code: "FUTURE_VALIDATION_CODE",
      message: "Request validation failed.",
      details: [{ path: "preferences.preferred_floor_count", message: "Exceeds the hard limit." }],
    };
    fetchMock.mockResolvedValue(Response.json({ error }, { status: 422 }));

    await expect(previewMassing(previewRequest())).rejects.toMatchObject({
      kind: "http",
      status: 422,
      message: error.message,
      error,
    });
  });

  it.each(["Internal Server Error", JSON.stringify({ error: { code: 42 } })])(
    "retains HTTP status when the error body is not a valid API envelope",
    async (body) => {
      fetchMock.mockResolvedValue(new Response(body, { status: 500 }));

      await expect(previewMassing(previewRequest())).rejects.toMatchObject({
        kind: "http",
        status: 500,
        message: "Massing preview failed: HTTP 500",
        error: null,
      });
    },
  );

  it("wraps network failures while retaining their original cause", async () => {
    const cause = new TypeError("Failed to fetch");
    fetchMock.mockRejectedValue(cause);

    await expect(previewMassing(previewRequest())).rejects.toMatchObject({
      kind: "network",
      status: null,
      message: "Unable to reach the massing API.",
      cause,
    });
  });

  it("does not start a request when already cancelled", async () => {
    const controller = new AbortController();
    const reason = new Error("Superseded by a new draft");
    controller.abort(reason);

    await expect(previewMassing(previewRequest(), controller.signal)).rejects.toBe(reason);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("propagates cancellation during fetch without wrapping it as a network error", async () => {
    const controller = new AbortController();
    const reason = new DOMException("Aborted", "AbortError");
    fetchMock.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true });
    }));
    const request = previewMassing(previewRequest(), controller.signal);
    const assertion = expect(request).rejects.toBe(reason);
    controller.abort(reason);

    await assertion;
  });

  it("preserves native AbortError rejections even without a supplied signal", async () => {
    const reason = new DOMException("Aborted", "AbortError");
    fetchMock.mockRejectedValue(reason);

    await expect(previewMassing(previewRequest())).rejects.toBe(reason);
  });

  it.each([200, 422])("propagates cancellation while reading an HTTP %i body", async (status) => {
    const controller = new AbortController();
    let startReading = () => {};
    const reading = new Promise<void>((resolve) => { startReading = resolve; });
    const response = new Response(null, { status });
    vi.spyOn(response, "json").mockImplementation(() => {
      startReading();
      return new Promise((_resolve, reject) => {
        controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true });
      });
    });
    fetchMock.mockResolvedValue(response);
    const request = previewMassing(previewRequest(), controller.signal);
    await reading;
    controller.abort();

    await expect(request).rejects.toBe(controller.signal.reason);
  });
});
