import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "../../queryClient";
import { optionComparisonResponse } from "../../test/comparisonFixtures";
import OptionComparison from "./OptionComparison";
import type { ComparisonSelection } from "./OptionComparison";

const fetchMock = vi.fn<typeof fetch>();
let client = createQueryClient();

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  client = createQueryClient();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  client.clear();
});

function mount(left: ComparisonSelection | null = optionComparisonResponse().options[0], right: ComparisonSelection | null = optionComparisonResponse().options[1]) {
  const onClear = vi.fn();
  const component = (nextLeft: ComparisonSelection | null, nextRight: ComparisonSelection | null) => <QueryClientProvider client={client}>
    <OptionComparison key={`${nextLeft?.id.toLowerCase() ?? ""}:${nextRight?.id.toLowerCase() ?? ""}`} left={nextLeft} right={nextRight} onClear={onClear} />
  </QueryClientProvider>;
  const view = render(component(left, right));
  return { ...view, onClear, select: (nextLeft: ComparisonSelection | null, nextRight: ComparisonSelection | null) => view.rerender(component(nextLeft, nextRight)) };
}

function compare() {
  fireEvent.click(screen.getByRole("button", { name: "Compare" }));
}

describe("OptionComparison", () => {
  it("requires explicit Compare, displays selection identities, and sends only the ordered read-only POST", async () => {
    const response = optionComparisonResponse();
    fetchMock.mockResolvedValue(Response.json(response));
    mount();

    expect(screen.getByText(/No submitted comparison/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    const left = screen.getByRole("region", { name: "Left comparison selection" });
    const right = screen.getByRole("region", { name: "Right comparison selection" });
    expect(left).toHaveTextContent(response.options[0].id);
    expect(right).toHaveTextContent(response.options[1].id);
    expect(right).toHaveTextContent(response.options[0].id);
    const button = screen.getByRole("button", { name: "Compare" });
    expect(button).toHaveAttribute("type", "button");
    button.focus();
    expect(button).toHaveFocus();
    compare();

    await screen.findByRole("heading", { name: "Saved option comparison" });
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("http://localhost:8000/api/v1/options/compare", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ option_ids: response.options.map((option) => option.id) }), signal: expect.any(AbortSignal),
    });
  });

  it.each(["left", "right"] as const)("clears the %s selection through its feature callback", (side) => {
    const view = mount();
    fireEvent.click(screen.getByRole("button", { name: `Clear ${side === "left" ? "Left" : "Right"}` }));

    expect(view.onClear).toHaveBeenCalledExactlyOnceWith(side);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [null, null],
    [optionComparisonResponse().options[0], null],
    [optionComparisonResponse().options[0], { ...optionComparisonResponse().options[1], id: "invalid" }],
    [optionComparisonResponse().options[0], { ...optionComparisonResponse().options[0], id: optionComparisonResponse().options[0].id.toUpperCase() }],
  ])("does not submit incomplete, invalid or equivalent UUID choices %#", (left, right) => {
    mount(left, right);

    expect(screen.getByRole("button", { name: "Compare" })).toBeDisabled();
    if (left !== null && right !== null) expect(screen.getByRole("alert")).toHaveTextContent("two distinct saved options");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("removes a previous result as soon as the draft pair changes, before another Compare", async () => {
    const response = optionComparisonResponse();
    fetchMock.mockResolvedValue(Response.json(response));
    const view = mount();
    compare();
    await screen.findByRole("heading", { name: "Saved option comparison" });

    view.select(response.options[0], null);
    expect(screen.queryByRole("heading", { name: "Saved option comparison" })).not.toBeInTheDocument();
    expect(screen.getByText(/No submitted comparison/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("cancels a pending comparison and ignores its late body", async () => {
    const pending = deferred<Response>();
    fetchMock.mockReturnValue(pending.promise);
    mount();
    compare();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(screen.getByRole("status")).toHaveTextContent("Loading saved option comparison");
    const signal = fetchMock.mock.calls[0][1]?.signal;
    fireEvent.click(screen.getByRole("button", { name: "Cancel comparison" }));

    expect(signal?.aborted).toBe(true);
    await act(async () => pending.resolve(Response.json(optionComparisonResponse())));
    expect(screen.queryByRole("heading", { name: "Saved option comparison" })).not.toBeInTheDocument();
    expect(screen.getByText(/No submitted comparison/)).toBeInTheDocument();
  });

  it("keeps newer pair results when a superseded request completes later", async () => {
    const first = optionComparisonResponse();
    const next = optionComparisonResponse();
    next.options[1].id = "550e8400-e29b-41d4-a716-446655440002";
    next.options[1].name = "Latest selected branch";
    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(Response.json(next));
    const view = mount();
    compare();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const signal = fetchMock.mock.calls[0][1]?.signal;
    view.select(next.options[0], next.options[1]);
    expect(signal?.aborted).toBe(true);
    expect(screen.queryByRole("heading", { name: "Saved option comparison" })).not.toBeInTheDocument();
    compare();
    await screen.findByRole("heading", { name: "Right: Latest selected branch" });

    await act(async () => pending.resolve(Response.json(first)));
    expect(screen.getByRole("heading", { name: "Right: Latest selected branch" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Right: Four-floor branch" })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)))).toEqual([
      { option_ids: first.options.map((option) => option.id) },
      { option_ids: next.options.map((option) => option.id) },
    ]);
  });

  it.each([404, 422])("shows structured HTTP %i details and retries only explicitly", async (status) => {
    const response = optionComparisonResponse();
    fetchMock.mockResolvedValueOnce(Response.json({ error: {
      code: status === 404 ? "OPTION_NOT_FOUND" : "INVALID_COMPARISON", message: "Comparison selection unavailable.",
      details: [{ path: "option_ids.1", message: "Choose another saved option." }],
    } }, { status })).mockResolvedValueOnce(Response.json(response));
    mount();
    compare();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Comparison selection unavailable.");
    expect(alert).toHaveTextContent("option_ids.1");
    expect(alert).toHaveTextContent("Choose another saved option.");
    expect(alert).toHaveTextContent(response.options[0].id);
    expect(alert).toHaveTextContent(response.options[1].id);
    expect(fetchMock).toHaveBeenCalledOnce();
    fireEvent.click(within(alert).getByRole("button", { name: "Retry comparison" }));

    await screen.findByRole("heading", { name: "Saved option comparison" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["malformed", () => Promise.resolve(Response.json({ options: [] }))],
    ["network", () => Promise.reject(new TypeError("Failed to fetch"))],
  ])("shows a %s error without presenting stale comparison results", async (_name, response) => {
    fetchMock.mockImplementation(response);
    mount();
    compare();

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not compare saved options");
    expect(screen.queryByRole("heading", { name: "Saved option comparison" })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("retries the submitted pair when Compare is selected after an error", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(Response.json(optionComparisonResponse()));
    mount();
    compare();
    await screen.findByRole("alert");
    compare();

    await screen.findByRole("heading", { name: "Saved option comparison" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retains immutable pair data in Query and reuses it only after explicitly submitting that pair", async () => {
    const response = optionComparisonResponse();
    fetchMock.mockResolvedValue(Response.json(response));
    const view = mount();
    compare();
    await screen.findByRole("heading", { name: "Saved option comparison" });
    view.select(response.options[0], null);
    view.select(response.options[0], response.options[1]);
    expect(screen.queryByRole("heading", { name: "Saved option comparison" })).not.toBeInTheDocument();
    compare();

    expect(await screen.findByRole("heading", { name: "Saved option comparison" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
