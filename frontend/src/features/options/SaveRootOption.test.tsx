import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "../../queryClient";
import { previewRequest } from "../../test/massingFixtures";
import { optionResponse } from "../../test/optionFixtures";
import SaveRootOption from "./SaveRootOption";

const fetchMock = vi.fn<typeof fetch>();
let client = createQueryClient();

beforeEach(() => {
  client = createQueryClient();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  client.clear();
  vi.useRealTimers();
});

function component(draftChanged = false) {
  return (
    <QueryClientProvider client={client}>
      <SaveRootOption configuration={previewRequest()} draftChanged={draftChanged} />
    </QueryClientProvider>
  );
}

function submit() {
  fireEvent.submit(screen.getByRole("form", { name: "Save root option" }));
}

function name(value: string) {
  fireEvent.change(screen.getByRole("textbox", { name: "Option name (optional)" }), { target: { value } });
}

function savedResponse() {
  return Response.json(optionResponse(), { status: 201 });
}

function requestBody(index = 0): Record<string, unknown> {
  return JSON.parse(String(fetchMock.mock.calls[index][1]?.body)) as Record<string, unknown>;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

describe("SaveRootOption", () => {
  it("waits for an explicit save and leaves an empty optional name out of the request", async () => {
    fetchMock.mockResolvedValue(Response.json(optionResponse(undefined, { name: null }), { status: 201 }));
    render(component());

    expect(screen.getByRole("button", { name: "Save Option" })).toBeEnabled();
    expect(fetchMock).not.toHaveBeenCalled();
    submit();

    await screen.findByText("Root option saved");
    const receipt = screen.getByRole("status");
    expect(receipt).toHaveTextContent("Root option saved");
    expect(receipt).toHaveTextContent("Unnamed option");
    expect(receipt).toHaveTextContent(optionResponse().id);
    expect(receipt).toHaveTextContent("None (root option)");
    expect(requestBody()).not.toHaveProperty("name");
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:8000/api/v1/options");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("trims a valid name and shows the authoritative returned name and identifier", async () => {
    const configuration = previewRequest();
    const original = structuredClone(configuration);
    const saved = optionResponse(undefined, { name: "Saved by backend" });
    fetchMock.mockResolvedValue(Response.json(saved, { status: 201 }));
    render(<QueryClientProvider client={client}>
      <SaveRootOption configuration={configuration} draftChanged={false} />
    </QueryClientProvider>);
    name("  Rectangle study  ");
    submit();

    await screen.findByText("Root option saved");
    const receipt = screen.getByRole("status");
    expect(requestBody()).toMatchObject({ ...configuration, name: "Rectangle study" });
    expect(receipt).toHaveTextContent("Saved by backend");
    expect(receipt).toHaveTextContent(saved.id);
    expect(configuration).toEqual(original);
    expect(client.getQueryCache().getAll()).toHaveLength(0);
    name("A later name draft");
    expect(receipt).toHaveTextContent("Saved by backend");
  });

  it.each([
    ["   ", "Enter a name or leave the field empty."],
    ["x".repeat(201), "Use 200 characters or fewer."],
    ["Invalid\u0000name", "The name cannot contain a NUL character."],
  ])("rejects an invalid supplied name without saving", async (value, message) => {
    render(component());
    name(value);
    submit();

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    const input = screen.getByRole("textbox", { name: "Option name (optional)" });
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription(new RegExp(message.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts 200 Unicode characters and allows correcting a name error", async () => {
    fetchMock.mockResolvedValue(savedResponse());
    render(component());
    name("x".repeat(201));
    submit();
    expect(await screen.findByRole("alert")).toBeInTheDocument();

    name("🏙".repeat(200));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    submit();

    await screen.findByText("Root option saved");
    expect(requestBody().name).toBe("🏙".repeat(200));
  });

  it("blocks both button and direct form submission when the configuration draft has changed", async () => {
    fetchMock.mockResolvedValue(savedResponse());
    const view = render(component(true));

    expect(screen.getByRole("button", { name: "Save Option" })).toBeDisabled();
    expect(screen.getByText("Generate Preview for the current draft before saving.")).toBeInTheDocument();
    submit();
    expect(fetchMock).not.toHaveBeenCalled();

    view.rerender(component());
    expect(screen.getByRole("button", { name: "Save Option" })).toBeEnabled();
    submit();

    await screen.findByText("Root option saved");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("prevents duplicate submissions and editing the submitted name while saving", async () => {
    const pending = deferred<Response>();
    fetchMock.mockReturnValue(pending.promise);
    render(component());
    name("First name");

    act(() => {
      submit();
      submit();
    });

    expect(await screen.findByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "Option name (optional)" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Saving this submitted preview");
    expect(screen.getByRole("status")).toHaveTextContent("does not cancel the save");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestBody().name).toBe("First name");

    await act(async () => pending.resolve(savedResponse()));
    expect(await screen.findByRole("button", { name: "Save Another Root Option" })).toBeEnabled();
  });

  it("retains a saved receipt while the configuration draft changes", async () => {
    fetchMock.mockResolvedValue(savedResponse());
    const view = render(component());
    submit();
    await screen.findByText("Root option saved");

    view.rerender(component(true));

    expect(screen.getByRole("status")).toHaveTextContent(optionResponse().id);
    expect(screen.getByRole("status")).toHaveTextContent("This receipt belongs to the generated preview.");
    expect(screen.getByRole("button", { name: "Save Another Root Option" })).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("creates a second root only after another explicit submission", async () => {
    const secondId = "550e8400-e29b-41d4-a716-446655440001";
    fetchMock.mockResolvedValueOnce(savedResponse())
      .mockResolvedValueOnce(Response.json(optionResponse(undefined, { id: secondId }), { status: 201 }));
    render(component());
    submit();
    await screen.findByText("Root option saved");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Each save creates a new option/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save Another Root Option" }));

    await screen.findByText(secondId);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestBody(1)).toEqual(requestBody(0));
  });

  it("shows HTTP validation details and allows an explicit corrected submission", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: {
      code: "INVALID_REQUEST",
      message: "Request validation failed.",
      details: [{ path: "name", message: "The option name is invalid." }],
    } }, { status: 422 })).mockResolvedValueOnce(savedResponse());
    render(component());
    submit();

    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent("Save request failed");
    expect(error).toHaveTextContent("Request validation failed.");
    expect(error).toHaveTextContent("name: The option name is invalid.");
    expect(within(error).queryByText(/may have been saved/)).not.toBeInTheDocument();
    expect(screen.queryByText("Root option saved")).not.toBeInTheDocument();
    name("Corrected name");
    submit();

    await screen.findByText("Root option saved");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each(["network", "malformed", "server"] as const)(
    "warns that the outcome is uncertain after a %s failure without retrying", async (failure) => {
      if (failure === "network") fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
      else if (failure === "malformed") fetchMock.mockResolvedValue(Response.json({}, { status: 201 }));
      else fetchMock.mockResolvedValue(new Response("Unavailable", { status: 503 }));
      render(component());
      submit();

      const error = await screen.findByRole("alert");
      expect(error).toHaveTextContent("Save outcome unknown");
      expect(error).toHaveTextContent("The option may have been saved.");
      expect(error).toHaveTextContent("may create a duplicate");
      expect(screen.queryByText("Root option saved")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Save Option" })).toBeEnabled();
      vi.useFakeTimers();
      await act(async () => vi.advanceTimersByTimeAsync(30_000));
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it("does not cancel an accepted save or display its late receipt after unmounting", async () => {
    const pending = deferred<Response>();
    fetchMock.mockReturnValue(pending.promise);
    const view = render(component());
    submit();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    view.unmount();
    expect(fetchMock.mock.calls[0][1]?.signal).toBeUndefined();
    await act(async () => pending.resolve(savedResponse()));

    expect(screen.queryByText("Root option saved")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
