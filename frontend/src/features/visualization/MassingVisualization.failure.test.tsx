import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { backendPreviewResponse } from "../../test/backendPreviewFixtures";
import MassingResult from "../massing/MassingResult";

vi.mock("./Massing3D", () => { throw new Error("3D module download failed"); });

it("isolates a rejected lazy import while preserving 2D, backend metrics and diagnostics", async () => {
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const suppressExpected = (event: ErrorEvent) => {
    if (event.message.includes("error when mocking a module")) event.preventDefault();
  };
  window.addEventListener("error", suppressExpected);
  try {
    render(<MassingResult result={backendPreviewResponse("preferred_failed")} />);
    const paths = () => [...screen.getByRole("img", { name: "Site plan" }).querySelectorAll("path")]
      .map((path) => [path.getAttribute("data-layer"), path.getAttribute("d")]);
    const plan = paths();
    fireEvent.click(screen.getByRole("button", { name: "3D Massing" }));
    expect(await screen.findByText(/3D could not be displayed/)).toHaveAttribute("role", "status");
    expect(paths()).toEqual(plan);
    expect(screen.getByRole("heading", { name: "Generation failed" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Actual massing" })).toBeInTheDocument();
    const diagnostics = screen.getByText(/^Diagnostics/, { selector: "summary" });
    if (!diagnostics.parentElement?.hasAttribute("open")) fireEvent.click(diagnostics);
    expect(screen.getByRole("region", { name: "Diagnostics" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "2D Plan" }));
    expect(screen.queryByText(/3D could not be displayed/)).not.toBeInTheDocument();
    expect(paths()).toEqual(plan);
  } finally {
    errors.mockRestore();
    window.removeEventListener("error", suppressExpected);
  }
});
