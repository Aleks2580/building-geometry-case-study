import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OptionSummary, OptionTree } from "../../api/contracts";
import { createQueryClient } from "../../queryClient";
import { optionResponse } from "../../test/optionFixtures";
import SavedOptionsExplorer from "./SavedOptionsExplorer";

const fetchMock = vi.fn<typeof fetch>();
let client = createQueryClient();

function summary(index: number, parent: string | null = null): OptionSummary {
  const saved = optionResponse();
  return {
    id: `550e8400-e29b-41d4-a716-${String(index).padStart(12, "0")}`,
    parent_id: parent,
    name: `Study ${index}`,
    schema_version: saved.schema_version,
    algorithm_version: saved.algorithm_version,
    created_at: saved.created_at,
    feasibility_status: saved.feasibility_status,
    metrics: saved.result.metrics,
  };
}

const first = summary(1);
const second = summary(2);
function tree(root = first, children: OptionTree[] = []): OptionTree {
  return { ...root, children };
}

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

function mount() {
  return render(<QueryClientProvider client={client}><SavedOptionsExplorer /></QueryClientProvider>);
}

function roots() {
  return within(screen.getByRole("region", { name: "Root options" }));
}

async function selectRoot(name = "Study 1") {
  fireEvent.click(await roots().findByRole("button", { name: new RegExp(name) }));
}

function selectedSummary() {
  return screen.getByRole("region", { name: "Selected option summary" });
}

describe("SavedOptionsExplorer", () => {
  it("loads summaries on mount and establishes a final empty state only after a short page", async () => {
    const pending = deferred<Response>();
    fetchMock.mockReturnValue(pending.promise);
    mount();
    expect(screen.getByText("Loading saved options…")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:8000/api/v1/options?limit=50&offset=0", expect.objectContaining({ signal: expect.any(AbortSignal) }));
    await act(async () => pending.resolve(Response.json([])));
    expect(await screen.findByText(/No saved root options found/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more options" })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("discovers independent roots and uses only the selected backend subtree", async () => {
    const child = tree(summary(3, first.id));
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      return Response.json(url.includes("/tree?") ? tree(first, [child]) : [second, { ...child, children: undefined }, first]);
    });
    mount();
    expect(await roots().findAllByRole("button")).toHaveLength(2);
    expect(roots().getAllByRole("button").map((button) => button.textContent)).toEqual([
      expect.stringContaining("Study 2"), expect.stringContaining("Study 1"),
    ]);
    expect(screen.queryByRole("list", { name: "Saved decision tree" })).not.toBeInTheDocument();
    await selectRoot();
    const history = await screen.findByRole("list", { name: "Saved decision tree" });
    expect(history).toHaveTextContent("Study 3");
    expect(history).not.toHaveTextContent("Study 2");
    expect(selectedSummary()).toHaveTextContent(first.id);
    expect(roots().getByRole("button", { name: /Study 1/ })).toHaveAttribute("aria-pressed", "true");
    expect(fetchMock.mock.calls.every(([, init]) => init?.method === undefined)).toBe(true);
  });

  it("keeps Load More across multiple child-only pages and advances by raw records", async () => {
    const children = Array.from({ length: 100 }, (_, index) => summary(index + 10, first.id));
    fetchMock.mockResolvedValueOnce(Response.json(children.slice(0, 50)))
      .mockResolvedValueOnce(Response.json(children.slice(50)))
      .mockResolvedValueOnce(Response.json([first]));
    mount();
    expect(await screen.findByText(/No root options in the pages loaded so far/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Load more options" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole("button", { name: "Load more options" })).toBeEnabled());
    expect(screen.getByText(/No root options in the pages loaded so far/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load more options" }));
    expect(await roots().findByRole("button", { name: /Study 1/ })).toBeInTheDocument();
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "http://localhost:8000/api/v1/options?limit=50&offset=0",
      "http://localhost:8000/api/v1/options?limit=50&offset=50",
      "http://localhost:8000/api/v1/options?limit=50&offset=100",
    ]);
    expect(screen.queryByRole("button", { name: "Load more options" })).not.toBeInTheDocument();
  });

  it("deduplicates roots across shifted pages without counting filtered roots as offsets", async () => {
    fetchMock.mockResolvedValueOnce(Response.json([second, ...Array.from({ length: 49 }, (_, index) => summary(index + 10, second.id))]))
      .mockResolvedValueOnce(Response.json([second, first]));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Load more options" }));
    await roots().findByRole("button", { name: /Study 1/ });
    expect(roots().getAllByRole("button")).toHaveLength(2);
    expect(fetchMock.mock.calls[1][0]).toContain("offset=50");
  });

  it("does not automatically scan past a full page and blocks duplicate pending Load More", async () => {
    const pending = deferred<Response>();
    fetchMock.mockResolvedValueOnce(Response.json(Array.from({ length: 50 }, (_, index) => summary(index + 10, first.id))))
      .mockReturnValueOnce(pending.promise);
    mount();
    const button = await screen.findByRole("button", { name: "Load more options" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(button);
    fireEvent.click(button);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(button).toBeDisabled());
    await act(async () => pending.resolve(Response.json([])));
    expect(await screen.findByText(/No saved root options found/)).toBeInTheDocument();
  });

  it.each([
    ["HTTP", () => Response.json({ error: { code: "UNAVAILABLE", message: "Read service unavailable", details: [] } }, { status: 503 }), "Read service unavailable"],
    ["malformed", () => Response.json({ options: [] }), "Invalid saved options list response."],
    ["network", () => { throw new TypeError("offline"); }, "Unable to reach the options API."],
  ])("shows %s list failures with explicit retry", async (_kind, response, message) => {
    fetchMock.mockImplementationOnce(async () => response()).mockResolvedValueOnce(Response.json([first]));
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    fireEvent.click(screen.getByRole("button", { name: "Retry saved options" }));
    expect(await roots().findByRole("button", { name: /Study 1/ })).toBeInTheDocument();
  });

  it("keeps existing roots when loading another page fails, and retries the same offset", async () => {
    fetchMock.mockResolvedValueOnce(Response.json([first, ...Array.from({ length: 49 }, (_, index) => summary(index + 10, first.id))]))
      .mockResolvedValueOnce(new Response("Unavailable", { status: 503 }))
      .mockResolvedValueOnce(Response.json([second]));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Load more options" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load more saved options.");
    expect(roots().getByRole("button", { name: /Study 1/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load more options" }));
    await roots().findByRole("button", { name: /Study 2/ });
    expect(fetchMock.mock.calls.slice(1).map(([url]) => String(url))).toEqual([
      expect.stringContaining("offset=50"), expect.stringContaining("offset=50"),
    ]);
  });

  it.each([
    ["missing root", () => Response.json({ error: { code: "OPTION_NOT_FOUND", message: "Option not found.", details: [{ path: "root_id", message: "Unknown option" }] } }, { status: 404 }), "Option not found."],
    ["malformed tree", () => Response.json({ ...first }), "Invalid saved option tree response."],
    ["wrong root", () => Response.json(tree(second)), "Invalid saved option tree response."],
  ])("does not show a summary for a %s and can retry", async (_kind, response, message) => {
    fetchMock.mockResolvedValueOnce(Response.json([first])).mockImplementationOnce(async () => response())
      .mockResolvedValueOnce(Response.json(tree()));
    mount();
    await selectRoot();
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.queryByRole("region", { name: "Selected option summary" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry decision tree" }));
    expect(await screen.findByRole("region", { name: "Selected option summary" })).toHaveTextContent(first.id);
  });

  it("isolates out-of-order tree responses when switching roots and cancels superseded reads", async () => {
    const pendingFirst = deferred<Response>();
    const pendingSecond = deferred<Response>();
    fetchMock.mockResolvedValueOnce(Response.json([first, second]))
      .mockReturnValueOnce(pendingFirst.promise).mockReturnValueOnce(pendingSecond.promise);
    mount();
    await selectRoot();
    expect(screen.getByText("Loading decision tree…")).toBeInTheDocument();
    const firstSignal = fetchMock.mock.calls[1][1]?.signal;
    await selectRoot("Study 2");
    expect(firstSignal?.aborted).toBe(true);
    await act(async () => pendingSecond.resolve(Response.json(tree(second))));
    expect(await screen.findByRole("region", { name: "Selected option summary" })).toHaveTextContent(second.id);
    await act(async () => pendingFirst.resolve(Response.json(tree(first, [tree(summary(3, first.id))]))));
    expect(selectedSummary()).toHaveTextContent(second.id);
    expect(screen.getByRole("list", { name: "Saved decision tree" })).not.toHaveTextContent("Study 3");
  });

  it("removes the previous tree while another root is loading and resets local node selection on return", async () => {
    const pending = deferred<Response>();
    const child = tree(summary(3, first.id));
    fetchMock.mockResolvedValueOnce(Response.json([first, second])).mockResolvedValueOnce(Response.json(tree(first, [child])))
      .mockReturnValueOnce(pending.promise);
    mount();
    await selectRoot();
    const history = within(await screen.findByRole("list", { name: "Saved decision tree" }));
    fireEvent.click(history.getByRole("button", { name: /Study 3/ }));
    expect(selectedSummary()).toHaveTextContent(child.id);
    await selectRoot("Study 2");
    expect(screen.queryByRole("region", { name: "Selected option summary" })).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Saved decision tree" })).not.toBeInTheDocument();
    await selectRoot();
    expect(selectedSummary()).toHaveTextContent(first.id);
    expect(selectedSummary()).not.toHaveTextContent(child.id);
    await act(async () => pending.resolve(Response.json(tree(second))));
    expect(selectedSummary()).toHaveTextContent(first.id);
  });

  it("refreshes loaded list pages from the newest offset and refreshes the selected tree", async () => {
    let refreshed = false;
    const child = tree(summary(3, first.id));
    const firstPage = [first, ...Array.from({ length: 49 }, (_, index) => summary(index + 10, first.id))];
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/tree?")) return Response.json(tree(first, refreshed ? [child] : []));
      if (url.includes("offset=50")) return Response.json([second]);
      return Response.json(refreshed ? [summary(4), ...firstPage.slice(0, 49)] : firstPage);
    });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Load more options" }));
    await roots().findByRole("button", { name: /Study 2/ });
    await selectRoot();
    await screen.findByRole("region", { name: "Selected option summary" });
    refreshed = true;
    fireEvent.click(screen.getByRole("button", { name: "Refresh saved options" }));
    await roots().findByRole("button", { name: /Study 4/ });
    expect(await within(screen.getByRole("list", { name: "Saved decision tree" })).findByRole("button", { name: /Study 3/ })).toBeInTheDocument();
    expect(selectedSummary()).toHaveTextContent(first.id);
    expect(fetchMock.mock.calls.filter(([url]) => !String(url).includes("/tree?")).map(([url]) => new URL(String(url)).searchParams.get("offset")))
      .toEqual(["0", "50", "0", "50"]);
  });

  it("labels failed background refreshes while retaining the same root's last loaded summary", async () => {
    fetchMock.mockResolvedValueOnce(Response.json([first])).mockResolvedValueOnce(Response.json(tree()))
      .mockResolvedValue(new Response("Unavailable", { status: 503 }));
    mount();
    await selectRoot();
    await screen.findByRole("region", { name: "Selected option summary" });
    fireEvent.click(screen.getByRole("button", { name: "Refresh saved options" }));
    await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(2));
    expect(screen.getByText(/Could not refresh saved options/)).toBeInTheDocument();
    expect(screen.getByText(/Could not refresh the decision tree/)).toBeInTheDocument();
    expect(selectedSummary()).toHaveTextContent(first.id);
    expect(screen.queryByText(/No saved root options found/)).not.toBeInTheDocument();
  });

  it("restarts a pending first tree read when explicitly refreshing externally saved changes", async () => {
    const beforeRefresh = deferred<Response>();
    const afterRefresh = deferred<Response>();
    let treeReads = 0;
    fetchMock.mockImplementation(async (input) => {
      if (!String(input).includes("/tree?")) return Response.json([first]);
      treeReads += 1;
      return treeReads === 1 ? beforeRefresh.promise : afterRefresh.promise;
    });
    mount();
    await selectRoot();
    expect(screen.getByText("Loading decision tree…")).toBeInTheDocument();
    const oldSignal = fetchMock.mock.calls.find(([url]) => String(url).includes("/tree?"))?.[1]?.signal;
    fireEvent.click(screen.getByRole("button", { name: "Refresh saved options" }));
    await waitFor(() => expect(treeReads).toBe(2));
    expect(oldSignal?.aborted).toBe(true);
    await act(async () => beforeRefresh.resolve(Response.json(tree())));
    expect(screen.queryByRole("region", { name: "Selected option summary" })).not.toBeInTheDocument();
    await act(async () => afterRefresh.resolve(Response.json(tree(first, [tree(summary(3, first.id))]))));
    expect(await within(await screen.findByRole("list", { name: "Saved decision tree" })).findByRole("button", { name: /Study 3/ })).toBeInTheDocument();
  });

  it("rediscovers roots with a fresh client after remount without retaining browser selection", async () => {
    fetchMock.mockImplementation(async (input) => Response.json(String(input).includes("/tree?") ? tree() : [first]));
    const view = mount();
    await selectRoot();
    await screen.findByRole("region", { name: "Selected option summary" });
    view.unmount();
    client.clear();
    client = createQueryClient();
    mount();
    await roots().findByRole("button", { name: /Study 1/ });
    expect(screen.queryByRole("region", { name: "Selected option summary" })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/tree?"))).toHaveLength(1);
  });
});
