import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { createQueryClient } from "./queryClient";
import { optionResponse } from "./test/optionFixtures";
import { previewResponse } from "./test/massingFixtures";

const fetchMock = vi.fn<typeof fetch>();
const healthMock = vi.fn<typeof fetch>();
let client = createQueryClient();

beforeEach(() => {
  client = createQueryClient();
  fetchMock.mockReset();
  healthMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(async (input, init) => String(input).endsWith("/health")
    ? healthMock(input, init) : Response.json([]));
});

afterEach(() => {
  cleanup();
  client.clear();
});

function renderApp() {
  return render(<QueryClientProvider client={client}><App /></QueryClientProvider>);
}

function navigate(section: "Workspace" | "Saved Options" | "Compare") {
  fireEvent.click(within(screen.getByRole("navigation", { name: "Main navigation" }))
    .getByRole("button", { name: section }));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("App", () => {
  it("shows loading and then the successful backend health status", async () => {
    healthMock.mockResolvedValue(Response.json({ status: "healthy" }));

    renderApp();

    expect(screen.getByText("checking…")).toBeInTheDocument();
    expect(await screen.findByText("healthy")).toBeInTheDocument();
    expect(screen.queryByText("checking…")).not.toBeInTheDocument();
  });

  it("displays HTTP error details", async () => {
    healthMock.mockResolvedValue(new Response("Unavailable", { status: 503 }));

    renderApp();

    expect(
      await screen.findByText("unreachable (health check failed: 503)"),
    ).toBeInTheDocument();
  });

  it("displays network error details", async () => {
    healthMock.mockRejectedValue(new TypeError("Failed to fetch"));

    renderApp();

    expect(await screen.findByText("unreachable (Failed to fetch)")).toBeInTheDocument();
  });

  it("displays an error for an invalid health response", async () => {
    healthMock.mockResolvedValue(Response.json({ status: 42 }));

    renderApp();

    expect(
      await screen.findByText("unreachable (invalid health response)"),
    ).toBeInTheDocument();
  });

  it("displays rejected values that are not Error instances", async () => {
    healthMock.mockRejectedValue("offline");

    renderApp();

    expect(await screen.findByText("unreachable (offline)")).toBeInTheDocument();
  });

  it("shows only the active section and moves focus to its heading", async () => {
    healthMock.mockResolvedValue(Response.json({ status: "healthy" }));
    renderApp();
    const navigation = within(screen.getByRole("navigation", { name: "Main navigation" }));
    expect(navigation.getAllByRole("button")).toHaveLength(3);
    expect(navigation.getByRole("button", { name: "Workspace" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("textbox", { name: "Width (m)" })).toBeVisible();
    expect(screen.queryByRole("region", { name: "Saved options" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Compare saved options" })).not.toBeInTheDocument();

    for (const section of ["Saved Options", "Compare", "Workspace"] as const) {
      navigate(section);
      await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: { Workspace: "Explore a building massing", "Saved Options": "Your saved options", Compare: "Compare design options" }[section] })).toHaveFocus());
      expect(navigation.getByRole("button", { name: section })).toHaveAttribute("aria-current", "page");
      expect(navigation.getAllByRole("button").filter((button) => button.hasAttribute("aria-current"))).toHaveLength(1);
      expect(screen.queryByRole("textbox", { name: "Width (m)" }) !== null).toBe(section === "Workspace");
      expect(screen.queryByRole("region", { name: "Saved options" }) !== null).toBe(section === "Saved Options");
      expect(screen.queryByRole("region", { name: "Compare saved options" }) !== null).toBe(section === "Compare");
    }
  });

  it("browses persisted summaries without changing an unsaved editing draft or computing geometry", async () => {
    const option = optionResponse();
    const summary = { ...option, metrics: option.result.metrics };
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/health")) return Response.json({ status: "healthy" });
      return Response.json(url.includes("/tree?") ? { ...summary, children: [] } : [summary]);
    });
    renderApp();
    const width = screen.getByRole("textbox", { name: "Width (m)" });
    fireEvent.change(width, { target: { value: "55" } });
    navigate("Saved Options");
    expect(screen.getByRole("region", { name: "Saved options" })).toHaveAttribute("id", "saved-options");
    const roots = within(screen.getByRole("region", { name: "Root options" }));
    fireEvent.click(await roots.findByRole("button", { name: /Rectangle study/ }));
    expect(await screen.findByRole("region", { name: "Selected option summary" })).toHaveTextContent(option.id);
    navigate("Workspace");
    expect(width).toHaveValue("55");
    expect(screen.getByRole("textbox", { name: "Width (m)" })).toBe(width);
    expect(fetchMock.mock.calls.every(([, init]) => init?.method === undefined)).toBe(true);
    expect(screen.queryByRole("button", { name: "Save Option" })).not.toBeInTheDocument();
  });

  it("opens a selected child explicitly and protects the draft when returning to Workspace", async () => {
    const root = optionResponse();
    const child = optionResponse(undefined, {
      id: "550e8400-e29b-41d4-a716-446655440001",
      parent_id: root.id,
      name: "Persisted child",
    });
    const rootSummary = { ...root, metrics: root.result.metrics };
    const childSummary = { ...child, metrics: child.result.metrics };
    const childUrl = `http://localhost:8000/api/v1/options/${child.id}`;
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/health")) return Response.json({ status: "healthy" });
      if (url === childUrl) return Response.json(child);
      if (url.includes("/tree?")) return Response.json({ ...rootSummary, children: [{ ...childSummary, children: [] }] });
      return Response.json([childSummary, rootSummary]);
    });
    renderApp();
    const width = screen.getByRole("textbox", { name: "Width (m)" });
    fireEvent.change(width, { target: { value: "57" } });
    navigate("Saved Options");
    const roots = within(screen.getByRole("region", { name: "Root options" }));
    fireEvent.click(await roots.findByRole("button", { name: /Rectangle study/ }));
    const history = within(await screen.findByRole("list", { name: "Saved decision tree" }));
    fireEvent.click(history.getByRole("button", { name: /Persisted child/ }));
    expect(screen.getByRole("region", { name: "Selected option summary" })).toHaveTextContent(child.id);
    expect(fetchMock.mock.calls.some(([url]) => String(url) === childUrl)).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Open in Workspace" }));

    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => String(url) === childUrl)).toHaveLength(1));
    expect(await screen.findByRole("region", { name: "Replace workspace" })).toBeVisible();
    expect(screen.getByRole("heading", { level: 1, name: "Explore a building massing" })).toBeVisible();
    expect(width).toHaveValue("57");
    fireEvent.click(screen.getByRole("button", { name: "Keep Editing" }));
    expect(screen.queryByRole("region", { name: "Replace workspace" })).not.toBeInTheDocument();
    expect(width).toHaveValue("57");
    expect(width).toHaveFocus();

    navigate("Saved Options");
    expect(screen.getByRole("region", { name: "Selected option summary" })).toHaveTextContent(child.id);
    fireEvent.click(screen.getByRole("button", { name: "Open in Workspace" }));
    fireEvent.click(await screen.findByRole("button", { name: "Discard Draft and Open" }));
    expect(await screen.findByRole("heading", { name: "Saved option snapshot" })).toBeVisible();
    expect(screen.queryByRole("textbox", { name: "Width (m)" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Saved configuration" })).toBeVisible();
    expect(fetchMock.mock.calls.every(([, init]) => init?.method === undefined)).toBe(true);
    expect(screen.queryByRole("button", { name: "Save Option" })).not.toBeInTheDocument();
  });

  it("keeps a pending preview attached to its draft across section navigation", async () => {
    const pending = deferred<Response>();
    let previewSignal: AbortSignal | null | undefined;
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/health")) return Response.json({ status: "healthy" });
      if (url.endsWith("/massing/preview")) {
        previewSignal = init?.signal;
        return pending.promise;
      }
      return Response.json([]);
    });
    renderApp();
    const width = screen.getByRole("textbox", { name: "Width (m)" });
    fireEvent.click(screen.getByRole("button", { name: "Generate Preview" }));
    expect(await screen.findByText("Generating preview…")).toBeVisible();
    navigate("Saved Options");
    navigate("Compare");
    expect(previewSignal?.aborted).toBe(false);
    await act(async () => pending.resolve(Response.json(previewResponse())));
    navigate("Workspace");
    expect(await screen.findByRole("button", { name: "Save Option" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Width (m)" })).toBe(width);
    expect(screen.getByRole("img", { name: "Site plan" })).toBeVisible();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });

  it("keeps a late saved-option confirmation from moving focus into a hidden workspace", async () => {
    const option = optionResponse();
    const summary = { ...option, metrics: option.result.metrics };
    const pending = deferred<Response>();
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/health")) return Response.json({ status: "healthy" });
      if (url.endsWith(`/${option.id}`)) return pending.promise;
      return Response.json(url.includes("/tree?") ? { ...summary, children: [] } : [summary]);
    });
    renderApp();
    fireEvent.change(screen.getByRole("textbox", { name: "Width (m)" }), { target: { value: "" } });
    navigate("Saved Options");
    fireEvent.click(await within(screen.getByRole("region", { name: "Root options" }))
      .findByRole("button", { name: /Rectangle study/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Open in Workspace" }));
    expect(await screen.findByText("Loading saved option…")).toBeVisible();
    navigate("Compare");
    const compareHeading = screen.getByRole("heading", { level: 1, name: "Compare design options" });
    await act(async () => pending.resolve(Response.json(option)));
    await waitFor(() => expect(screen.getByRole("region", { name: "Replace workspace", hidden: true })).toBeInTheDocument());
    expect(compareHeading).toHaveFocus();
    expect(screen.queryByRole("region", { name: "Replace workspace" })).not.toBeInTheDocument();
    navigate("Workspace");
    expect(screen.getByRole("region", { name: "Replace workspace" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Width (m)" })).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "Keep Editing" }));
    expect(screen.getByRole("textbox", { name: "Width (m)" })).toHaveFocus();
  });
});
