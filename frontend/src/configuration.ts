import { z } from "zod";
import { massingPreviewRequestSchema } from "./api/contracts";

const decimalNumber = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

const requiredNumberDraft = z.string().trim().transform((value, context) => {
  if (value === "") {
    context.addIssue({ code: "custom", message: "Enter a number." });
    return z.NEVER;
  }
  const number = Number(value);
  if (!decimalNumber.test(value) || !Number.isFinite(number)) {
    context.addIssue({ code: "custom", message: "Enter a finite decimal number." });
    return z.NEVER;
  }
  return number;
});

const optionalNumberDraft = z.string().trim().transform((value, context) => {
  if (value === "") return null;
  const parsed = requiredNumberDraft.safeParse(value);
  if (!parsed.success) {
    context.addIssue({ code: "custom", message: "Enter a finite decimal number or leave blank." });
    return z.NEVER;
  }
  return parsed.data;
});

const siteDraft = z.string().transform((value, context) => {
  let input: unknown;
  try {
    input = JSON.parse(value);
  } catch {
    context.addIssue({ code: "custom", message: "Enter valid Polygon JSON." });
    return z.NEVER;
  }
  const parsed = massingPreviewRequestSchema.shape.site.strict().safeParse(input);
  if (!parsed.success) {
    context.addIssue({
      code: "custom",
      message: "Enter a Polygon object with at least one ring of four or more [x, y] positions using finite numbers.",
    });
    return z.NEVER;
  }
  for (const [index, ring] of parsed.data.coordinates.entries()) {
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      context.addIssue({
        code: "custom",
        message: `Close ring ${index + 1} by repeating its first [x, y] position at the end.`,
      });
    }
  }
  return parsed.data;
});

const hardFields = massingPreviewRequestSchema.shape.hard_constraints.shape;
const preferenceFields = massingPreviewRequestSchema.shape.preferences.unwrap().shape;
const targetFields = massingPreviewRequestSchema.shape.targets.unwrap().shape;

// Validate transport structure here; topology and capacity use the backend's
// geometry engine and numerical policy, so drafts must not repair or approximate them.
export const configurationSchema = z.object({
  site: siteDraft,
  hard_constraints: z.object({
    setback_m: requiredNumberDraft.pipe(hardFields.setback_m),
    floor_to_floor_m: requiredNumberDraft.pipe(hardFields.floor_to_floor_m),
    max_height_m: optionalNumberDraft.pipe(hardFields.max_height_m.unwrap()),
    max_floors: optionalNumberDraft.pipe(hardFields.max_floors.unwrap()),
    site_coverage_ratio: optionalNumberDraft.pipe(hardFields.site_coverage_ratio.unwrap()),
    max_footprint_m2: optionalNumberDraft.pipe(hardFields.max_footprint_m2.unwrap()),
  }).refine((value) => value.max_height_m !== null || value.max_floors !== null, {
    path: ["max_floors"],
    message: "Enter a maximum height or maximum floor count (or both).",
  }),
  preferences: z.object({
    preferred_floor_count: optionalNumberDraft.pipe(preferenceFields.preferred_floor_count.unwrap()),
    preferred_footprint_area_m2: optionalNumberDraft.pipe(preferenceFields.preferred_footprint_area_m2.unwrap()),
  }),
  targets: z.object({
    gfa_target_m2: optionalNumberDraft.pipe(targetFields.gfa_target_m2.unwrap()),
  }),
});

export type ConfigurationDraft = z.input<typeof configurationSchema>;
export type Configuration = z.output<typeof configurationSchema>;

export const initialConfigurationDraft: ConfigurationDraft = {
  site: JSON.stringify({
    type: "Polygon",
    coordinates: [[[0, 0], [40, 0], [40, 25], [0, 25], [0, 0]]],
  }, null, 2),
  hard_constraints: {
    setback_m: "3",
    floor_to_floor_m: "3.5",
    max_height_m: "",
    max_floors: "6",
    site_coverage_ratio: "",
    max_footprint_m2: "",
  },
  preferences: {
    preferred_floor_count: "",
    preferred_footprint_area_m2: "",
  },
  targets: { gfa_target_m2: "" },
};
