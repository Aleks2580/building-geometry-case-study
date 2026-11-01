import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError, getOption, previewMassing } from "../../api/api";
import type { OptionResponse } from "../../api/contracts";
import SaveOption from "../options/SaveOption";
import { optionKeys } from "../options/optionQueries";
import ConfigurationForm from "./ConfigurationForm";
import MassingResult from "./MassingResult";
import SavedOptionSnapshot from "./SavedOptionSnapshot";
import WorkspaceActionBar from "./WorkspaceActionBar";
import type { Configuration, ConfigurationDraft } from "./configuration";
import { configurationDraftFromOption } from "./configuration";
import styles from "./MassingWorkspace.module.css";

interface Submission {
  configuration: Configuration;
  draft: ConfigurationDraft;
  id: string;
}

function PreviewError({ error }: { error: Error }) {
  const details = error instanceof ApiError ? error.error?.details : undefined;
  return (
    <div className={styles.previewError} role="alert">
      <h2>Preview request failed</h2>
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

function WorkspaceSession({ parent, focusOnMount, onCreateBranch, onStartRoot, onWorkChange, navigation }: {
  parent: OptionResponse | null;
  focusOnMount: boolean;
  onCreateBranch: (option: OptionResponse) => void;
  onStartRoot: () => void;
  onWorkChange: (hasWork: boolean) => void;
  navigation: ReactNode;
}) {
  const formId = useId();
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [draftChanged, setDraftChanged] = useState(false);
  // A submitted preview is work even at default inputs or after a save: the save
  // recomputes independently. This also protects its name, receipt, and pending save.
  const reportDirty = useCallback((dirty: boolean) => onWorkChange(dirty || submission !== null), [submission, onWorkChange]);
  const preview = useQuery({
    // The identity remains unique across remounts so unchanged inputs still trigger
    // an explicit new attempt. Changing keys cancels the observer's consumed signal;
    // its late result can never populate the active preview, even if abort is ignored.
    queryKey: ["massing-preview", parent?.id, submission?.configuration, submission?.id],
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
    <div className={styles.session}>
      <div className={styles.workspaceScroll}>
        {navigation}
        <div className={styles.workspace}>
          <div className={styles.editor}>
            <section className={styles.context} data-mode={parent ? "branch" : "root"} aria-label="Option creation context">
              <h2>{parent ? "Branch from saved option" : "New root option"}</h2>
              {parent ? <>
                <p>Selected parent: <strong>{parent.name ?? "Unnamed option"}</strong></p>
                <dl>
                  <div><dt>Parent ID</dt><dd>{parent.id}</dd></div>
                  <div><dt>Saved status</dt><dd>{parent.feasibility_status}</dd></div>
                </dl>
                <p>Changes create a new branch. Your saved design stays unchanged.</p>
              </> : <p>Unsaved design</p>}
            </section>
            <ConfigurationForm
              id={formId}
              initialDraft={parent ? configurationDraftFromOption(parent) : undefined}
              inheritedSite={parent?.site_geometry}
              focusOnMount={focusOnMount}
              submittedDraft={submission?.draft}
              onDraftChange={setDraftChanged}
              onDirtyChange={reportDirty}
              onSubmit={(configuration, draft) => setSubmission({
                configuration,
                draft,
                id: crypto.randomUUID(),
              })}
            />
          </div>
          <section className={styles.previewPanel} aria-label="Massing preview" aria-busy={preview.isFetching}>
            {draftChanged && (
              <p className={styles.draftNotice} role="status">
                Draft inputs have changed since the last submission. Generate a preview to apply them.
              </p>
            )}
            {submission === null ? (
              <div className={styles.emptyState}>
                <div className={styles.emptyIcon} aria-hidden="true">
                  <svg viewBox="0 0 80 80" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="m15 55 25 14 25-14V25L40 11 15 25zm0-30 25 14 25-14M40 39v30M15 35l25 14 25-14M15 45l25 14 25-14" />
                  </svg>
                </div>
                <p className={styles.emptyEyebrow}>Your design starts here</p>
                <h2>Massing preview</h2>
                <p>No preview yet. Choose your site outline and constraints, then select <strong>Generate Preview</strong>.</p>
                <div className={styles.emptyFeatures}><span>Site &amp; footprint</span><span>Floor area &amp; height</span><span>2D &amp; 3D views</span></div>
              </div>
            ) : preview.isPending ? (
              <div className={styles.loadingState} role="status"><span className={styles.spinner} aria-hidden="true" /><h2>Massing preview</h2><p>Generating preview…</p></div>
            ) : preview.isError ? (
              <PreviewError error={preview.error} />
            ) : (
              <MassingResult result={preview.data} actions={<SaveOption
                  // A receipt belongs to one preview attempt. A new submission detaches
                  // any pending save without implying that the server rolled it back.
                  key={submission.id}
                  configuration={submission.configuration}
                  draftChanged={draftChanged}
                  parent={parent ?? undefined}
                  onCreateBranch={onCreateBranch}
                />} />
            )}
          </section>
        </div>
      </div>
      <WorkspaceActionBar mode="edit" formId={formId} isGenerating={preview.isFetching} onNewDesign={onStartRoot} />
    </div>
  );
}

type WorkspaceTarget = { mode: "root" } | { mode: "saved" | "branch"; optionId: string };
type Session = WorkspaceTarget & { id: string };
interface Navigation {
  requestId: string;
  sourceSessionId: string;
  target: WorkspaceTarget;
  external: boolean;
  needsConfirmation: boolean;
}

function useOptionSnapshot(optionId: string | null) {
  return useQuery({
    queryKey: optionKeys.detail(optionId),
    queryFn: ({ signal }) => {
      if (optionId === null) throw new Error("Select a saved option first.");
      return getOption(optionId, signal);
    },
    enabled: optionId !== null,
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnReconnect: false,
    networkMode: "always",
  });
}

function ReplacementConfirmation({ opening, destination, onKeepEditing, onReplace }: {
  opening: boolean;
  destination: string;
  onKeepEditing: () => void;
  onReplace: () => void;
}) {
  const keepEditing = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // A saved read can finish while another shell section is visible.
    if (keepEditing.current?.closest("[hidden]")) return;
    keepEditing.current?.focus();
    keepEditing.current?.scrollIntoView?.({ block: "center" });
  }, []);
  return <section className={styles.confirmation} aria-label="Replace workspace">
    <h2>Replace the current workspace?</h2>
    <p>{destination}</p>
    <p>This replaces your draft, preview, and save receipt. Keep editing to retain them.</p>
    <p>Any save already sent may still complete. Leaving does not cancel or roll back that save.</p>
    <div className={styles.actions}>
      <button ref={keepEditing} type="button" onClick={onKeepEditing}>Keep Editing</button>
      <button type="button" onClick={onReplace}>{opening ? "Discard Draft and Open" : "Discard Draft and Continue"}</button>
    </div>
  </section>;
}

export default function MassingWorkspace({ openRequest = null }: {
  openRequest?: { optionId: string; requestId: string } | null;
}) {
  const [session, setSession] = useState<Session>({ id: "initial-root", mode: "root" });
  const hasWork = useRef(false);
  const [navigation, setNavigation] = useState<Navigation | null>(null);
  const activeSessionId = useRef(session.id);
  const latestRequestId = useRef<string | null>(null);
  const handledOpenRequest = useRef<string | null>(null);
  const workspace = useRef<HTMLDivElement>(null);
  // The form publishes RHF state before the navigation effect runs. Reading the
  // latest signal avoids losing an edit batched with a successful GET response.
  const reportWork = useCallback((work: boolean) => { hasWork.current = work; }, []);

  const requestNavigation = useCallback((target: WorkspaceTarget, requestId: string = crypto.randomUUID(), external = false) => {
    latestRequestId.current = requestId;
    setNavigation({ requestId, target, external, sourceSessionId: activeSessionId.current, needsConfirmation: false });
  }, []);
  useEffect(() => {
    if (openRequest === null || handledOpenRequest.current === openRequest.requestId) return;
    handledOpenRequest.current = openRequest.requestId;
    requestNavigation({ mode: "saved", optionId: openRequest.optionId }, openRequest.requestId, true);
  }, [openRequest, requestNavigation]);

  const currentNavigation = navigation !== null && navigation.sourceSessionId === session.id &&
    (!navigation.external || openRequest?.requestId === navigation.requestId);
  const requestedOptionId = currentNavigation && navigation.target.mode !== "root" ? navigation.target.optionId : null;
  const requested = useOptionSnapshot(requestedOptionId);
  const active = useOptionSnapshot(session.mode === "root" ? null : session.optionId);
  const ready = currentNavigation && (navigation.target.mode === "root" || requested.isSuccess);

  const commitNavigation = useCallback((next: Navigation) => {
    // Keys isolate snapshot data; these identities additionally prevent a late
    // navigation from replacing another editor or a newer explicit open request.
    if (latestRequestId.current !== next.requestId || activeSessionId.current !== next.sourceSessionId) return;
    const id = crypto.randomUUID();
    activeSessionId.current = id;
    latestRequestId.current = null;
    hasWork.current = false;
    setNavigation(null);
    setSession({ ...next.target, id });
  }, []);

  useEffect(() => {
    if (!ready || navigation === null || navigation.needsConfirmation) return;
    if (hasWork.current) {
      setNavigation((current) => current?.requestId === navigation.requestId
        ? { ...current, needsConfirmation: true } : current);
    } else commitNavigation(navigation);
  }, [ready, navigation, commitNavigation]);

  function cancelNavigation() {
    latestRequestId.current = null;
    setNavigation(null);
    workspace.current?.querySelector<HTMLElement>("input:not(:disabled), h2[tabindex]")?.focus();
  }

  const navigationContent = currentNavigation && <div className={styles.navigation}>
    {navigation.needsConfirmation && ready ? <ReplacementConfirmation
      key={navigation.requestId}
      opening={navigation.target.mode === "saved"}
      destination={navigation.target.mode === "root" ? "Start a new root option."
        : `${navigation.target.mode === "saved" ? "Open" : "Branch from"} ${requested.data?.name ?? "Unnamed option"} (${navigation.target.optionId}).`}
      onKeepEditing={cancelNavigation}
      onReplace={() => commitNavigation(navigation)}
    /> : requested.isError ? <div className={styles.previewError} role="alert">
      <h2>Could not open saved option</h2>
      <p>Requested option: {requestedOptionId}</p>
      <p>{requested.error.message}</p>
      {requested.error instanceof ApiError && requested.error.error?.details.map((detail, index) =>
        <p key={`${detail.path}-${index}`}>{detail.path}: {detail.message}</p>)}
      <div className={styles.actions}>
        <button type="button" onClick={() => { void requested.refetch(); }}>Retry opening option</button>
        <button type="button" onClick={cancelNavigation}>Cancel opening</button>
      </div>
    </div> : <div className={styles.context}>
      <p role="status">Loading saved option…</p>
      <p>Requested option: {requestedOptionId}</p>
      <button type="button" onClick={cancelNavigation}>Cancel opening</button>
    </div>}
  </div>;

  return <div ref={workspace} className={styles.workspaceContainer}>
    {session.mode === "root" ? <WorkspaceSession
      key={session.id}
      parent={null}
      navigation={navigationContent}
      focusOnMount={session.id !== "initial-root"}
      onWorkChange={reportWork}
      onCreateBranch={(parent) => requestNavigation({ mode: "branch", optionId: parent.id })}
      onStartRoot={() => requestNavigation({ mode: "root" })}
    /> : active.data ? session.mode === "saved" ? <SavedOptionSnapshot
      key={session.id}
      option={active.data}
      navigation={navigationContent}
      onCreateBranch={() => requestNavigation({ mode: "branch", optionId: session.optionId })}
      onStartRoot={() => requestNavigation({ mode: "root" })}
    /> : <WorkspaceSession
      key={session.id}
      parent={active.data}
      navigation={navigationContent}
      focusOnMount
      onWorkChange={reportWork}
      onCreateBranch={(parent) => requestNavigation({ mode: "branch", optionId: parent.id })}
      onStartRoot={() => requestNavigation({ mode: "root" })}
    /> : <p role="status">Loading saved option…</p>}
  </div>;
}
