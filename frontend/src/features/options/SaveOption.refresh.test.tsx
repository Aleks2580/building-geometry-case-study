import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import type { QueryKey } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "../../queryClient";
import { previewRequest } from "../../test/massingFixtures";
import { optionResponse } from "../../test/optionFixtures";
import { optionKeys } from "./optionQueries";
import SaveOption from "./SaveOption";

const fetchMock = vi.fn<typeof fetch>();
const rootId = "550e8400-e29b-41d4-a716-446655440001";
const childId = "550e8400-e29b-41d4-a716-446655440002";
const inactiveRootId = "550e8400-e29b-41d4-a716-446655440003";
let client = createQueryClient();

beforeEach(() => {
  client = createQueryClient();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => client.clear());

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

function ReadObserver({ queryKey, load, label }: {
  queryKey: QueryKey;
  load: (signal: AbortSignal) => Promise<string>;
  label: string;
}) {
  const query = useQuery({ queryKey, queryFn: ({ signal }) => load(signal), staleTime: Infinity });
  return <p>{label}: {query.data ?? "Loading"}</p>;
}

async function observeSavedOptions() {
  const list = vi.fn(async () => "Original list");
  const rootTree = vi.fn(async () => "Original root tree");
  const childTree = vi.fn(async () => "Original child tree");
  const health = vi.fn(async () => "Healthy");
  render(<QueryClientProvider client={client}>
    <ReadObserver queryKey={optionKeys.list()} load={list} label="Saved roots" />
    <ReadObserver queryKey={optionKeys.tree(rootId)} load={rootTree} label="Root history" />
    <ReadObserver queryKey={optionKeys.tree(childId)} load={childTree} label="Child history" />
    <ReadObserver queryKey={["health"]} load={health} label="API" />
  </QueryClientProvider>);
  await screen.findByText("Saved roots: Original list");
  await screen.findByText("Root history: Original root tree");
  await screen.findByText("Child history: Original child tree");
  await screen.findByText("API: Healthy");
  return { list, rootTree, childTree, health };
}

function renderSave(branching = false) {
  return render(<QueryClientProvider client={client}>
    <SaveOption
      configuration={previewRequest()}
      draftChanged={false}
      parent={branching ? optionResponse(undefined, { id: childId, parent_id: rootId }) : undefined}
    />
  </QueryClientProvider>);
}

function submit(branching = false) {
  fireEvent.submit(screen.getByRole("form", { name: branching ? "Save branch option" : "Save root option" }));
}

function savedSnapshot(branching = false) {
  return optionResponse(undefined, { parent_id: branching ? childId : null });
}

function savedResponse(branching = false) {
  return Response.json(savedSnapshot(branching), { status: 201 });
}

describe("saved option query refresh", () => {
  it.each([
    { branching: false, label: "root discovery", queryKey: optionKeys.list() },
    { branching: true, label: "ancestor tree", queryKey: optionKeys.tree(rootId) },
  ])("restarts an initially pending $label read after saving", async ({ branching, label, queryKey }) => {
    const beforeSave = deferred<string>();
    const afterSave = deferred<string>();
    const load = vi.fn<(signal: AbortSignal) => Promise<string>>()
      .mockReturnValueOnce(beforeSave.promise)
      .mockReturnValueOnce(afterSave.promise);
    render(<QueryClientProvider client={client}>
      <ReadObserver queryKey={queryKey} load={load} label={label} />
    </QueryClientProvider>);
    await waitFor(() => expect(load).toHaveBeenCalledOnce());
    expect(client.getQueryData(queryKey)).toBeUndefined();
    fetchMock.mockResolvedValue(savedResponse(branching));
    renderSave(branching);

    submit(branching);

    await screen.findByText(branching ? "Branch saved" : "Root option saved");
    expect(client.getQueryData(optionKeys.detail(savedSnapshot(branching).id))).toEqual(savedSnapshot(branching));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    expect(load.mock.calls[0][0].aborted).toBe(true);
    expect(load.mock.calls[1][0].aborted).toBe(false);
    expect(fetchMock.mock.calls[0][1]?.signal).toBeUndefined();

    await act(async () => beforeSave.resolve("Before save"));

    expect(screen.getByText(`${label}: Loading`)).toBeInTheDocument();
    expect(screen.queryByText(`${label}: Before save`)).not.toBeInTheDocument();
    expect(client.getQueryData(queryKey)).toBeUndefined();
    expect(client.getQueryState(queryKey)?.isInvalidated).toBe(true);
    await act(async () => afterSave.resolve("Includes saved option"));
    await screen.findByText(`${label}: Includes saved option`);
    expect(client.getQueryData(queryKey)).toBe("Includes saved option");
    expect(client.getQueryState(queryKey)?.isInvalidated).toBe(false);
    expect(load).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("refreshes root discovery without delaying the receipt or refetching existing trees", async () => {
    const reads = await observeSavedOptions();
    const refresh = deferred<string>();
    reads.list.mockReturnValueOnce(refresh.promise);
    fetchMock.mockResolvedValue(savedResponse());
    renderSave();

    submit();

    await screen.findByText("Root option saved");
    expect(client.getQueryData(optionKeys.detail(savedSnapshot().id))).toEqual(savedSnapshot());
    expect(client.getQueryState(optionKeys.detail(savedSnapshot().id))?.isInvalidated).toBe(false);
    expect(screen.getByRole("button", { name: "Save Another Root Option" })).toBeEnabled();
    await waitFor(() => expect(reads.list).toHaveBeenCalledTimes(2));
    expect(screen.getByText("Saved roots: Original list")).toBeInTheDocument();
    expect(reads.rootTree).toHaveBeenCalledOnce();
    expect(reads.childTree).toHaveBeenCalledOnce();
    expect(reads.health).toHaveBeenCalledOnce();
    await act(async () => refresh.resolve("Includes the saved root"));
    await screen.findByText("Saved roots: Includes the saved root");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("refreshes list and cached ancestor trees after a nested child save", async () => {
    const reads = await observeSavedOptions();
    reads.list.mockResolvedValueOnce("Updated list");
    reads.rootTree.mockResolvedValueOnce("Root with nested child");
    reads.childTree.mockResolvedValueOnce("Child with descendant");
    client.setQueryData(optionKeys.tree(inactiveRootId), "Inactive tree");
    fetchMock.mockResolvedValue(savedResponse(true));
    renderSave(true);

    submit(true);

    await screen.findByText("Branch saved");
    expect(client.getQueryData(optionKeys.detail(savedSnapshot(true).id))).toEqual(savedSnapshot(true));
    await screen.findByText("Saved roots: Updated list");
    await screen.findByText("Root history: Root with nested child");
    await screen.findByText("Child history: Child with descendant");
    expect(reads.list).toHaveBeenCalledTimes(2);
    expect(reads.rootTree).toHaveBeenCalledTimes(2);
    expect(reads.childTree).toHaveBeenCalledTimes(2);
    expect(reads.health).toHaveBeenCalledOnce();
    expect(client.getQueryState(optionKeys.tree(inactiveRootId))?.isInvalidated).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([
    { branching: false, label: "root" },
    { branching: true, label: "child" },
  ])("refreshes discovery when a detached $label save completes after the editor remounts", async ({ branching }) => {
    const reads = await observeSavedOptions();
    reads.list.mockResolvedValueOnce("Saved while receipt hidden");
    const pending = deferred<Response>();
    fetchMock.mockReturnValue(pending.promise);
    const saveView = renderSave(branching);
    submit(branching);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    saveView.unmount();
    renderSave(branching);
    await act(async () => pending.resolve(savedResponse(branching)));

    await screen.findByText("Saved roots: Saved while receipt hidden");
    expect(client.getQueryData(optionKeys.detail(savedSnapshot(branching).id))).toEqual(savedSnapshot(branching));
    expect(reads.list).toHaveBeenCalledTimes(2);
    expect(reads.rootTree).toHaveBeenCalledTimes(branching ? 2 : 1);
    expect(reads.childTree).toHaveBeenCalledTimes(branching ? 2 : 1);
    expect(reads.health).toHaveBeenCalledOnce();
    expect(screen.queryByText(branching ? "Branch saved" : "Root option saved")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: branching ? "Save Branch" : "Save Option" })).toBeEnabled();
    expect(fetchMock.mock.calls[0][1]?.signal).toBeUndefined();
  });

  it("keeps discovery and trees unchanged when a save is rejected", async () => {
    const reads = await observeSavedOptions();
    fetchMock.mockResolvedValue(Response.json({ error: {
      code: "INVALID_REQUEST", message: "Review the supplied name.", details: [],
    } }, { status: 422 }));
    renderSave(true);

    submit(true);

    await screen.findByRole("alert");
    expect(client.getQueryData(optionKeys.detail(savedSnapshot(true).id))).toBeUndefined();
    expect(reads.list).toHaveBeenCalledOnce();
    expect(reads.rootTree).toHaveBeenCalledOnce();
    expect(reads.childTree).toHaveBeenCalledOnce();
    expect(reads.health).toHaveBeenCalledOnce();
    expect(client.getQueryState(optionKeys.list())?.isInvalidated).toBe(false);
    expect(client.getQueryState(optionKeys.tree(rootId))?.isInvalidated).toBe(false);
  });
});
