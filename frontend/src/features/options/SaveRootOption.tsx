import { useId, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ApiError, saveRootOption } from "../../api/api";
import { optionNameSchema } from "../../api/contracts";
import type { MassingPreviewRequest } from "../../api/contracts";
import styles from "./SaveRootOption.module.css";

interface SaveRootOptionProps {
  configuration: MassingPreviewRequest;
  draftChanged: boolean;
}

function SaveError({ error }: { error: Error }) {
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
        ? "The option may have been saved. Saving again creates a new root option and may create a duplicate."
        : "Review the error before choosing Save Option again."}</p>
    </div>
  );
}

export default function SaveRootOption({ configuration, draftChanged }: SaveRootOptionProps) {
  const id = useId();
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const submissionPending = useRef(false);
  const save = useMutation({
    mutationFn: saveRootOption,
    retry: false,
    networkMode: "always",
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
      <h3 id={`${id}-title`}>Save option</h3>
      <p className={styles.hint}>
        Save this generated configuration as an immutable root option, including any feasibility diagnostics.
        The backend recomputes the saved snapshot. Each save creates a new option.
      </p>
      <form aria-label="Save root option" noValidate onSubmit={(event) => {
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
          <p className={styles.hint} id={`${id}-hint`}>Up to 200 characters. Leave empty for an unnamed option.</p>
          {nameError !== null && <p className={styles.fieldError} id={`${id}-error`} role="alert">{nameError}</p>}
        </div>
        <button className={styles.saveButton} type="submit" disabled={draftChanged || save.isPending}>
          {save.isPending ? "Saving…" : save.isSuccess ? "Save Another Root Option" : "Save Option"}
        </button>
      </form>
      {draftChanged && (
        <p className={styles.notice}>Generate Preview for the current draft before saving.</p>
      )}
      {save.isPending && (
        <p className={styles.notice} role="status">
          Saving this submitted preview. Generating another preview hides this receipt and does not cancel the save.
        </p>
      )}
      {save.isSuccess && (
        <div className={styles.success} role="status">
          <h4>Root option saved</h4>
          <p>This receipt belongs to the generated preview.</p>
          <dl>
            <div><dt>Name</dt><dd>{save.data.name ?? "Unnamed option"}</dd></div>
            <div><dt>Identifier</dt><dd>{save.data.id}</dd></div>
            <div><dt>Parent</dt><dd>None (root option)</dd></div>
            <div><dt>Saved status</dt><dd>{save.data.feasibility_status}</dd></div>
          </dl>
        </div>
      )}
      {save.isError && <SaveError error={save.error} />}
    </section>
  );
}
