import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { createQueryClient } from "./queryClient";

const fetchMock = vi.fn<typeof fetch>();
let client = createQueryClient();

beforeEach(() => {
  client = createQueryClient();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
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
    fetchMock.mockResolvedValue(Response.json({ status: "healthy" }));

    renderApp();

    expect(screen.getByText("checking…")).toBeInTheDocument();
    expect(await screen.findByText("healthy")).toBeInTheDocument();
    expect(screen.queryByText("checking…")).not.toBeInTheDocument();
  });

  it("displays HTTP error details", async () => {
    fetchMock.mockResolvedValue(new Response("Unavailable", { status: 503 }));

    renderApp();

    expect(
      await screen.findByText("unreachable (health check failed: 503)"),
    ).toBeInTheDocument();
  });

  it("displays network error details", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    renderApp();

    expect(await screen.findByText("unreachable (Failed to fetch)")).toBeInTheDocument();
  });

  it("displays an error for an invalid health response", async () => {
    fetchMock.mockResolvedValue(Response.json({ status: 42 }));

    renderApp();

    expect(
      await screen.findByText("unreachable (invalid health response)"),
    ).toBeInTheDocument();
  });

  it("displays rejected values that are not Error instances", async () => {
    fetchMock.mockRejectedValue("offline");

    renderApp();

    expect(await screen.findByText("unreachable (offline)")).toBeInTheDocument();
  });
});
