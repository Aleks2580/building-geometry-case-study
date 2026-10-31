import { MutationObserver, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "./queryClient";

let client = createQueryClient();

beforeEach(() => {
  client = createQueryClient();
});

afterEach(() => {
  cleanup();
  client.clear();
});

function wrapper({ children }: PropsWithChildren) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("QueryClient foundation", () => {
  it("shares fresh server data through the provider and isolates separate clients", async () => {
    const queryFn = vi.fn().mockResolvedValue({ value: 42 });
    const first = renderHook(() => useQuery({ queryKey: ["example"], queryFn }), { wrapper });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));

    const second = renderHook(() => useQuery({ queryKey: ["example"], queryFn }), { wrapper });

    expect(second.result.current.data).toEqual({ value: 42 });
    expect(queryFn).toHaveBeenCalledTimes(1);

    const isolatedClient = createQueryClient();
    expect(isolatedClient.getQueryData(["example"])).toBeUndefined();
    isolatedClient.clear();
  });

  it("surfaces query failures without automatic retries", async () => {
    const error = new Error("Unavailable");
    const queryFn = vi.fn().mockRejectedValue(error);

    await expect(client.fetchQuery({ queryKey: ["failed"], queryFn })).rejects.toBe(error);

    expect(queryFn).toHaveBeenCalledTimes(1);
  });

  it("does not retry a failed mutation", async () => {
    const error = new Error("Connection lost after saving");
    const mutationFn = vi.fn().mockRejectedValue(error);
    const mutation = new MutationObserver(client, { mutationFn });

    await expect(mutation.mutate(undefined)).rejects.toBe(error);

    expect(mutationFn).toHaveBeenCalledTimes(1);
  });
});
