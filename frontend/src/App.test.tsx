import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { createQueryClient } from "./queryClient";
import { optionResponse } from "./test/optionFixtures";

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
    expect(screen.getByRole("link", { name: "Browse saved options" })).toHaveAttribute("href", "#saved-options");
    expect(screen.getByRole("region", { name: "Saved options" })).toHaveAttribute("id", "saved-options");
    fireEvent.change(width, { target: { value: "55" } });
    const roots = within(screen.getByRole("region", { name: "Root options" }));
    fireEvent.click(await roots.findByRole("button", { name: /Rectangle study/ }));
    expect(await screen.findByRole("region", { name: "Selected option summary" })).toHaveTextContent(option.id);
    expect(width).toHaveValue("55");
    expect(fetchMock.mock.calls.every(([, init]) => init?.method === undefined)).toBe(true);
    expect(screen.queryByRole("button", { name: "Save Option" })).not.toBeInTheDocument();
  });
});
