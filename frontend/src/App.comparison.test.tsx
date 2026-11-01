import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { createQueryClient } from "./queryClient";
import { optionComparisonResponse } from "./test/comparisonFixtures";
import { previewResponse } from "./test/massingFixtures";
import { optionResponse } from "./test/optionFixtures";

const fetchMock = vi.fn<typeof fetch>();
let client = createQueryClient();
const comparison = optionComparisonResponse();
const [root, child] = comparison.options;
const saved = optionResponse(undefined, { id: "550e8400-e29b-41d4-a716-446655440009", parent_id: root.id, name: "Existing branch receipt" });

beforeEach(() => {
  client = createQueryClient();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input) => {
    const url = String(input);
    if (url.endsWith("/health")) return Response.json({ status: "healthy" });
    if (url.endsWith("/compare")) return Response.json(comparison);
    if (url.endsWith("/massing/preview")) return Response.json(previewResponse());
    if (url.endsWith("/branches")) return Response.json(saved, { status: 201 });
    if (url.endsWith(`/${root.id}`)) return Response.json(root);
    if (url.includes("/tree?")) return Response.json({ ...root, metrics: root.result.metrics,
      children: [{ ...child, metrics: child.result.metrics, children: [] }] });
    return Response.json([{ ...root, metrics: root.result.metrics }]);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => { cleanup(); client.clear(); });

async function mountAndBrowse() {
  render(<QueryClientProvider client={client}><App /></QueryClientProvider>);
  navigate("Saved Options");
  const roots = within(screen.getByRole("region", { name: "Root options" }));
  fireEvent.click(await roots.findByRole("button", { name: /Rectangle study/ }));
  await screen.findByRole("list", { name: "Saved decision tree" });
}

function navigate(section: "Workspace" | "Saved Options" | "Compare") {
  fireEvent.click(within(screen.getByRole("navigation", { name: "Main navigation" }))
    .getByRole("button", { name: section }));
}

async function compareSelectedHistory() {
  navigate("Saved Options");
  fireEvent.click(screen.getByRole("button", { name: "Assign to Option 1" }));
  fireEvent.click(within(screen.getByRole("list", { name: "Saved decision tree" }))
    .getByRole("button", { name: /Four-floor branch/ }));
  fireEvent.click(screen.getByRole("button", { name: "Assign to Option 2" }));
  navigate("Compare");
  fireEvent.click(within(screen.getByRole("region", { name: "Compare saved options" })).getByRole("button", { name: "Compare" }));
  await screen.findByRole("region", { name: "Saved option comparison" });
}

describe("comparison workspace isolation", () => {
  it("preserves an invalid unsent root draft without any geometry or persistence request", async () => {
    await mountAndBrowse();
    expect(screen.queryByRole("group", { name: "Workspace actions" })).not.toBeInTheDocument();
    navigate("Workspace");
    expect(screen.getByRole("group", { name: "Workspace actions" })).toBeInTheDocument();
    const width = screen.getByRole("textbox", { name: "Width (m)" });
    fireEvent.change(width, { target: { value: "" } });
    await compareSelectedHistory();
    expect(screen.queryByRole("group", { name: "Workspace actions" })).not.toBeInTheDocument();
    const result = screen.getByRole("region", { name: "Saved option comparison" });
    navigate("Workspace");
    expect(screen.getByRole("group", { name: "Workspace actions" })).toBeInTheDocument();
    expect(width).toHaveValue("");
    expect(screen.getByRole("textbox", { name: "Width (m)" })).toBe(width);
    expect(screen.getByRole("heading", { name: "New root option" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Replace workspace" })).not.toBeInTheDocument();
    expect(screen.getByText(/No preview yet/)).toBeInTheDocument();
    navigate("Saved Options");
    expect(screen.getByRole("region", { name: "Selected option summary" })).toHaveTextContent(child.id);
    navigate("Compare");
    expect(screen.getByRole("region", { name: "Saved option comparison" })).toBe(result);
    expect(screen.getByRole("region", { name: "Option 1 comparison selection" })).toHaveTextContent(root.id);
    expect(screen.getByRole("region", { name: "Option 2 comparison selection" })).toHaveTextContent(child.id);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST").map(([url]) => String(url)))
      .toEqual(["http://localhost:8000/api/v1/options/compare"]);
  });

  it("keeps an active branch parent, preview, receipt, invalid edits, and save name while comparing", async () => {
    await mountAndBrowse();
    fireEvent.click(screen.getByRole("button", { name: "Open in Workspace" }));
    await screen.findByRole("heading", { name: "Saved option snapshot" });
    fireEvent.click(screen.getByRole("button", { name: "Create Branch" }));
    await screen.findByRole("heading", { name: "Branch from saved option" });
    fireEvent.click(screen.getByRole("button", { name: "Generate Preview" }));
    await screen.findByRole("button", { name: "Save Branch" });
    const name = screen.getByRole("textbox", { name: "Option name (optional)" });
    fireEvent.change(name, { target: { value: "Existing branch receipt" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Branch" }));
    await screen.findByRole("heading", { name: "Branch saved" });
    fireEvent.change(name, { target: { value: "Unsent sibling name" } });
    const setback = screen.getByRole("textbox", { name: "Setback (m)" });
    fireEvent.change(setback, { target: { value: "" } });
    const preview = screen.getByRole("region", { name: "Massing preview" });
    const plan = within(preview).getByRole("img", { name: "Site plan" });
    const previewData = client.getQueriesData({ queryKey: ["massing-preview"] });
    const beforeWrites = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST").length;

    await compareSelectedHistory();
    navigate("Workspace");

    expect(screen.getByRole("region", { name: "Option creation context" })).toHaveTextContent(root.id);
    expect(setback).toHaveValue("");
    expect(name).toHaveValue("Unsent sibling name");
    expect(within(preview).getByRole("heading", { name: "Branch saved" })).toBeInTheDocument();
    expect(within(preview).getByText(saved.id)).toBeInTheDocument();
    expect(within(preview).getByRole("button", { name: "Save Another Branch" })).toBeDisabled();
    expect(within(preview).getByRole("img", { name: "Site plan" })).toBe(plan);
    expect(client.getQueriesData({ queryKey: ["massing-preview"] })).toEqual(previewData);
    expect(screen.queryByRole("region", { name: "Replace workspace" })).not.toBeInTheDocument();
    const writes = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(writes).toHaveLength(beforeWrites + 1);
    expect(writes.at(-1)?.[0]).toBe("http://localhost:8000/api/v1/options/compare");
  });
});
