import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { optionTreeSchema } from "../../api/contracts";
import type { OptionTree } from "../../api/contracts";
import { optionResponse } from "../../test/optionFixtures";
import OptionTreeList from "./OptionTreeList";

function identifier(value: number) {
  return `550e8400-e29b-41d4-a716-${String(value).padStart(12, "0")}`;
}

function node(value: number, name: string | null, children: OptionTree[] = []): OptionTree {
  const snapshot = optionResponse(undefined, { id: identifier(value), name });
  return optionTreeSchema.parse({ ...snapshot, metrics: snapshot.result.metrics, children });
}

function hierarchy() {
  const nested = node(3, "Nested decision");
  const branch = node(2, "First branch", [{ ...nested, parent_id: identifier(2) }]);
  const sibling = node(4, "Second branch");
  return node(1, "Root study", [branch, sibling].map((child) => ({ ...child, parent_id: identifier(1) })));
}

function selectButton(item: OptionTree) {
  return screen.getByRole("button", {
    name: `${item.name ?? "Unnamed option"} ${item.id} ${item.feasibility_status.replace(/_/g, " ")}`,
  });
}

describe("OptionTreeList", () => {
  it("preserves backend sibling ordering and starts with only the root expanded", () => {
    const first = node(30, "Zebra decision");
    const second = node(20, "Alpha decision");
    const tree = node(10, "Root", [first, second]);
    render(<OptionTreeList tree={tree} selectedId={tree.id} onSelect={vi.fn()} />);

    const list = screen.getByRole("list", { name: "Saved decision tree" });
    expect(within(list).getAllByRole("button", { pressed: false })).toEqual([selectButton(first), selectButton(second)]);
    expect(selectButton(tree)).toHaveAttribute("aria-pressed", "true");
    expect(selectButton(first)).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: `Collapse branches of Root (${tree.id})` })).toHaveAttribute("aria-expanded", "true");
  });

  it("keeps expansion state through ancestor collapse without implicitly selecting nodes", () => {
    const tree = hierarchy();
    const branch = tree.children[0];
    const nested = branch.children[0];
    const onSelect = vi.fn();
    const original = structuredClone(tree);
    render(<OptionTreeList tree={tree} selectedId={tree.id} onSelect={onSelect} />);
    const expandBranch = screen.getByRole("button", { name: `Expand branches of First branch (${branch.id})` });
    const controlledId = expandBranch.getAttribute("aria-controls")!;

    expect(expandBranch).toHaveAttribute("type", "button");
    expect(expandBranch).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById(controlledId)).toHaveAttribute("hidden");
    expect(screen.queryByRole("button", { name: new RegExp(nested.id) })).not.toBeInTheDocument();
    fireEvent.click(expandBranch);
    expect(selectButton(nested)).toBeVisible();
    expect(document.getElementById(controlledId)).not.toHaveAttribute("hidden");

    fireEvent.click(screen.getByRole("button", { name: `Collapse branches of Root study (${tree.id})` }));
    expect(screen.queryByRole("button", { name: new RegExp(branch.id) })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: `Expand branches of Root study (${tree.id})` }));

    expect(screen.getByRole("button", { name: `Collapse branches of First branch (${branch.id})` })).toHaveAttribute("aria-expanded", "true");
    expect(selectButton(nested)).toBeVisible();
    expect(onSelect).not.toHaveBeenCalled();
    expect(tree).toEqual(original);
  });

  it("selects only through the native selection button and reflects the controlled selected identifier", () => {
    const tree = hierarchy();
    const branch = tree.children[0];
    const onSelect = vi.fn();
    const view = render(<OptionTreeList tree={tree} selectedId={tree.id} onSelect={onSelect} />);
    const button = selectButton(branch);
    expect(button).toHaveAttribute("type", "button");
    button.focus();
    expect(button).toHaveFocus();

    fireEvent.click(button);

    expect(onSelect).toHaveBeenCalledExactlyOnceWith(branch.id);
    expect(button).toHaveAttribute("aria-pressed", "false");
    view.rerender(<OptionTreeList tree={tree} selectedId={branch.id} onSelect={onSelect} />);
    expect(selectButton(branch)).toHaveAttribute("aria-pressed", "true");
    expect(selectButton(tree)).toHaveAttribute("aria-pressed", "false");
    expect(screen.getAllByRole("button", { pressed: true })).toHaveLength(1);
  });

  it("distinguishes repeated and unnamed options by their full UUIDs", () => {
    const first = node(2, "Same study");
    const second = node(3, "Same study");
    const unnamed = node(4, null);
    const tree = node(1, "Same study", [first, second, unnamed]);
    const onSelect = vi.fn();
    render(<OptionTreeList tree={tree} selectedId={tree.id} onSelect={onSelect} />);

    for (const item of [tree, first, second, unnamed]) {
      expect(selectButton(item)).toHaveTextContent(item.id);
    }
    expect(selectButton(unnamed)).toHaveTextContent("Unnamed option");
    fireEvent.click(selectButton(second));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(second.id);
  });

  it("allows successive expansion and explicit selection through a deeply nested history", () => {
    let tree = node(31, "Decision 30");
    const leaf = tree;
    for (let depth = 29; depth >= 0; depth -= 1) {
      tree = node(depth + 1, `Decision ${depth}`, [{ ...tree, parent_id: identifier(depth + 1) }]);
    }
    const onSelect = vi.fn();
    render(<OptionTreeList tree={tree} selectedId={tree.id} onSelect={onSelect} />);
    expect(screen.queryByRole("button", { name: new RegExp(leaf.id) })).not.toBeInTheDocument();

    for (let depth = 1; depth < 30; depth += 1) {
      const button = screen.getByLabelText(`Expand branches of Decision ${depth} (${identifier(depth + 1)})`);
      button.focus();
      expect(button).toHaveFocus();
      fireEvent.click(button);
      expect(button).toHaveAttribute("aria-expanded", "true");
    }

    expect(onSelect).not.toHaveBeenCalled();
    expect(selectButton(leaf)).toBeVisible();
    expect(screen.getAllByRole("button", { pressed: false })).toHaveLength(30);
    fireEvent.click(selectButton(leaf));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(leaf.id);
  });
});
