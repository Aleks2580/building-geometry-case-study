import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OptionResponse, OptionTree } from "../../api/contracts";
import { createQueryClient } from "../../queryClient";
import { optionComparisonResponse } from "../../test/comparisonFixtures";
import { optionResponse } from "../../test/optionFixtures";
import SavedOptionsExplorer from "./SavedOptionsExplorer";

const fetchMock = vi.fn<typeof fetch>();
let client = createQueryClient();
const root = optionResponse();
const child = optionResponse(undefined, { id: "550e8400-e29b-41d4-a716-446655440001", parent_id: root.id, name: "Child" });
const sibling = optionResponse(undefined, { id: "550e8400-e29b-41d4-a716-446655440002", parent_id: root.id, name: "Sibling" });
const nested = optionResponse(undefined, { id: "550e8400-e29b-41d4-a716-446655440003", parent_id: child.id, name: "Nested" });
const other = optionResponse(undefined, { id: "550e8400-e29b-41d4-a716-446655440004", name: "Other root" });

function tree(option: OptionResponse, children: OptionTree[] = []): OptionTree {
  return { ...option, metrics: option.result.metrics, children };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  client = createQueryClient();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes("/tree?")) return Response.json(url.includes(other.id) ? tree(other)
      : tree(root, [tree(child, [tree(nested)]), tree(sibling)]));
    return Response.json([tree(root), tree(other)]);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => { cleanup(); client.clear(); });

function mount() {
  return render(<QueryClientProvider client={client}><SavedOptionsExplorer /></QueryClientProvider>);
}

async function selectRoot(name = "Rectangle study") {
  const roots = within(screen.getByRole("region", { name: "Root options" }));
  fireEvent.click(await roots.findByRole("button", { name: new RegExp(name) }));
  await screen.findByRole("list", { name: "Saved decision tree" });
}

function choose(name: string) {
  fireEvent.click(within(screen.getByRole("list", { name: "Saved decision tree" }))
    .getByRole("button", { name: new RegExp(`^${name} `) }));
}

function assign(side: "Left" | "Right") {
  fireEvent.click(screen.getByRole("button", { name: `Assign to ${side}` }));
}

function slot(side: "Left" | "Right") {
  return screen.getByRole("region", { name: `${side} comparison selection` });
}

describe("comparison selection in saved histories", () => {
  it("requires explicit assignment and rejects the same identity without losing either slot", async () => {
    mount();
    await selectRoot();
    expect(slot("Left")).toHaveTextContent("No option selected");
    assign("Left");
    assign("Right");
    expect(screen.getByRole("alert")).toHaveTextContent("two distinct saved options");
    expect(slot("Left")).toHaveTextContent(root.id);
    expect(slot("Right")).toHaveTextContent("No option selected");
    expect(screen.getByRole("button", { name: "Compare" })).toBeDisabled();
    choose("Child");
    assign("Right");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(slot("Right")).toHaveTextContent(child.id);
    expect(fetchMock.mock.calls.every(([, init]) => init?.method === undefined)).toBe(true);
  });

  it("keeps roots, siblings, and nested choices independent of tree navigation and supports replacing and clearing", async () => {
    mount();
    await selectRoot();
    assign("Left");
    choose("Child"); assign("Right");
    expect(slot("Left")).toHaveTextContent(root.id);
    expect(slot("Right")).toHaveTextContent(child.id);
    choose("Sibling"); assign("Left");
    expect(slot("Left")).toHaveTextContent(sibling.id);
    fireEvent.click(screen.getByRole("button", { name: `Expand branches of Child (${child.id})` }));
    choose("Nested"); assign("Right");
    expect(slot("Right")).toHaveTextContent(nested.id);
    await selectRoot("Other root");
    expect(slot("Left")).toHaveTextContent(sibling.id);
    expect(slot("Right")).toHaveTextContent(nested.id);
    assign("Left");
    expect(slot("Left")).toHaveTextContent(other.id);
    expect(screen.getByRole("region", { name: "Selected option summary" })).toHaveTextContent(other.id);
    fireEvent.click(screen.getByRole("button", { name: "Clear Right" }));
    expect(slot("Right")).toHaveTextContent("No option selected");
    expect(slot("Left")).toHaveTextContent(other.id);
    expect(fetchMock.mock.calls.every(([, init]) => init?.method === undefined)).toBe(true);
  });

  it("submits a cross-root pair in assignment order and removes its result immediately when a slot changes", async () => {
    const comparison = optionComparisonResponse();
    comparison.options = [other, nested];
    const browse = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input, init) => String(input).endsWith("/compare")
      ? Response.json(comparison) : browse(input, init));
    mount();
    await selectRoot();
    fireEvent.click(screen.getByRole("button", { name: `Expand branches of Child (${child.id})` }));
    choose("Nested"); assign("Right");
    await selectRoot("Other root"); assign("Left");
    expect(screen.queryByRole("region", { name: "Saved option comparison" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Compare" }));
    expect(await screen.findByRole("region", { name: "Saved option comparison" })).toBeInTheDocument();
    const post = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(post).toHaveLength(1);
    expect(JSON.parse(String(post[0][1]?.body))).toEqual({ option_ids: [other.id, nested.id] });
    fireEvent.click(screen.getByRole("button", { name: "Clear Left" }));
    expect(screen.queryByRole("region", { name: "Saved option comparison" })).not.toBeInTheDocument();
    expect(screen.getByText(/No submitted comparison/)).toBeInTheDocument();
    assign("Left");
    expect(screen.queryByRole("region", { name: "Saved option comparison" })).not.toBeInTheDocument();
  });

  it("aborts an old submitted pair and ignores its late response after a newer pair succeeds", async () => {
    const pending = deferred<Response>();
    const browse = fetchMock.getMockImplementation()!;
    const requests: RequestInit[] = [];
    fetchMock.mockImplementation(async (input, init) => {
      if (!String(input).endsWith("/compare")) return browse(input, init);
      requests.push(init!);
      if (requests.length === 1) return pending.promise;
      const next = optionComparisonResponse();
      next.options = [root, sibling];
      return Response.json(next);
    });
    mount(); await selectRoot(); assign("Left"); choose("Child"); assign("Right");
    fireEvent.click(screen.getByRole("button", { name: "Compare" }));
    await waitFor(() => expect(requests).toHaveLength(1));
    choose("Sibling"); assign("Right");
    expect(requests[0].signal?.aborted).toBe(true);
    expect(screen.queryByText("Loading saved option comparison…")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Compare" }));
    expect(await screen.findByRole("region", { name: "Right compared option" })).toHaveTextContent(sibling.id);
    await act(async () => pending.resolve(Response.json(optionComparisonResponse())));
    expect(screen.getByRole("region", { name: "Right compared option" })).toHaveTextContent(sibling.id);
    expect(screen.getByRole("region", { name: "Right compared option" })).not.toHaveTextContent(child.id);
  });
});
