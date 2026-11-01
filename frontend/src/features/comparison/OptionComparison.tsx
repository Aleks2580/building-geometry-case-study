import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError, compareOptions } from "../../api/api";
import { optionComparisonRequestSchema } from "../../api/contracts";
import type { OptionResponse } from "../../api/contracts";
import { optionKeys } from "../options/optionQueries";
import ComparisonResult from "./ComparisonResult";
import styles from "./comparison.module.css";

export type ComparisonSide = "left" | "right";
export type ComparisonSelection = Pick<OptionResponse, "id" | "name" | "parent_id" | "feasibility_status">;

interface OptionComparisonProps {
  left: ComparisonSelection | null;
  right: ComparisonSelection | null;
  onClear: (side: ComparisonSide) => void;
}

export default function OptionComparison({ left, right, onClear }: OptionComparisonProps) {
  const titleId = useId();
  const [submitted, setSubmitted] = useState<[string, string] | null>(null);
  const selection = optionComparisonRequestSchema.safeParse({ option_ids: [left?.id, right?.id] });
  const comparison = useQuery({
    queryKey: optionKeys.comparison(submitted?.[0] ?? null, submitted?.[1] ?? null),
    queryFn: ({ signal }) => {
      if (submitted === null) throw new Error("Choose two saved options before comparing.");
      return compareOptions({ option_ids: submitted }, signal);
    },
    enabled: submitted !== null,
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnReconnect: false,
    networkMode: "always",
  });

  function compare() {
    if (!selection.success) return;
    const pair: [string, string] = [selection.data.option_ids[0].toLowerCase(), selection.data.option_ids[1].toLowerCase()];
    if (comparison.isError && submitted?.[0] === pair[0] && submitted[1] === pair[1]) {
      void comparison.refetch();
    } else setSubmitted(pair);
  }

  const errorDetails = comparison.error instanceof ApiError ? comparison.error.error?.details : undefined;

  return <section className={styles.comparison} aria-labelledby={titleId}>
    <h3 id={titleId}>Compare saved options</h3>
    <p>Assign saved nodes to Left and Right, then compare their stored inputs and results. Your workspace stays available above.</p>
    <div className={styles.slots}>
      {(["left", "right"] as const).map((side) => {
        const option = side === "left" ? left : right;
        const label = side === "left" ? "Left" : "Right";
        return <section className={styles.slot} aria-label={`${label} comparison selection`} key={side}>
          <h4>{label}</h4>
          {option ? <>
            <strong>{option.name ?? "Unnamed option"}</strong>
            <dl className={styles.identity}>
              <div><dt>UUID</dt><dd>{option.id}</dd></div>
              <div><dt>Status</dt><dd>{option.feasibility_status.replace(/_/g, " ")}</dd></div>
              <div><dt>Parent</dt><dd>{option.parent_id ?? "None (root option)"}</dd></div>
            </dl>
            <button type="button" onClick={() => onClear(side)}>Clear {label}</button>
          </> : <p>No option selected. Choose a saved node and assign it to {label}.</p>}
        </section>;
      })}
    </div>
    {left !== null && right !== null && !selection.success && <p role="alert" className={styles.error}>
      Select two distinct saved options with valid UUIDs. The same UUID cannot occupy both slots, regardless of letter casing.
    </p>}
    <div className={styles.actions}>
      <button type="button" onClick={compare} disabled={!selection.success || comparison.isFetching}>Compare</button>
      {comparison.isFetching && <button type="button" onClick={() => setSubmitted(null)}>Cancel comparison</button>}
    </div>
    {submitted === null ? <p className={styles.notice}>No submitted comparison. Choose two distinct saved options and select Compare.</p>
      : comparison.isPending ? <p role="status">Loading saved option comparison…</p>
        : comparison.isError ? <div role="alert" className={styles.error}>
          <h4>Could not compare saved options</h4>
          <p>{comparison.error.message}</p>
          <p>Left: {submitted[0]}<br />Right: {submitted[1]}</p>
          {errorDetails && errorDetails.length > 0 && <ul>{errorDetails.map((detail, index) =>
            <li key={`${detail.path}-${index}`}><strong>{detail.path}</strong>: {detail.message}</li>)}</ul>}
          <button type="button" onClick={() => { void comparison.refetch(); }} disabled={comparison.isFetching}>Retry comparison</button>
        </div> : <ComparisonResult comparison={comparison.data} />}
  </section>;
}
