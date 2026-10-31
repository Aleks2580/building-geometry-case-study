import { useEffect } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import type { FieldPath } from "react-hook-form";
import {
  configurationSchema,
  initialConfigurationDraft,
  siteInputSchema,
} from "./configuration";
import type { Configuration, ConfigurationDraft } from "./configuration";
import shared from "./massing.module.css";
import styles from "./ConfigurationForm.module.css";

interface ConfigurationFormProps {
  onSubmit: (configuration: Configuration, draft: ConfigurationDraft) => void;
  submittedDraft?: ConfigurationDraft;
  isGenerating?: boolean;
  onDraftChange?: (changed: boolean) => void;
}

export default function ConfigurationForm({
  onSubmit,
  submittedDraft,
  isGenerating = false,
  onDraftChange,
}: ConfigurationFormProps) {
  const { register, handleSubmit, getValues, setValue, clearErrors, control, getFieldState, formState } =
    useForm<ConfigurationDraft, unknown, Configuration>({
      resolver: zodResolver(configurationSchema),
      defaultValues: initialConfigurationDraft,
      mode: "onBlur",
    });
  const draft = useWatch({ control });
  const siteKind = useWatch({ control, name: "site.kind" });
  const customSiteError = getFieldState("site.json", formState).error;
  const draftChanged = submittedDraft !== undefined &&
    JSON.stringify(draft) !== JSON.stringify(submittedDraft);
  useEffect(() => onDraftChange?.(draftChanged), [draftChanged, onDraftChange]);

  function selectSite(kind: ConfigurationDraft["site"]["kind"]) {
    const current = getValues("site");
    if (kind === current.kind) return;
    let site: ConfigurationDraft["site"];
    if (kind === "custom") {
      const parsed = siteInputSchema.safeParse(current);
      // Invalid dimensions have no Polygon to seed. Never restore a historical
      // geometry behind the user's current input; the empty editor must be completed.
      site = { kind, json: parsed.success ? JSON.stringify(parsed.data, null, 2) : "" };
    } else if (kind === "rectangle") {
      site = { ...initialConfigurationDraft.site };
    } else {
      site = { kind };
    }
    clearErrors("site");
    setValue("site", site, { shouldDirty: true });
  }

  function numericField(
    name: FieldPath<ConfigurationDraft>,
    label: string,
    hint: string,
    required = false,
    integer = false,
  ) {
    const { error } = getFieldState(name, formState);
    const id = name.replace(/\./g, "-");
    return (
      <div className={styles.field} key={name}>
        <label htmlFor={id}>{label}{required ? "" : " (optional)"}</label>
        <input
          id={id}
          type="text"
          inputMode={integer ? "numeric" : "decimal"}
          aria-required={required}
          aria-invalid={Boolean(error)}
          aria-describedby={`${id}-hint${error ? ` ${id}-error` : ""}`}
          {...register(name)}
        />
        <p className={styles.fieldHint} id={`${id}-hint`}>{hint}</p>
        {error && <p className={styles.fieldError} id={`${id}-error`} role="alert">{error.message}</p>}
      </div>
    );
  }

  return (
    <form
      className={`${shared.panel} ${styles.form}`}
      aria-label="Massing configuration"
      noValidate
      onSubmit={(event) => {
        // RHF exposes nested draft references; capture the submission before later edits.
        const submittedDraft = structuredClone(getValues());
        void handleSubmit((configuration) => onSubmit(configuration, submittedDraft))(event);
      }}
    >
      <div className={shared.panelHeading}>
        <p className={shared.eyebrow}>Configuration</p>
        <h2>Shape your massing</h2>
        <p>Choose a site shape, then adjust the rules and preferences.</p>
      </div>

      <fieldset>
        <legend>Site geometry</legend>
        <div className={styles.field}>
          <label htmlFor="site-shape">Site shape</label>
          <select
            id="site-shape"
            aria-describedby="site-shape-hint"
            {...register("site.kind")}
            value={siteKind}
            onChange={(event) => selectSite(event.target.value as ConfigurationDraft["site"]["kind"])}
          >
            <option value="rectangle">Rectangle</option>
            <option value="l-shaped">L-shaped example</option>
            <option value="notched">Notched example</option>
            <option value="custom">Custom Polygon (advanced)</option>
          </select>
          <p className={styles.fieldHint} id="site-shape-hint">
            Changing shape replaces the site draft. Other inputs stay as entered.
            Returning to Rectangle starts at 40 × 25 m.
          </p>
        </div>
        {siteKind === "rectangle" && (
          <div className={`${styles.fieldGrid} ${styles.siteInputs}`}>
            {numericField("site.width", "Width (m)", "Greater than zero. Local x direction.", true)}
            {numericField("site.length", "Length (m)", "Greater than zero. Local y direction.", true)}
          </div>
        )}
        {siteKind === "l-shaped" && (
          <p className={styles.fieldHint}>
            A concave L-shaped site demonstrates setbacks around an inward corner.
            Choose Custom Polygon to edit its coordinates.
          </p>
        )}
        {siteKind === "notched" && (
          <p className={styles.fieldHint}>
            A deep notch demonstrates how setbacks can split or collapse the buildable area.
            Choose Custom Polygon to edit its coordinates.
          </p>
        )}
        {siteKind === "custom" && <div className={`${styles.field} ${styles.siteInputs}`}>
          <label htmlFor="site">Site Polygon JSON</label>
          <textarea
            id="site"
            rows={12}
            spellCheck={false}
            aria-required="true"
            aria-invalid={Boolean(customSiteError)}
            aria-describedby={`site-hint${customSiteError ? " site-error" : ""}`}
            {...register("site.json")}
          />
          <p className={styles.fieldHint} id="site-hint">
            Local coordinates in metres. Use a GeoJSON Polygon with closed [x, y] rings:
            the first ring is the boundary; subsequent rings are holes.
            Geometry validity is checked by the backend.
            Start from a valid selected shape, or enter Polygon JSON here.
          </p>
          {customSiteError && (
            <p className={styles.fieldError} id="site-error" role="alert">{customSiteError.message}</p>
          )}
        </div>}
      </fieldset>

      <fieldset>
        <legend>Hard constraints</legend>
        <p className={styles.fieldsetHint}>Set at least one maximum: height or floor count.</p>
        <div className={styles.fieldGrid}>
          {numericField("hard_constraints.setback_m", "Setback (m)", "Zero or greater.", true)}
          {numericField("hard_constraints.floor_to_floor_m", "Floor-to-floor height (m)", "Greater than zero.", true)}
          {numericField("hard_constraints.max_height_m", "Maximum height (m)", "Greater than zero when set.")}
          {numericField("hard_constraints.max_floors", "Maximum floor count", "A positive whole number.", false, true)}
          {numericField("hard_constraints.site_coverage_ratio", "Site coverage ratio", "Greater than 0, up to 1 (for example, 0.6).")}
          {numericField("hard_constraints.max_footprint_m2", "Maximum footprint (m²)", "Greater than zero when set.")}
        </div>
      </fieldset>

      <fieldset>
        <legend>Design preferences</legend>
        <p className={styles.fieldsetHint}>Leave blank for backend defaults. Hard constraints take priority.</p>
        <div className={styles.fieldGrid}>
          {numericField("preferences.preferred_floor_count", "Preferred floor count", "A positive whole number.", false, true)}
          {numericField("preferences.preferred_footprint_area_m2", "Preferred footprint (m²)", "Greater than zero when set.")}
        </div>
      </fieldset>

      <fieldset>
        <legend>GFA target</legend>
        {numericField("targets.gfa_target_m2", "GFA target (m²)", "A desired minimum, zero or greater. Leave blank for no target.")}
      </fieldset>

      <div className={styles.formActions}>
        <button className={styles.submitButton} type="submit">Generate Preview</button>
        <p className={styles.fieldHint}>
          {isGenerating
            ? "You can keep editing and submit again to replace the pending request."
            : "Preview only. This configuration is not saved."}
        </p>
      </div>
    </form>
  );
}
