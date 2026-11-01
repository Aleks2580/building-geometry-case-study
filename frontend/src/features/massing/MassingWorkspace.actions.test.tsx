import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OptionResponse } from "../../api/contracts";
import { createQueryClient } from "../../queryClient";
import { previewResponse } from "../../test/massingFixtures";
import { optionResponse } from "../../test/optionFixtures";
import { optionKeys } from "../options/optionQueries";
import MassingWorkspace from "./MassingWorkspace";

const fetchMock = vi.fn<typeof fetch>();
let client = createQueryClient();

beforeEach(() => {
  client = createQueryClient();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => client.clear());

function mount(saved?: OptionResponse) {
  if (saved) client.setQueryData(optionKeys.detail(saved.id), saved);
  render(<QueryClientProvider client={client}>
    <MassingWorkspace openRequest={saved ? { optionId: saved.id, requestId: "open-saved" } : null} />
  </QueryClientProvider>);
}

function actions() {
  return within(screen.getByRole("group", { name: "Workspace actions" }));
}

function startNewDesign() {
  fireEvent.click(actions().getByRole("button", { name: "New design" }));
}

function discardDraft() {
  fireEvent.click(within(screen.getByRole("region", { name: "Replace workspace" }))
    .getByRole("button", { name: "Discard Draft and Continue" }));
}

function keepEditing() {
  fireEvent.click(within(screen.getByRole("region", { name: "Replace workspace" }))
    .getByRole("button", { name: "Keep Editing" }));
}

function generate() {
  fireEvent.click(actions().getByRole("button", { name: "Generate Preview" }));
}

function expectFreshRoot() {
  expect(screen.getByRole("heading", { name: "New root option" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Rectangle / Square" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("textbox", { name: "Width (m)" })).toHaveValue("40");
  expect(screen.getByRole("textbox", { name: "Setback (m)" })).toHaveValue("3");
  expect(screen.getByText(/No preview yet/)).toBeInTheDocument();
  expect(screen.queryByRole("textbox", { name: "Option name (optional)" })).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Root option saved" })).not.toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Replace workspace" })).not.toBeInTheDocument();
}

describe("Workspace actions", () => {
  it("protects an invalid unsent root draft and resets it only after discard", () => {
    mount();
    const width = screen.getByRole("textbox", { name: "Width (m)" });
    fireEvent.change(width, { target: { value: "invalid" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Setback (m)" }), { target: { value: "7" } });

    startNewDesign();
    keepEditing();

    expect(screen.getByRole("textbox", { name: "Width (m)" })).toBe(width);
    expect(width).toHaveValue("invalid");
    expect(screen.getByRole("textbox", { name: "Setback (m)" })).toHaveValue("7");
    expect(fetchMock).not.toHaveBeenCalled();

    startNewDesign();
    discardDraft();

    expectFreshRoot();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("retains a preview, name, and saved receipt when kept, then clears them for a new design", async () => {
    const saved = optionResponse(undefined, { name: "Saved root design" });
    fetchMock.mockResolvedValueOnce(Response.json(previewResponse()))
      .mockResolvedValueOnce(Response.json(saved, { status: 201 }))
      .mockResolvedValueOnce(Response.json(previewResponse()));
    mount();
    generate();
    await screen.findByRole("button", { name: "Save Option" });
    const name = screen.getByRole("textbox", { name: "Option name (optional)" });
    fireEvent.change(name, { target: { value: saved.name } });
    fireEvent.click(screen.getByRole("button", { name: "Save Option" }));
    const receipt = await screen.findByRole("heading", { name: "Root option saved" });
    const plan = screen.getByRole("img", { name: "Site plan" });
    fireEvent.change(name, { target: { value: "Unsent next name" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Width (m)" }), { target: { value: "" } });

    startNewDesign();
    keepEditing();

    expect(screen.getByRole("heading", { name: "Root option saved" })).toBe(receipt);
    expect(screen.getByRole("img", { name: "Site plan" })).toBe(plan);
    expect(name).toHaveValue("Unsent next name");
    expect(screen.getByRole("textbox", { name: "Width (m)" })).toHaveValue("");

    startNewDesign();
    discardDraft();

    expectFreshRoot();
    expect(screen.queryByText(saved.id)).not.toBeInTheDocument();
    generate();
    await screen.findByRole("button", { name: "Save Option" });
    expect(screen.getByRole("textbox", { name: "Option name (optional)" })).toHaveValue("");
    expect(screen.queryByRole("heading", { name: "Root option saved" })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("provides saved snapshot actions and returns a branch to an editable root site", async () => {
    const saved = optionResponse();
    mount(saved);
    await screen.findByRole("heading", { name: "Saved option snapshot" });
    expect(actions().queryByRole("button", { name: "Generate Preview" })).not.toBeInTheDocument();
    expect(actions().getByRole("button", { name: "New design" })).toBeInTheDocument();
    fireEvent.click(actions().getByRole("button", { name: "Create Branch" }));
    await screen.findByRole("heading", { name: "Branch from saved option" });
    expect(screen.getByRole("group", { name: "Inherited site (read-only)" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Setback (m)" }), { target: { value: "8" } });

    startNewDesign();
    discardDraft();

    expectFreshRoot();
    expect(screen.queryByRole("group", { name: "Inherited site (read-only)" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Option creation context" })).not.toHaveTextContent(saved.id);
    fireEvent.change(screen.getByRole("textbox", { name: "Width (m)" }), { target: { value: "52" } });
    expect(screen.getByRole("textbox", { name: "Width (m)" })).toHaveValue("52");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("cancels a replaced pending preview and ignores its late response", async () => {
    let resolve!: (response: Response) => void;
    const pending = new Promise<Response>((done) => { resolve = done; });
    fetchMock.mockReturnValueOnce(pending);
    mount();
    generate();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const signal = fetchMock.mock.calls[0][1]?.signal;
    expect(signal?.aborted).toBe(false);
    expect(screen.getByText("Generating preview…")).toBeInTheDocument();

    startNewDesign();
    discardDraft();

    expect(signal?.aborted).toBe(true);
    expectFreshRoot();
    await act(async () => resolve(Response.json(previewResponse())));
    expectFreshRoot();
    expect(screen.queryByRole("img", { name: "Site plan" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save Option" })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
