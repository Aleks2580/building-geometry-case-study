import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { getOptionTree, listOptions } from "./api";
import { optionSummarySchema, optionTreeSchema } from "./contracts";
import type { FeasibilityStatus, OptionSummary, OptionTree } from "./contracts";
import { optionResponse } from "../test/optionFixtures";

const fetchMock = vi.fn<typeof fetch>();
const rootId = optionResponse().id;

function summary(index = 0, overrides: Partial<OptionSummary> = {}): OptionSummary {
  const saved = optionResponse();
  return {
    id: `550e8400-e29b-41d4-a716-44665544${String(index).padStart(4, "0")}`,
    parent_id: null,
    name: saved.name,
    schema_version: saved.schema_version,
    algorithm_version: saved.algorithm_version,
    feasibility_status: saved.feasibility_status,
    created_at: saved.created_at,
    metrics: saved.result.metrics,
    ...overrides,
  };
}

function tree(index = 0, children: OptionTree[] = [], overrides: Partial<OptionSummary> = {}): OptionTree {
  return { ...summary(index, overrides), children };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

describe("listOptions", () => {
  it("reads an unfiltered page of root and child summaries in backend order", async () => {
    const page = [summary(1, { parent_id: rootId }), summary(2), summary()];
    const controller = new AbortController();
    fetchMock.mockResolvedValue(Response.json(page));

    await expect(listOptions({}, controller.signal)).resolves.toEqual(page);

    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      "http://localhost:8000/api/v1/options?limit=50&offset=0", { signal: controller.signal },
    );
  });

  it("sends the raw offset and requested limit without treating child summaries as roots", async () => {
    const children = [summary(1, { parent_id: rootId }), summary(2, { parent_id: rootId })];
    fetchMock.mockResolvedValueOnce(Response.json(children)).mockResolvedValueOnce(Response.json([summary()]));

    await expect(listOptions({ limit: 2, offset: 0 })).resolves.toEqual(children);
    await expect(listOptions({ limit: 2, offset: 2 })).resolves.toEqual([summary()]);

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "http://localhost:8000/api/v1/options?limit=2&offset=0",
      "http://localhost:8000/api/v1/options?limit=2&offset=2",
    ]);
  });

  it("preserves an empty page", async () => {
    fetchMock.mockResolvedValue(Response.json([]));

    await expect(listOptions()).resolves.toEqual([]);
  });

  it.each(["feasible", "feasible_target_unmet", "infeasible", "generation_failed"] as const)(
    "retains %s status, nullable metrics and a timestamp offset", async (status: FeasibilityStatus) => {
      const saved = summary(0, {
        name: null,
        feasibility_status: status,
        created_at: "2026-11-01T12:00:00+03:00",
        metrics: {
          ...summary().metrics,
          generated_footprint_area_m2: null,
          generated_gfa_capacity_m2: null,
          footprint_area_m2: null,
          floor_count: null,
          height_m: null,
          gfa_m2: null,
          site_coverage_ratio: null,
        },
      });
      fetchMock.mockResolvedValue(Response.json([saved]));

      await expect(listOptions()).resolves.toEqual([saved]);
    },
  );

  it.each([
    null,
    {},
    { items: [] },
    [{ ...summary(), id: "invalid" }],
    [{ ...summary(), parent_id: "invalid" }],
    [{ ...summary(), created_at: "2026-11-01" }],
    [{ ...summary(), schema_version: 0 }],
    [{ ...summary(), feasibility_status: "unknown" }],
    [{ ...summary(), metrics: null }],
    [{ ...summary(), metrics: { ...summary().metrics, floor_count: 1.5 } }],
    [{ ...summary(), metrics: { ...summary().metrics, footprint_area_m2: -1 } }],
    [{ ...summary(), metrics: { ...summary().metrics, gfa_m2: undefined } }],
  ])("rejects malformed list transport data %#", async (data) => {
    fetchMock.mockResolvedValue(Response.json(data));

    await expect(listOptions()).rejects.toMatchObject({
      kind: "malformed_response", status: 200, message: "Invalid saved options list response.",
    });
  });

  it("accepts additive fields without mixing full snapshots into summaries", () => {
    const parsed = optionSummarySchema.parse({ ...summary(), future_field: "supported", result: {} });

    expect(parsed).toEqual(summary());
  });
});

describe("getOptionTree", () => {
  it("preserves siblings and nested branches in the exact backend order", async () => {
    const nested = tree(3, [], { parent_id: summary(2).id });
    const saved = tree(0, [tree(2, [nested], { parent_id: rootId }), tree(1, [], { parent_id: rootId })]);
    const controller = new AbortController();
    fetchMock.mockResolvedValue(Response.json(saved));

    await expect(getOptionTree(rootId, controller.signal)).resolves.toEqual(saved);

    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      `http://localhost:8000/api/v1/options/tree?root_id=${rootId}`, { signal: controller.signal },
    );
  });

  it("reads a leaf with an empty children array", async () => {
    fetchMock.mockResolvedValue(Response.json(tree()));

    await expect(getOptionTree(rootId)).resolves.toEqual(tree());
  });

  it("retains a selected subtree's stored parent relationship", async () => {
    const subtree = tree(1, [], { parent_id: rootId });
    fetchMock.mockResolvedValue(Response.json(subtree));

    await expect(getOptionTree(subtree.id)).resolves.toEqual(subtree);
  });

  it("parses a deeply nested recursive tree without truncation", async () => {
    let saved = tree(60, [], { parent_id: summary(59).id });
    for (let depth = 59; depth >= 0; depth -= 1) {
      saved = tree(depth, [saved], { parent_id: depth === 0 ? null : summary(depth - 1).id });
    }
    fetchMock.mockResolvedValue(Response.json(saved));

    const parsed = await getOptionTree(rootId);

    expect(parsed).toEqual(saved);
    let leaf = parsed;
    let depth = 0;
    while (leaf.children.length > 0) {
      leaf = leaf.children[0];
      depth += 1;
    }
    expect(depth).toBe(60);
    expect(leaf.id).toBe(summary(60).id);
  });

  it("validates root UUIDs before fetching and compares valid UUIDs case-insensitively", async () => {
    await expect(getOptionTree("not-a-uuid")).rejects.toBeInstanceOf(ZodError);
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValue(Response.json({ ...tree(), id: rootId.toUpperCase() }));

    await expect(getOptionTree(rootId.toUpperCase())).resolves.toMatchObject({ id: rootId.toUpperCase() });
    expect(fetchMock.mock.calls[0][0]).toBe(`http://localhost:8000/api/v1/options/tree?root_id=${rootId}`);
  });

  it("rejects a response for a different selected root", async () => {
    fetchMock.mockResolvedValue(Response.json(tree(1)));

    await expect(getOptionTree(rootId)).rejects.toMatchObject({ kind: "malformed_response", status: 200 });
  });

  it.each([
    null,
    [],
    { ...summary() },
    { ...tree(), children: null },
    { ...tree(), children: [{}] },
    { ...tree(), children: [{ ...tree(1), metrics: {} }] },
    { ...tree(), children: [{ ...tree(1), children: [{ ...summary(2) }] }] },
  ])("rejects malformed recursive tree data %#", async (data) => {
    fetchMock.mockResolvedValue(Response.json(data));

    await expect(getOptionTree(rootId)).rejects.toMatchObject({
      kind: "malformed_response", status: 200, message: "Invalid saved option tree response.",
    });
  });

  it("accepts additive fields at every tree depth", () => {
    const leaf = tree(1, [], { parent_id: rootId });

    expect(optionTreeSchema.parse({
      ...tree(), future_field: true, children: [{ ...leaf, future_field: "value" }],
    })).toEqual(tree(0, [leaf]));
  });
});

describe.each([
  ["list", () => listOptions(), []],
  ["tree", () => getOptionTree(rootId), tree()],
] as const)("options %s read failures", (_name, read, validData) => {
  it("retains structured HTTP errors including missing-root details", async () => {
    const error = {
      code: "OPTION_NOT_FOUND", message: "Option not found.",
      details: [{ path: "root_id", message: "No saved option has this identifier." }],
    };
    fetchMock.mockResolvedValue(Response.json({ error }, { status: 404 }));

    await expect(read()).rejects.toMatchObject({ kind: "http", status: 404, message: error.message, error });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each(["Unavailable", JSON.stringify({ error: { code: 42 } })])(
    "uses an HTTP fallback for an invalid error body", async (body) => {
      fetchMock.mockResolvedValue(new Response(body, { status: 503 }));

      await expect(read()).rejects.toMatchObject({
        kind: "http", status: 503, message: "Read options failed: HTTP 503", error: null,
      });
    },
  );

  it("retains network failures and never retries", async () => {
    const cause = new TypeError("Failed to fetch");
    fetchMock.mockRejectedValue(cause);

    await expect(read()).rejects.toMatchObject({
      kind: "network", status: null, message: "Unable to reach the options API.", cause,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects invalid success JSON", async () => {
    fetchMock.mockResolvedValue(new Response("not JSON"));

    await expect(read()).rejects.toMatchObject({ kind: "malformed_response", status: 200 });
  });

  it("requires HTTP 200 even if another success status contains valid data", async () => {
    fetchMock.mockResolvedValue(Response.json(validData, { status: 201 }));

    await expect(read()).rejects.toMatchObject({ kind: "malformed_response", status: 201 });
  });
});

describe.each([
  ["list", (signal: AbortSignal) => listOptions({}, signal), []],
  ["tree", (signal: AbortSignal) => getOptionTree(rootId, signal), tree()],
] as const)("options %s cancellation", (_name, read, validData) => {
  it("does not fetch an already aborted request", async () => {
    const controller = new AbortController();
    const reason = new DOMException("Superseded", "AbortError");
    controller.abort(reason);

    await expect(read(controller.signal)).rejects.toBe(reason);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("propagates an original abort rejection", async () => {
    const reason = new DOMException("Superseded", "AbortError");
    fetchMock.mockRejectedValue(reason);

    await expect(read(new AbortController().signal)).rejects.toBe(reason);
  });

  it("discards a late body even when fetch ignores the abort", async () => {
    const controller = new AbortController();
    const reason = new Error("Different root selected");
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => {
        controller.abort(reason);
        return Promise.resolve(validData);
      },
    } as Response);

    await expect(read(controller.signal)).rejects.toBe(reason);
  });

  it("preserves cancellation during body parsing", async () => {
    const controller = new AbortController();
    const reason = new Error("Request superseded");
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => {
        controller.abort(reason);
        return Promise.reject(new SyntaxError("Body interrupted"));
      },
    } as Response);

    await expect(read(controller.signal)).rejects.toBe(reason);
  });
});
