import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError, previewMassing } from "./api";
import type { FeasibilityStatus, MassingPreviewResponse } from "./api/contracts";
import ConfigurationForm from "./ConfigurationForm";
import type { Configuration, ConfigurationDraft } from "./configuration";

interface Submission {
  configuration: Configuration;
  draft: ConfigurationDraft;
  id: string;
}

const statusContent: Record<FeasibilityStatus, { title: string; description: string }> = {
  feasible: {
    title: "Feasible",
    description: "The generated massing satisfies the hard constraints.",
  },
  feasible_target_unmet: {
    title: "Feasible — GFA target unmet",
    description: "The generated massing satisfies the hard constraints but misses the GFA target.",
  },
  infeasible: {
    title: "Infeasible",
    description: "The backend found no buildable massing under these constraints.",
  },
  generation_failed: {
    title: "Generation failed",
    description: "The backend could not construct a footprint. This does not establish infeasibility.",
  },
};

const metricFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

function PreviewSummary({ result }: { result: MassingPreviewResponse }) {
  const status = statusContent[result.feasibility.status];
  const metrics = [
    { label: "Footprint area", value: result.metrics.footprint_area_m2, unit: "m²" },
    { label: "Floor count", value: result.metrics.floor_count, unit: "" },
    { label: "Height", value: result.metrics.height_m, unit: "m" },
    { label: "GFA", value: result.metrics.gfa_m2, unit: "m²" },
  ];

  return (
    <>
      <div className="preview-status" data-status={result.feasibility.status} role="status">
        <h3>{status.title}</h3>
        <p>{status.description}</p>
      </div>
      <dl className="metrics">
        {metrics.map(({ label, value, unit }) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value === null ? "Not available" : `${
              value > 0 && value < 0.01 ? "<0.01" : metricFormat.format(value)
            }${unit ? ` ${unit}` : ""}`}</dd>
          </div>
        ))}
      </dl>
      <p className="preview-note">
        Result from the last submitted configuration. All geometry and metrics are calculated by the backend.
        Values are displayed to at most two decimal places; positive values below 0.01 are shown as &lt;0.01.
      </p>
    </>
  );
}

function PreviewError({ error }: { error: Error }) {
  const details = error instanceof ApiError ? error.error?.details : undefined;
  return (
    <div className="preview-error" role="alert">
      <h3>Preview request failed</h3>
      <p>{error.message}</p>
      {details && details.length > 0 && (
        <ul>{details.map((detail, index) => (
          <li key={`${detail.path}-${index}`}><strong>{detail.path}</strong>: {detail.message}</li>
        ))}</ul>
      )}
      <p>Review the inputs and choose Generate Preview to try again.</p>
    </div>
  );
}

export default function MassingWorkspace() {
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [draftChanged, setDraftChanged] = useState(false);
  const preview = useQuery({
    // The identity remains unique across remounts so unchanged inputs still trigger
    // an explicit new attempt. Changing keys cancels the observer's consumed signal;
    // its late result can never populate the active preview, even if abort is ignored.
    queryKey: ["massing-preview", submission?.configuration, submission?.id],
    queryFn: ({ signal }) => {
      if (submission === null) throw new Error("Submit a configuration before previewing.");
      return previewMassing(submission.configuration, signal);
    },
    enabled: submission !== null,
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnReconnect: false,
    networkMode: "always",
  });

  return (
    <div className="workspace">
      <ConfigurationForm
        submittedDraft={submission?.draft}
        isGenerating={preview.isFetching}
        onDraftChange={setDraftChanged}
        onSubmit={(configuration, draft) => setSubmission({
          configuration,
          draft,
          id: crypto.randomUUID(),
        })}
      />
      <section className="panel preview-panel" aria-labelledby="preview-title" aria-busy={preview.isFetching}>
        <div className="panel-heading">
          <p className="eyebrow">Backend result</p>
          <h2 id="preview-title">Massing preview</h2>
        </div>
        {draftChanged && (
          <p className="draft-notice" role="status">
            Draft inputs have changed since the last submission. Generate a preview to apply them.
          </p>
        )}
        {submission === null ? (
          <p className="empty-state">No preview yet. Review the configuration and choose Generate Preview.</p>
        ) : preview.isPending ? (
          <p role="status">Generating preview…</p>
        ) : preview.isError ? (
          <PreviewError error={preview.error} />
        ) : (
          <PreviewSummary result={preview.data} />
        )}
      </section>
    </div>
  );
}
