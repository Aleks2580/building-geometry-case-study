import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import WorkspaceActionBar from "./WorkspaceActionBar";

describe("WorkspaceActionBar", () => {
  it("submits its associated form and starts a new design without submitting", () => {
    const onSubmit = vi.fn();
    const onOtherSubmit = vi.fn();
    const onNewDesign = vi.fn();
    render(<>
      <form id="configuration-test" aria-label="Configuration" onSubmit={(event) => {
        event.preventDefault();
        onSubmit(new FormData(event.currentTarget).get("setback"));
      }}>
        <label>Setback<input name="setback" defaultValue="3" /></label>
      </form>
      <form id="other-form" onSubmit={onOtherSubmit} />
      <WorkspaceActionBar mode="edit" formId="configuration-test" isGenerating={false} onNewDesign={onNewDesign} />
    </>);

    const generate = screen.getByRole("button", { name: "Generate Preview" });
    expect(generate).toHaveAttribute("form", "configuration-test");
    expect(screen.getByRole("form", { name: "Configuration" })).not.toContainElement(generate);
    fireEvent.change(screen.getByRole("textbox", { name: "Setback" }), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "New design" }));

    expect(onNewDesign).toHaveBeenCalledOnce();
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.click(generate);

    expect(onSubmit).toHaveBeenCalledExactlyOnceWith("4");
    expect(onOtherSubmit).not.toHaveBeenCalled();
    expect(onNewDesign).toHaveBeenCalledOnce();
  });

  it("allows another preview submission while generation is pending", () => {
    render(<WorkspaceActionBar mode="edit" formId="configuration-test" isGenerating onNewDesign={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Generate Preview" })).toBeEnabled();
    expect(screen.getByText("Keep editing or submit again to update the preview.")).toBeInTheDocument();
  });

  it("offers branch creation and a new design for a saved option", () => {
    const onCreateBranch = vi.fn();
    const onNewDesign = vi.fn();
    render(<WorkspaceActionBar mode="saved" onCreateBranch={onCreateBranch} onNewDesign={onNewDesign} />);

    expect(screen.getByRole("group", { name: "Workspace actions" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Generate Preview" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create Branch" }));
    expect(onCreateBranch).toHaveBeenCalledOnce();
    expect(onNewDesign).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "New design" }));

    expect(onCreateBranch).toHaveBeenCalledOnce();
    expect(onNewDesign).toHaveBeenCalledOnce();
  });
});
