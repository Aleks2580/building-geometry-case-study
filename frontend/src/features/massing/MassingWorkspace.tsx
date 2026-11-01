import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError, previewMassing } from "../../api/api";
import type { MassingPreviewResponse } from "../../api/contracts";
import SaveRootOption from "../options/SaveRootOption";
import SitePlan from "../visualization/SitePlan";
import ConfigurationForm from "./ConfigurationForm";
import DetailedMetrics from "./DetailedMetrics";
import Diagnostics from "./Diagnostics";
import FeasibilitySummary from "./FeasibilitySummary";
import PreferenceAssessments from "./PreferenceAssessments";
import type { Configuration, ConfigurationDraft } from "./configuration";
import shared from "./massing.module.css";
import styles from "./MassingWorkspace.module.css";

interface Submission {
  configuration: Configuration;
  draft: ConfigurationDraft;
  id: string;
}

function PreviewSummary({ result }: { result: MassingPreviewResponse }) {
  return (
    <>
      <FeasibilitySummary feasibility={result.feasibility} />
      <SitePlan
        siteGeometry={result.site_geometry}
        buildableGeometry={result.buildable_geometry}
        selectedBuildableGeometry={result.selected_buildable_geometry}
        footprintGeometry={result.footprint_geometry}
      />
      <DetailedMetrics result={result} />
      <PreferenceAssessments result={result} />
      <Diagnostics diagnostics={result.feasibility.diagnostics} />
      <p className={styles.previewNote}>
        Result from the last submitted configuration. All geometry and metrics are calculated by the backend.
      </p>
    </>
  );
}

function PreviewError({ error }: { error: Error }) {
  const details = error instanceof ApiError ? error.error?.details : undefined;
  return (
    <div className={styles.previewError} role="alert">
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
    <div className={styles.workspace}>
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
      <section className={`${shared.panel} ${styles.previewPanel}`} aria-labelledby="preview-title" aria-busy={preview.isFetching}>
        <div className={shared.panelHeading}>
          <p className={shared.eyebrow}>Backend result</p>
          <h2 id="preview-title">Massing preview</h2>
        </div>
        {draftChanged && (
          <p className={styles.draftNotice} role="status">
            Draft inputs have changed since the last submission. Generate a preview to apply them.
          </p>
        )}
        {submission === null ? (
          <p className={styles.emptyState}>No preview yet. Review the configuration and choose Generate Preview.</p>
        ) : preview.isPending ? (
          <p role="status">Generating preview…</p>
        ) : preview.isError ? (
          <PreviewError error={preview.error} />
        ) : (
          <>
            <SaveRootOption
              // A receipt belongs to one preview attempt. A new submission detaches
              // any pending save without implying that the server rolled it back.
              key={submission.id}
              configuration={submission.configuration}
              draftChanged={draftChanged}
            />
            <PreviewSummary result={preview.data} />
          </>
        )}
      </section>
    </div>
  );
}
