import { useEffect, useRef, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import type { FieldPath } from "react-hook-form";
import type { PolygonGeometry } from "../../../api/contracts";
import {
  configurationSchema,
  initialConfigurationDraft,
  siteInputSchema,
} from "./configuration";
import type { Configuration, ConfigurationDraft } from "./configuration";
import DraftSitePreview from "../site/DraftSitePreview";
import CustomSiteEditor from "../site/CustomSiteEditor";
import shared from "../massing.module.css";
import styles from "./ConfigurationForm.module.css";

interface ConfigurationFormProps {
  id?: string;
  onSubmit: (configuration: Configuration, draft: ConfigurationDraft) => void;
  submittedDraft?: ConfigurationDraft;
  onDraftChange?: (changed: boolean) => void;
  onDirtyChange?: (dirty: boolean) => void;
  initialDraft?: ConfigurationDraft;
  inheritedSite?: PolygonGeometry;
  focusOnMount?: boolean;
}

const siteShapes = [
  { kind: "rectangle", label: "Rectangle / Square", path: "M3 6h18v12H3z" },
  { kind: "l-shaped", label: "L-shaped", path: "M5 3v18h16v-6H11V3z" },
  { kind: "notched", label: "Notched example", path: "M3 4h18v16h-6v-8H9v8H3z" },
  { kind: "custom", label: "Custom polygon", path: "M4 8l8-5 8 6-3 12-12-3z" },
] as const;

export default function ConfigurationForm({
  id,
  onSubmit,
  submittedDraft,
  onDraftChange,
  onDirtyChange,
  initialDraft,
  inheritedSite,
  focusOnMount = false,
}: ConfigurationFormProps) {
  const { register, handleSubmit, getValues, setValue, setFocus, clearErrors, control, getFieldState, formState } =
    useForm<ConfigurationDraft, unknown, Configuration>({
      resolver: zodResolver(configurationSchema),
      defaultValues: inheritedSite === undefined
        ? initialDraft ?? initialConfigurationDraft
        : {
          ...(initialDraft ?? initialConfigurationDraft),
          site: { kind: "custom", json: JSON.stringify(inheritedSite) },
        },
      mode: "onBlur",
    });
  const preferencesDetails = useRef<HTMLDetailsElement>(null);
  const targetDetails = useRef<HTMLDetailsElement>(null);
  const [initialPreferencesOpen] = useState(Boolean(initialDraft?.preferences.preferred_floor_count || initialDraft?.preferences.preferred_footprint_area_m2));
  const [initialTargetOpen] = useState(Boolean(initialDraft?.targets.gfa_target_m2));
  const draft = useWatch({ control });
  const siteKind = draft.site?.kind;
  const parsedSite = siteInputSchema.safeParse(draft.site);
  const customSiteError = getFieldState("site.json", formState).error;
  const draftChanged = submittedDraft !== undefined &&
    JSON.stringify(draft) !== JSON.stringify(submittedDraft);
  useEffect(() => onDraftChange?.(draftChanged), [draftChanged, onDraftChange]);
  useEffect(() => onDirtyChange?.(formState.isDirty), [formState.isDirty, onDirtyChange]);
  useEffect(() => {
    if (focusOnMount) setFocus("hard_constraints.setback_m");
  }, [focusOnMount, setFocus]);

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
        <label htmlFor={id}>{label}{!required && <span className={styles.visuallyHidden}> (optional)</span>}</label>
        <input
          id={id}
          type="text"
          inputMode={integer ? "numeric" : "decimal"}
          aria-required={required}
          aria-invalid={Boolean(error)}
          aria-describedby={`${id}-hint${error ? ` ${id}-error` : ""}`}
          {...register(name)}
        />
        <p className={styles.inputHint} id={`${id}-hint`}>{hint}</p>
        {error && <p className={styles.fieldError} id={`${id}-error`} role="alert">{error.message}</p>}
      </div>
    );
  }

  return (
    <form
      id={id}
      className={`${shared.panel} ${styles.form}`}
      aria-label="Massing configuration"
      noValidate
      onSubmit={(event) => {
        // RHF exposes nested draft references; capture the submission before later edits.
        const submittedDraft = structuredClone(getValues());
        void handleSubmit((configuration) => onSubmit({
          ...configuration,
          // Branch previews use the selected saved site's geometry even though the
          // shared draft schema retains a site field for validation.
          site: structuredClone(inheritedSite ?? configuration.site),
        }, submittedDraft), (errors) => {
          // Optional fields stay mounted. Reveal invalid groups before RHF focuses
          // their first error, so a collapsed section cannot hide a failed submission.
          if (errors.preferences && preferencesDetails.current) preferencesDetails.current.open = true;
          if (errors.targets && targetDetails.current) targetDetails.current.open = true;
        })(event);
      }}
    >
      <h2 className={styles.visuallyHidden}>{inheritedSite === undefined ? "Shape your massing" : "Shape your branch"}</h2>
      <div className={styles.formSections}>
        <fieldset className={styles.section} aria-label={inheritedSite === undefined ? undefined : "Inherited site (read-only)"}>
          <legend><span className={styles.step} aria-hidden="true">1</span><span>Site outline</span></legend>
          <p className={styles.sectionHint}>{inheritedSite === undefined
            ? "Choose an example or draw a custom boundary."
            : "The saved parent’s site is inherited and cannot be changed in this branch."}</p>
          {inheritedSite === undefined && <>
            <div className={styles.siteShapes} role="group" aria-label="Site shape">
              {siteShapes.map(({ kind, label, path }) => <button
                type="button"
                key={kind}
                aria-pressed={siteKind === kind}
                onClick={() => selectSite(kind)}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d={path} /></svg>
                {label}
              </button>)}
            </div>
            {siteKind === "rectangle" && <div className={`${styles.fieldGrid} ${styles.siteInputs}`}>
              {numericField("site.width", "Width (m)", "Greater than zero. Equal width and length create a square.", true)}
              {numericField("site.length", "Length (m)", "Greater than zero. Local y direction.", true)}
            </div>}
            {siteKind === "l-shaped" && <p className={styles.visuallyHidden}>
              A concave L-shaped site with an inward corner. Choose Custom polygon to edit its coordinates.
            </p>}
            {siteKind === "notched" && <p className={styles.visuallyHidden}>
              A deep notch can split or collapse the buildable area. Choose Custom polygon to edit its coordinates.
            </p>}
            {siteKind === "custom" && <CustomSiteEditor
              value={draft.site?.kind === "custom" ? draft.site.json ?? "" : ""}
              jsonField={register("site.json")}
              error={customSiteError?.message}
              onChange={(json) => {
                clearErrors("site");
                setValue("site.json", json, { shouldDirty: true });
              }}
            />}
          </>}
          <DraftSitePreview geometry={inheritedSite ?? (parsedSite.success ? parsedSite.data : null)} inherited={inheritedSite !== undefined} />
          {inheritedSite === undefined && <p className={styles.siteHint}>Changing shape replaces the outline only.</p>}
        </fieldset>

        <fieldset className={styles.section}>
          <legend><span className={styles.step} aria-hidden="true">2</span><span>Hard constraints</span></legend>
          <p className={styles.sectionHint}>Setbacks, coverage, floor and height limits.</p>
          <div className={styles.fieldGrid}>
            {numericField("hard_constraints.setback_m", "Setback (m)", "Zero or greater.", true)}
            {numericField("hard_constraints.floor_to_floor_m", "Floor-to-floor height (m)", "Greater than zero.", true)}
            {numericField("hard_constraints.max_height_m", "Maximum height (m)", "Greater than zero when set.")}
            {numericField("hard_constraints.max_floors", "Maximum floor count", "A positive whole number.", false, true)}
            {numericField("hard_constraints.site_coverage_ratio", "Site coverage ratio", "Greater than 0, up to 1 (for example, 0.6).")}
            {numericField("hard_constraints.max_footprint_m2", "Maximum footprint (m²)", "Greater than zero when set.")}
          </div>
          <p className={styles.fieldsetHint}>Set at least one maximum: height or floor count.</p>
        </fieldset>

        <details className={styles.optionalSection} ref={preferencesDetails} open={initialPreferencesOpen}>
          <summary>
            <span className={styles.step} aria-hidden="true">3</span>
            <span><strong>Design preferences</strong><span className={styles.summaryHint}>Optional floor and area preferences</span></span>
            {formState.errors.preferences && <span className={styles.errorBadge}>Check values</span>}
          </summary>
          <fieldset>
            <legend className={styles.visuallyHidden}>Design preferences</legend>
            <p className={styles.fieldsetHint}>Leave blank for automatic choices. Hard constraints take priority.</p>
            <div className={styles.fieldGrid}>
              {numericField("preferences.preferred_floor_count", "Preferred floor count", "A positive whole number.", false, true)}
              {numericField("preferences.preferred_footprint_area_m2", "Preferred footprint (m²)", "Greater than zero when set.")}
            </div>
          </fieldset>
        </details>

        <details className={styles.optionalSection} ref={targetDetails} open={initialTargetOpen}>
          <summary>
            <span className={styles.step} aria-hidden="true">4</span>
            <span><strong>GFA target</strong><span className={styles.summaryHint}>Specify a target gross floor area</span></span>
            {formState.errors.targets && <span className={styles.errorBadge}>Check values</span>}
          </summary>
          <fieldset>
            <legend className={styles.visuallyHidden}>GFA target</legend>
            {numericField("targets.gfa_target_m2", "GFA target (m²)", "A desired minimum, zero or greater. Leave blank for no target.")}
          </fieldset>
        </details>
      </div>

    </form>
  );
}
