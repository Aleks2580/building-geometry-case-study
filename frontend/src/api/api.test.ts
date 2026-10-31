import { beforeEach, describe, expect, it, vi } from "vitest";
import { getHealth } from "./api";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

describe("getHealth", () => {
  it("returns the health status from a successful response", async () => {
    fetchMock.mockResolvedValue(Response.json({ status: "healthy", version: "1" }));

    await expect(getHealth()).resolves.toEqual({ status: "healthy" });
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:8000/api/v1/health");
  });

  it.each(["degraded", ""])("accepts the string status %j", async (status) => {
    fetchMock.mockResolvedValue(Response.json({ status }));

    await expect(getHealth()).resolves.toEqual({ status });
  });

  it("reports HTTP errors before attempting to parse the response body", async () => {
    fetchMock.mockResolvedValue(new Response("not JSON", { status: 503 }));

    await expect(getHealth()).rejects.toThrow("health check failed: 503");
  });

  it("propagates network failures", async () => {
    const error = new TypeError("Failed to fetch");
    fetchMock.mockRejectedValue(error);

    await expect(getHealth()).rejects.toBe(error);
  });

  it("rejects malformed JSON", async () => {
    fetchMock.mockResolvedValue(new Response("not JSON"));

    await expect(getHealth()).rejects.toBeInstanceOf(SyntaxError);
  });

  it.each([
    { label: "null", payload: null },
    { label: "an array", payload: [] },
    { label: "a string", payload: "healthy" },
    { label: "a number", payload: 42 },
    { label: "a boolean", payload: true },
    { label: "a missing status", payload: {} },
    { label: "a numeric status", payload: { status: 42 } },
    { label: "a null status", payload: { status: null } },
    { label: "a boolean status", payload: { status: true } },
  ])("rejects a response containing $label", async ({ payload }) => {
    fetchMock.mockResolvedValue(Response.json(payload));

    await expect(getHealth()).rejects.toThrow("invalid health response");
  });
});
