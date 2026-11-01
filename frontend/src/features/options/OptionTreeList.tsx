import { useId, useState } from "react";
import type { OptionTree } from "../../api/contracts";
import styles from "./OptionTreeList.module.css";

interface OptionTreeListProps {
  tree: OptionTree;
  selectedId: string;
  onSelect: (id: string) => void;
}

export default function OptionTreeList({ tree, selectedId, onSelect }: OptionTreeListProps) {
  const id = useId();
  const [expanded, setExpanded] = useState(() => new Set([tree.id]));

  function toggle(nodeId: string) {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }

  function node(item: OptionTree, depth: number) {
    const open = expanded.has(item.id);
    const name = item.name ?? "Unnamed option";
    const childrenId = `${id}-${item.id}`;
    return (
      <li key={item.id}>
        <div className={styles.row} style={{ paddingInlineStart: `${Math.min(depth, 4) * 0.65}rem` }}>
          {item.children.length > 0 ? <button
            className={styles.toggle}
            type="button"
            aria-expanded={open}
            aria-controls={childrenId}
            aria-label={`${open ? "Collapse" : "Expand"} branches of ${name} (${item.id})`}
            onClick={() => toggle(item.id)}
          >{open ? "−" : "+"}</button> : <span className={styles.leaf} aria-hidden="true">·</span>}
          <button className={styles.select} type="button" aria-pressed={selectedId === item.id} onClick={() => onSelect(item.id)}>
            <strong>{name}</strong>
            <span className={styles.identifier}>{item.id}</span>
            <span className={styles.status}>{item.feasibility_status.replace(/_/g, " ")}</span>
          </button>
        </div>
        {item.children.length > 0 && <ul id={childrenId} hidden={!open} className={styles.list}>
          {open && item.children.map((child) => node(child, depth + 1))}
        </ul>}
      </li>
    );
  }

  return <ul className={styles.list} aria-label="Saved decision tree">{node(tree, 0)}</ul>;
}
