import { useId, useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { getOptionTree, listOptions } from "../../api/api";
import type { OptionSummary as SavedSummary, OptionTree } from "../../api/contracts";
import OptionComparison from "../comparison/OptionComparison";
import type { ComparisonSelection, ComparisonSide } from "../comparison/OptionComparison";
import OptionSummary from "./OptionSummary";
import OptionTreeList from "./OptionTreeList";
import { optionKeys, refreshOptionQueries } from "./optionQueries";
import styles from "./SavedOptionsExplorer.module.css";

const pageSize = 50;

interface SavedOptionsExplorerProps {
  onOpenOption?: (id: string) => void;
}

function findNode(tree: OptionTree, id: string): OptionTree | undefined {
  if (tree.id === id) return tree;
  for (const child of tree.children) {
    const found = findNode(child, id);
    if (found) return found;
  }
}

function TreePanel({ rootId, onOpenOption, onAssignComparison }: SavedOptionsExplorerProps & {
  rootId: string;
  onAssignComparison: (side: ComparisonSide, option: SavedSummary) => void;
}) {
  const titleId = useId();
  const [selectedId, setSelectedId] = useState(rootId);
  const tree = useQuery({
    queryKey: optionKeys.tree(rootId),
    queryFn: ({ signal }) => getOptionTree(rootId, signal),
    networkMode: "always",
  });
  const selected = tree.data ? findNode(tree.data, selectedId) : undefined;

  return (
    <section className={styles.history} aria-labelledby={titleId}>
      <h3 id={titleId}>Decision tree</h3>
      {tree.isPending && <p role="status">Loading decision tree…</p>}
      {tree.isError && <div className={styles.error} role="alert">
        <p>{tree.data ? "Could not refresh the decision tree. Showing the last loaded tree." : "Could not load the decision tree."} {tree.error.message}</p>
        <button type="button" onClick={() => { void tree.refetch(); }} disabled={tree.isFetching}>Retry decision tree</button>
      </div>}
      {tree.data && <>
        {tree.isFetching && <p role="status">Refreshing decision tree…</p>}
        <div className={styles.treeAndSummary}>
          <OptionTreeList tree={tree.data} selectedId={selectedId} onSelect={setSelectedId} />
          {selected ? <div className={styles.selectedOption}>
            <OptionSummary option={selected} />
            {onOpenOption && <button type="button" className={styles.openButton} onClick={() => onOpenOption(selected.id)}>
              Open in Workspace
            </button>}
            <div className={styles.comparisonActions}>
              <button type="button" onClick={() => onAssignComparison("left", selected)}>Assign to Left</button>
              <button type="button" onClick={() => onAssignComparison("right", selected)}>Assign to Right</button>
            </div>
          </div> : <p>Select a node to inspect its saved summary.</p>}
        </div>
      </>}
    </section>
  );
}

export default function SavedOptionsExplorer({ onOpenOption }: SavedOptionsExplorerProps) {
  const titleId = useId();
  const rootsId = useId();
  const queryClient = useQueryClient();
  const [rootId, setRootId] = useState<string | null>(null);
  const [comparison, setComparison] = useState<Record<ComparisonSide, ComparisonSelection | null>>({ left: null, right: null });
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const options = useInfiniteQuery({
    queryKey: optionKeys.list(),
    queryFn: ({ pageParam, signal }) => listOptions({ limit: pageSize, offset: pageParam }, signal),
    initialPageParam: 0,
    // Pages mix roots and children. Only the unfiltered page can establish exhaustion
    // or the next offset; a full child-only page must keep older roots reachable.
    getNextPageParam: (lastPage, _pages, lastOffset) => lastPage.length === pageSize
      ? lastOffset + lastPage.length : undefined,
    networkMode: "always",
  });
  const roots = [...new Map(options.data?.pages.flat().filter((option) => option.parent_id === null)
    .map((option) => [option.id, option])).values()];

  function refresh() {
    void refreshOptionQueries(queryClient, true);
  }

  function assignComparison(side: ComparisonSide, option: SavedSummary) {
    const other = comparison[side === "left" ? "right" : "left"];
    if (other?.id.toLowerCase() === option.id.toLowerCase()) {
      setSelectionError("Select two distinct saved options. This option is already assigned to the other side.");
      return;
    }
    setSelectionError(null);
    setComparison((current) => ({ ...current, [side]: {
      id: option.id, name: option.name, parent_id: option.parent_id, feasibility_status: option.feasibility_status,
    } }));
  }

  return (
    <section id="saved-options" className={styles.explorer} aria-labelledby={titleId}>
      <div className={styles.header}>
        <div>
          <h2 id={titleId}>Saved options</h2>
          <p>Browse persisted decision histories, then open a snapshot or assign options to compare. Browsing and comparison keep your current draft.</p>
        </div>
        <button type="button" onClick={refresh} disabled={options.isFetching}>Refresh saved options</button>
      </div>
      <div className={styles.layout}>
        <section className={styles.roots} aria-labelledby={rootsId}>
          <h3 id={rootsId}>Root options</h3>
          {options.isPending && <p role="status">Loading saved options…</p>}
          {options.isError && <p className={styles.error} role="alert">
            {options.isFetchNextPageError ? "Could not load more saved options."
              : options.data ? "Could not refresh saved options. Showing the last loaded options."
                : "Could not load saved options."} {options.error.message}
          </p>}
          {options.data && roots.length === 0 && <p>
            {options.hasNextPage
              ? "No root options in the pages loaded so far. Load more to continue searching."
              : "No saved root options found. Save a preview to start a decision history."}
          </p>}
          {roots.length > 0 && <ul className={styles.rootList}>
            {roots.map((root) => <li key={root.id}>
              <button type="button" className={styles.rootButton} aria-pressed={rootId === root.id} onClick={() => setRootId(root.id)}>
                <strong>{root.name ?? "Unnamed option"}</strong>
                <span className={styles.identifier}>{root.id}</span>
                <span>{root.feasibility_status.replace(/_/g, " ")}</span>
              </button>
            </li>)}
          </ul>}
          {options.isFetching && !options.isPending && <p role="status">
            {options.isFetchingNextPage ? "Loading more saved options…" : "Refreshing saved options…"}
          </p>}
          {options.hasNextPage && <button type="button" disabled={options.isFetching} onClick={() => { void options.fetchNextPage({ cancelRefetch: false }); }}>Load more options</button>}
          {options.isError && !options.data && <button type="button" disabled={options.isFetching} onClick={() => { void options.refetch(); }}>Retry saved options</button>}
        </section>
        {rootId === null ? <p className={styles.prompt}>Select a root option to browse its decision tree.</p>
          : <TreePanel key={rootId} rootId={rootId} onOpenOption={onOpenOption} onAssignComparison={assignComparison} />}
      </div>
      {selectionError && <p className={styles.error} role="alert">{selectionError}</p>}
      <OptionComparison
        // Changing a slot detaches its submitted query immediately. Keeping this
        // outside the root-keyed tree preserves cross-history choices while browsing.
        key={`${comparison.left?.id.toLowerCase() ?? ""}:${comparison.right?.id.toLowerCase() ?? ""}`}
        left={comparison.left}
        right={comparison.right}
        onClear={(side) => {
          setSelectionError(null);
          setComparison((current) => ({ ...current, [side]: null }));
        }}
      />
    </section>
  );
}
