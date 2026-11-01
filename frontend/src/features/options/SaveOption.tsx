import { useId, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError, saveBranchOption, saveRootOption } from "../../api/api";
import { optionNameSchema } from "../../api/contracts";
import type { MassingPreviewRequest, OptionResponse, RootOptionRequest } from "../../api/contracts";
import { optionKeys, refreshOptionQueries } from "./optionQueries";
import styles from "./SaveOption.module.css";

interface SaveOptionProps {
  configuration: MassingPreviewRequest;
  draftChanged: boolean;
  parent?: OptionResponse;
  onCreateBranch?: (option: OptionResponse) => void;
}

function SaveError({ error, branching }: { error: Error; branching: boolean }) {
  const details = error instanceof ApiError ? error.error?.details : undefined;
  const uncertain = !(error instanceof ApiError) || error.kind !== "http" ||
    error.status === null || error.status >= 500 || error.status === 408;

  return (
    <div className={styles.error} role="alert">
      <h4>{uncertain ? "Save outcome unknown" : "Save request failed"}</h4>
      <p>{error.message}</p>
      {details && details.length > 0 && (
        <ul>{details.map((detail, index) => (
          <li key={`${detail.path}-${index}`}><strong>{detail.path}</strong>: {detail.message}</li>
        ))}</ul>
      )}
      <p>{uncertain
        ? `The option may have been saved. Saving again creates a new ${branching ? "child of the selected parent" : "root option"} and may create a duplicate.`
        : branching && error instanceof ApiError && error.status === 404
          ? "The selected parent could not be found. Check the parent identifier or start a new root option."
          : `Review the error before choosing ${branching ? "Save Branch" : "Save Option"} again.`}</p>
    </div>
  );
}

export default function SaveOption({ configuration, draftChanged, parent, onCreateBranch }: SaveOptionProps) {
  const queryClient = useQueryClient();
  const id = useId();
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const submissionPending = useRef(false);

  const save = useMutation({
    mutationFn: (request: RootOptionRequest) => parent
      ? saveBranchOption(parent.id, {
        hard_constraints: request.hard_constraints,
        preferences: request.preferences ?? {},
        targets: request.targets ?? {},
        name: request.name,
      })
      : saveRootOption(request),
    retry: false,
    networkMode: "always",
    onSuccess: (saved) => {
      queryClient.setQueryData(optionKeys.detail(saved.id), saved);
      // Hook-level callbacks survive receipt unmounts. A child can affect any cached
      // ancestor tree; refetching must not delay the receipt or cancel the mutation.
      void refreshOptionQueries(queryClient, saved.parent_id !== null);
    },
    onSettled: () => { submissionPending.current = false; },
  });

  function validateName() {
    if (name === "") {
      setNameError(null);
      return { valid: true, name: undefined } as const;
    }
    const parsed = optionNameSchema.safeParse(name);
    setNameError(parsed.success ? null : parsed.error.issues[0].message);
    return parsed.success
      ? { valid: true, name: parsed.data } as const
      : { valid: false } as const;
  }

  return (
    <section className={styles.section} aria-labelledby={`${id}-title`} aria-busy={save.isPending}>
      <h3 id={`${id}-title`}>{parent ? "Save branch" : "Save root option"}</h3>
      <p className={styles.hint}>
        {parent
          ? "Each save creates a sibling under the selected parent. Earlier designs stay unchanged."
          : "Save this configuration to start a decision history. Each save creates a separate option."}
      </p>
      {parent && <p className={styles.parent}>Selected parent: <strong>{parent.name ?? "Unnamed option"}</strong> ({parent.id})</p>}
      <form aria-label={parent ? "Save branch option" : "Save root option"} noValidate onSubmit={(event) => {
        event.preventDefault();
        if (draftChanged || submissionPending.current || save.isPending) return;
        const parsed = validateName();
        if (!parsed.valid) return;
        // Mutation state updates on render; a synchronous guard also blocks repeated
        // form submissions before that render. A new save is always a new database row.
        submissionPending.current = true;
        save.mutate({ ...configuration, ...(parsed.name === undefined ? {} : { name: parsed.name }) });
      }}>
        <div className={styles.field}>
          <label htmlFor={`${id}-name`}>Option name (optional)</label>
          <input
            id={`${id}-name`}
            type="text"
            value={name}
            disabled={save.isPending}
            aria-invalid={nameError !== null}
            aria-describedby={`${id}-hint${nameError === null ? "" : ` ${id}-error`}`}
            onChange={(event) => {
              setName(event.target.value);
              setNameError(null);
            }}
            onBlur={validateName}
          />
          <p className={styles.hint} id={`${id}-hint`}>Optional · Up to 200 characters</p>
          {nameError !== null && <p className={styles.fieldError} id={`${id}-error`} role="alert">{nameError}</p>}
        </div>
        <button className={styles.saveButton} type="submit" disabled={draftChanged || save.isPending}>
          {save.isPending ? "Saving…" : parent
            ? save.isSuccess ? "Save Another Branch" : "Save Branch"
            : save.isSuccess ? "Save Another Root Option" : "Save Option"}
        </button>
      </form>
      {draftChanged && (
        <p className={styles.notice}>Generate Preview for the current draft before saving.</p>
      )}
      {save.isPending && (
        <p className={styles.notice} role="status">
          Saving your option. You can keep exploring while it saves.
        </p>
      )}
      {save.isSuccess && (
        <div className={styles.success} role="status">
          <h4>{parent ? "Branch saved" : "Root option saved"}</h4>
          <p>Your saved design is available in Saved Options.</p>
          <dl>
            <div><dt>Name</dt><dd>{save.data.name ?? "Unnamed option"}</dd></div>
            <div><dt>Identifier</dt><dd>{save.data.id}</dd></div>
            <div><dt>Parent</dt><dd>{save.data.parent_id ?? "None (root option)"}</dd></div>
            <div><dt>Saved status</dt><dd>{save.data.feasibility_status}</dd></div>
          </dl>
          {onCreateBranch && <button className={styles.saveButton} type="button" onClick={() => onCreateBranch(save.data)}>
            Create Branch
          </button>}
        </div>
      )}
      {save.isError && <SaveError error={save.error} branching={parent !== undefined} />}
    </section>
  );
}
