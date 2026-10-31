import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MassingWorkspace from "./MassingWorkspace";
import type { FeasibilityStatus } from "../../api/contracts";
import { createQueryClient } from "../../queryClient";
import { previewResponse } from "../../test/massingFixtures";

const fetchMock = vi.fn<typeof fetch>();
let client = createQueryClient();

beforeEach(() => {
  client = createQueryClient();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => client.clear());

function renderWorkspace() {
  return render(<QueryClientProvider client={client}><MassingWorkspace /></QueryClientProvider>);
}

function submit() {
  fireEvent.click(screen.getByRole("button", { name: "Generate Preview" }));
}

function change(label: RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function metric(label: string) {
  const term = screen.getByText(label, { selector: "dt" });
  return term.parentElement?.querySelector("dd");
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("MassingWorkspace", () => {
  it("waits for an explicit action, then submits the initial configuration and displays backend metrics", async () => {
    const pending = deferred<Response>();
    fetchMock.mockReturnValue(pending.promise);
    renderWorkspace();

    expect(screen.getByText(/No preview yet/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    submit();
    expect(await screen.findByText("Generating preview…")).toBeInTheDocument();
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:8000/api/v1/massing/preview");
    expect(options?.method).toBe("POST");
    expect(JSON.parse(String(options?.body))).toMatchObject({
      hard_constraints: { setback_m: 3, floor_to_floor_m: 3.5, max_floors: 6, max_height_m: null },
      preferences: { preferred_floor_count: null, preferred_footprint_area_m2: null },
      targets: { gfa_target_m2: null },
    });
    await act(async () => pending.resolve(Response.json(previewResponse())));

    expect(await screen.findByRole("heading", { name: "Feasible" })).toBeInTheDocument();
    expect(metric("Footprint area")).toHaveTextContent("646 m²");
    expect(metric("Floor count")).toHaveTextContent("6");
    expect(metric("Height")).toHaveTextContent("21 m");
    expect(metric("GFA")).toHaveTextContent("3,876 m²");
    expect(screen.queryByText("Generating preview…")).not.toBeInTheDocument();
  });

  it.each([
    ["feasible", "Feasible", false],
    ["feasible_target_unmet", "Feasible — GFA target unmet", false],
    ["infeasible", "Infeasible", true],
    ["generation_failed", "Generation failed", true],
  ] satisfies [FeasibilityStatus, string, boolean][])(
    "displays the %s domain status without a request error", async (status, title, emptyMetrics) => {
      const result = previewResponse();
      result.feasibility.status = status;
      if (emptyMetrics) {
        result.metrics.footprint_area_m2 = null;
        result.metrics.floor_count = null;
        result.metrics.height_m = null;
        result.metrics.gfa_m2 = null;
      }
      fetchMock.mockResolvedValue(Response.json(result));
      renderWorkspace();
      submit();

      expect(await screen.findByRole("heading", { name: title })).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      if (emptyMetrics) {
        expect(screen.getAllByText("Not available")).toHaveLength(4);
        expect(metric("GFA")).not.toHaveTextContent("0");
      }
    },
  );

  it("shows backend validation details, including coordinate and section paths", async () => {
    fetchMock.mockResolvedValue(Response.json({ error: {
      code: "INVALID_SITE_GEOMETRY",
      message: "Request validation failed.",
      details: [
        { path: "site.coordinates[0]", message: "Ring self-intersection." },
        { path: "preferences", message: "Preference exceeds permitted floor count." },
      ],
    } }, { status: 422 }));
    renderWorkspace();
    submit();

    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent("Request validation failed.");
    expect(error).toHaveTextContent("site.coordinates[0]: Ring self-intersection.");
    expect(error).toHaveTextContent("preferences: Preference exceeds permitted floor count.");
    expect(screen.queryByText("Not available")).not.toBeInTheDocument();
  });

  it("does not display small positive backend metrics as zero", async () => {
    const result = previewResponse();
    result.metrics.footprint_area_m2 = 0.001;
    result.metrics.gfa_m2 = 0.006;
    fetchMock.mockResolvedValue(Response.json(result));
    renderWorkspace();
    submit();

    await screen.findByRole("heading", { name: "Feasible" });
    expect(metric("Footprint area")).toHaveTextContent("<0.01 m²");
    expect(metric("GFA")).toHaveTextContent("<0.01 m²");
  });

  it("shows a network error and retries only on the next explicit submission", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(Response.json(previewResponse()));
    renderWorkspace();
    submit();

    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to reach the massing API.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    submit();
    expect(await screen.findByRole("heading", { name: "Feasible" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("shows malformed successful responses as request failures", async () => {
    fetchMock.mockResolvedValue(Response.json({ metrics: {} }));
    renderWorkspace();
    submit();

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid massing preview response.");
  });

  it("keeps edits separate from the displayed result, including invalid drafts and restoring submitted values", async () => {
    fetchMock.mockResolvedValue(Response.json(previewResponse()));
    renderWorkspace();
    submit();
    await screen.findByRole("heading", { name: "Feasible" });
    change(/Maximum floor count/, "2");

    expect(screen.getByText(/Draft inputs have changed/)).toBeInTheDocument();
    expect(metric("Floor count")).toHaveTextContent("6");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    change(/Site Polygon JSON/, "{");
    submit();
    expect(await screen.findByText("Enter valid Polygon JSON.")).toBeInTheDocument();
    expect(metric("Floor count")).toHaveTextContent("6");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    change(/Site Polygon JSON/, JSON.stringify(previewResponse().site, null, 2));
    change(/Maximum floor count/, "6");
    expect(screen.queryByText(/Draft inputs have changed/)).not.toBeInTheDocument();
  });

  it("does not let edits during a request mutate its submitted inputs or its response", async () => {
    const pending = deferred<Response>();
    fetchMock.mockReturnValue(pending.promise);
    renderWorkspace();
    submit();
    await screen.findByText("Generating preview…");
    change(/Maximum floor count/, "2");
    await act(async () => pending.resolve(Response.json(previewResponse())));

    await screen.findByRole("heading", { name: "Feasible" });
    expect(metric("Floor count")).toHaveTextContent("6");
    expect(screen.getByLabelText(/Maximum floor count/)).toHaveValue("2");
    expect(screen.getByText(/Draft inputs have changed/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("cancels superseded requests and ignores late responses even when fetch ignores the signal", async () => {
    const first = deferred<Response>();
    const second = previewResponse();
    second.metrics.floor_count = 2;
    second.metrics.height_m = 7;
    second.metrics.gfa_m2 = 1292;
    fetchMock.mockReturnValueOnce(first.promise).mockResolvedValueOnce(Response.json(second));
    renderWorkspace();
    submit();
    await screen.findByText("Generating preview…");
    const firstSignal = fetchMock.mock.calls[0][1]?.signal;
    change(/Maximum floor count/, "2");
    submit();

    await screen.findByRole("heading", { name: "Feasible" });
    expect(firstSignal?.aborted).toBe(true);
    expect(metric("Floor count")).toHaveTextContent("2");
    await act(async () => first.resolve(Response.json(previewResponse())));
    expect(metric("Floor count")).toHaveTextContent("2");
    expect(metric("GFA")).toHaveTextContent("1,292 m²");
    expect(screen.queryByText(/Draft inputs have changed/)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("ignores a late rejection from a superseded request", async () => {
    const first = deferred<Response>();
    fetchMock.mockReturnValueOnce(first.promise).mockResolvedValueOnce(Response.json(previewResponse()));
    renderWorkspace();
    submit();
    await screen.findByText("Generating preview…");
    submit();
    await screen.findByRole("heading", { name: "Feasible" });
    await act(async () => first.reject(new TypeError("Old request failed")));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(metric("Floor count")).toHaveTextContent("6");
  });

  it("cancels the pending request when the workspace unmounts", async () => {
    fetchMock.mockReturnValue(new Promise<Response>(() => {}));
    const view = renderWorkspace();
    submit();
    await screen.findByText("Generating preview…");
    const signal = fetchMock.mock.calls[0][1]?.signal;
    view.unmount();

    expect(signal?.aborted).toBe(true);
  });

  it("makes a new request after remounting with the same Query cache and inputs", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(Response.json(previewResponse())));
    const first = renderWorkspace();
    submit();
    await screen.findByRole("heading", { name: "Feasible" });
    first.unmount();
    renderWorkspace();
    submit();

    await screen.findByRole("heading", { name: "Feasible" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("clears previous metrics for a new submission and does not show them after its error", async () => {
    const pending = deferred<Response>();
    fetchMock.mockResolvedValueOnce(Response.json(previewResponse())).mockReturnValueOnce(pending.promise);
    renderWorkspace();
    submit();
    await screen.findByRole("heading", { name: "Feasible" });
    change(/Maximum floor count/, "2");
    submit();
    await screen.findByText("Generating preview…");

    expect(screen.queryByText("Footprint area", { selector: "dt" })).not.toBeInTheDocument();
    await act(async () => pending.resolve(new Response("Unavailable", { status: 503 })));
    expect(await screen.findByRole("alert")).toHaveTextContent("HTTP 503");
    expect(screen.queryByText("Footprint area", { selector: "dt" })).not.toBeInTheDocument();
  });

  it("submits zero targets and Polygon holes through the real API client", async () => {
    fetchMock.mockResolvedValue(Response.json(previewResponse()));
    renderWorkspace();
    const site = previewResponse().site;
    site.coordinates.push([[10, 10], [15, 10], [15, 15], [10, 15], [10, 10]]);
    change(/Site Polygon JSON/, JSON.stringify(site));
    change(/Setback \(m\)/, "0");
    change(/GFA target \(m²\)/, "0");
    submit();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      site, hard_constraints: { setback_m: 0 }, targets: { gfa_target_m2: 0 },
    });
    await screen.findByRole("heading", { name: "Feasible" });
    expect(within(screen.getByRole("form", { name: "Massing configuration" })).queryByRole("alert"))
      .not.toBeInTheDocument();
  });
});
