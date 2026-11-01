# Frontend — building geometry case study

Vite + React with strict TypeScript, a typed configuration form, a backend massing
preview workspace with explicit immutable root saves and child branches, and a
Saved Options explorer that opens complete persisted snapshots. TanStack Query
owns server results; React Hook Form owns configuration drafts.

## Getting started

Use Node.js 20.19+, 22.13+, or a newer supported LTS release.

```bash
npm ci
npm run dev        # http://localhost:5173
```

The backend base URL defaults to `http://localhost:8000`; override with
`VITE_API_BASE` (see `.env.example`). With the root `docker compose up`, both run together.

## Frontend structure

- `src/api/api.ts` — health, preview, root/branch save, option-detail, list, and tree clients.
- `src/api/contracts.ts` — Zod contracts inferred as strict TypeScript types.
- `src/queryClient.ts` — reusable QueryClient factory and application instance.
- `src/App.tsx` — backend health, the configuration workspace, and Saved Options.
- `src/features/massing/configuration.ts` — typed draft parsing using existing Zod API contracts.
- `src/features/massing/siteGeometry.ts` — deterministic rectangle and supplied-example input coordinates.
- `src/features/massing/ConfigurationForm.tsx` — accessible site, constraint, preference, and target inputs.
- `src/features/massing/DraftSitePreview.tsx` — immediate outline of the active site draft, with its own CSS Module.
- `src/features/massing/MassingWorkspace.tsx` — new-root, saved-option, and branch-draft sessions.
- `src/features/massing/SavedOptionSnapshot.tsx` — read-only saved metadata, configuration, and result.
- `src/features/massing/MassingResult.tsx` — shared SVG, feasibility, metrics, assessments, and diagnostics.
- `src/features/options/SaveOption.tsx` — optional naming, explicit root/branch saves, and saved-snapshot receipts.
- `src/features/options/SavedOptionsExplorer.tsx` — paginated root discovery, nested branches, and explicit workspace navigation.
- `src/features/options/optionQueries.ts` — shared option-detail, list, and tree query keys.
- `src/features/massing/DetailedMetrics.tsx` — site/setback, hard bounds, generated capacity, and actual metrics.
- `src/features/massing/PreferenceAssessments.tsx` — backend footprint preference and GFA target assessments.
- `src/features/massing/FeasibilitySummary.tsx` — feasibility, reason, and hard-constraint satisfaction.
- `src/features/massing/Diagnostics.tsx` — backend diagnostics and accessible detail disclosures.
- `src/features/massing/metricFormatting.ts` — display-only numeric formatting.
- `src/features/visualization/svgGeometry.ts` — pure display bounds, viewport fitting, and SVG paths.
- `src/features/visualization/SitePlan.tsx` — independent read-only SVG geometry layers and legend.
- `src/styles.css` — document defaults, base typography, design tokens, and keyboard focus styling.
- `src/vite-env.d.ts` — types the optional `VITE_API_BASE` environment variable.

Feature modules and their tests live together under `src/features/`; API
transport tests live beside the client in `src/api/`. Shared fixtures and test setup
stay in `src/test/`. Application entry points, global styles, and QueryClient setup remain
at the root. Imports use direct relative paths.

Comparison and 3D views are planned separately; see
[the design note](../docs/DESIGN.md).

## Styling

Component styles live beside their owners in `.module.css` files and are imported
explicitly through scoped class names. `App.module.css` owns the page container and
header; the massing components own their form, workspace, metrics, feasibility,
and diagnostic styles. `PreferenceAssessments` uses the shared result styles directly.

`src/features/massing/massing.module.css` contains the feature's common panels,
panel headings, eyebrows, result sections, and metric rows. Reuse these classes
within the feature rather than duplicating them or adding global component selectors.
Global CSS remains limited to document defaults, typography, shared custom properties,
and accessibility defaults. No additional styling dependency is required.

The desktop workspace gives the results column more space for the plan.
Responsive rules stay with their owners: the header and workspace stack at 900 px;
page/panel padding and the form field grid adjust at 520 px. Status and validation
styles retain their existing data and accessibility attributes.

## Commands

```bash
npm run dev        # dev server
npm run typecheck  # strict TypeScript validation
npm run lint       # ESLint checks
npm run test       # run automated tests once
npm run build      # typecheck, then production build
npm run preview    # preview the build
```

ESLint uses a flat configuration with TypeScript, React Hooks, and React Refresh
rules. Generated files and dependencies are excluded.

Vitest and React Testing Library cover draft parsing, accessible form validation,
preview/save/branch transport, integrated SVG layers, all feasibility states, request
failures, draft/result separation, parent immutability, duplicate-save protection,
save/preview races, cancellation, cache remounts, saved summaries and recursive trees,
complete snapshot reads/identity validation, saved-workspace navigation, protected
replacement, restored branching, root pagination, explorer selection/expansion,
refresh, and existing health behavior.
Tests use jsdom and stub the fetch boundary; no running backend is required.
Test sources are type checked.

Workspace geometry fixtures in `src/test/backendPreviewFixtures.json` capture real
backend responses, retaining configuration, geometry, and metrics together. The
tests check scalable SVG markup; actual layout and overflow need browser verification.

Focused SVG utility and component tests cover the supplied rectangle, L-shaped, and
notched sites, holes, split setback regions, missing layers, orientation, fitting,
accessibility, and deterministic rendering without input mutation.

Vite 6 and Vitest 4 share `vite.config.js`. Their minimum versions include
development-tooling security fixes. Jest DOM stays on 6.9 to retain Node 20 support.

## Configuration inputs

`ConfigurationForm` uses React Hook Form with the Zod resolver. Its typed draft is
parsed by `src/features/massing/configuration.ts`, reusing the API contracts for
numeric bounds. The **Site shape** selector offers:

- **Rectangle**: editable Width and Length in metres, initially 40 × 25 m. Positive
  finite decimal dimensions produce a closed, axis-aligned Polygon at the local
  origin. Empty, zero, negative, or invalid dimensions block submission and show
  inline errors; a previously valid rectangle is never submitted instead.
- **L-shaped example**: the supplied concave site, demonstrating setbacks around a
  reflex corner.
- **Notched example**: the supplied deep-notch site, whose setback can split or
  collapse the buildable region.
- **Custom Polygon (advanced)**: an editable GeoJSON Polygon with a closed exterior
  ring and optional closed hole rings. It starts from the current valid Polygon.
  If rectangle dimensions are invalid, it starts empty and asks for valid JSON.

The example vertices match `data/sites/` exactly, with only the first position
appended to close each ring. Small frontend coordinate constants keep the existing
Docker build context unchanged; tests compare them with the source files.
Choosing another preset intentionally replaces the active site draft; returning to
Rectangle restores 40 × 25 m. Switching shapes preserves constraints, preferences,
and the target, and never submits a preview automatically.

**Live draft site** shows a compact outline inside the site inputs, before any
submission. Its SVG is named **Draft site preview** for assistive technology. It
reads the watched RHF site through the same `siteInputSchema` used for submission
and reuses the existing SVG bounds, fitting, and path utilities. Holes remain open
through even-odd filling. Invalid dimensions or JSON/coordinate structure, and
coordinates that cannot be fitted safely, show an unavailable message instead of
retaining the last valid outline. This is unvalidated input: an outline does not
establish valid topology, buildability, or feasibility.

Only the selected site's fields are active in the form. Zod builds the request's
existing `site` Polygon from that draft; selection and dimension fields are not sent
to the API. Client checks cover JSON/coordinate structure, ring closure, numeric
inputs, and the required height-or-floor cap. Topology, capacity, preference
compatibility, and feasibility remain backend decisions.

The initial constraints are a 3 m setback, 3.5 m floor-to-floor height, and six-floor
cap; other constraints, preferences, and the target start blank. Blank optional
numbers become `null`; zero setbacks and zero GFA targets are preserved. Inline
errors are associated with their labeled inputs, and invalid submission focuses
the first error.

## Preview workflow

Choose **Generate Preview** to submit the validated draft. Editing does not send
requests or change the generated backend plan or metrics. The separate draft
outline updates immediately. A notice beside the backend result identifies
changes since the last submission, including site selection, dimension edits, and
invalid drafts. Returning to exactly the submitted draft clears the notice;
formatting-only edits also count as changes.

Each submission starts a new request, including retries with unchanged inputs.
Pending requests are cancelled when superseded or unmounted, and their results
cannot replace the active request. A new submission clears the previous backend plan,
metrics, and diagnostics while loading. Failed requests show a summary and backend
field paths/messages when available; correcting the inputs and submitting again
retries explicitly.

Successful responses show feasibility, an SVG site plan above the detailed metrics,
and grouped site/setback, capacity, actual massing, preference, and target measurements.
The prominent footprint area, floor count, height, and GFA summarize the selected
building. Theoretical hard upper
bounds do not guarantee a constructible footprint; generated default capacity
describes demonstrated construction before preferences and target-driven floor
selection. All values come directly from the response.

`feasible_target_unmet`, `infeasible`, and `generation_failed` are domain results;
they do not become HTTP errors. Null metrics display **Not available**. Numeric
display uses at most two decimal places; nonzero magnitudes below 0.01 display
**<0.01** (positive) or **>-0.01** (negative). Signed footprint differences preserve
the sign, using scientific notation below 0.01. Floor/component counts stay integers;
site coverage is a ratio with up to four decimals, using **<0.0001** for smaller
positive values. Formatting never changes response values. Missing preferences and
targets display **Not requested**, while a zero target displays **0 m²**. Null
shortfalls and undershoots stay unavailable instead of being inferred as zero.
The frontend constructs site input coordinates only; result geometry, capacity, and
metrics come from the backend. Previews are not saved.

Feasibility shows the backend reason when supplied and hard-constraint satisfaction
as **True**, **False**, or **Unknown**. A missed GFA target does not imply a hard
constraint violation, and generation failure does not establish mathematical
infeasibility. Diagnostics show severity, code, message, and optional path verbatim.
Native **Details** disclosures expose additional backend fields, preserving primitive
values and numeric precision. An empty list displays **No diagnostics reported**.
Superseding requests and request failures remove all previous result sections.

## Save root option

After a successful backend preview, **Save Option** submits that preview's original
configuration to `POST /api/v1/options` while the workspace is creating a root.
All four feasibility statuses can be saved, including diagnostic snapshots with no
building footprint. Saving is explicit;
editing, generating, and reloading never save automatically. A changed draft,
including an invalid or formatting-only edit, disables saving until Generate Preview
submits it successfully. Restoring the exact submitted draft re-enables saving.

The option name is optional. Empty UI input leaves the option unnamed; supplied
names are trimmed, must contain 1–200 Unicode characters, and cannot contain NUL.
Whitespace-only names are invalid. Validation errors appear beside the input. The
request contains only the submitted site, hard constraints, preferences, targets,
and optional name.
It contains no parent identifier, draft controls, computed geometry, or metrics.

The backend recomputes before persisting and returns HTTP 201 with a complete
immutable snapshot. The receipt reads the returned name, UUID, and status, so it
describes what was actually saved. The existing plan and metrics continue to show
the preview response; saving never replaces or mutates it. Each explicit subsequent
save creates a distinct root, even with unchanged inputs and name.

Pending saves disable the name field and save action, with a synchronous submission
guard preventing repeated events before React updates. Configuration editing and
preview generation remain available. Save state belongs to one preview attempt:
generating another preview removes its receipt and detaches its pending mutation.
That save may still complete on the server, but its late response cannot appear
beside the newer preview. Reloading also clears the workspace and receipt; it does
not delete PostgreSQL snapshots. The [Saved Options explorer](#saved-options)
discovers persisted histories independently of the workspace and its receipts.

Structured HTTP errors retain backend field paths. A network failure, malformed
success response, or server error cannot establish that nothing was saved: the
server may have inserted a snapshot before the response was lost. The UI reports
that uncertainty and explains that another explicit save could create a duplicate.
Saves have no automatic retry, reconnection replay, or cancellation presented as
rollback. Request idempotency is a possible future backend improvement.

## Branch from a saved option

Choose **Create Branch** on a successful root or child receipt, or on an opened
[saved snapshot](#open-a-saved-option), to select that exact option as the parent.
This starts a new editing session using the parent's saved hard constraints,
preferences, and target. Replacing active work requires the explicit confirmation
described below. The previous preview clears, and no preview request is sent until
**Generate Preview**.
The selected parent's name and UUID remain visible above the form across subsequent
preview attempts, including failures. Its saved site is inherited and read-only;
the site shape and geometry controls are unavailable in branch mode. The compact
outline is labeled **Inherited site**, with the accessible name **Inherited site
preview**. It displays the saved boundary and holes; **Generate Preview** calculates
the branch massing from that site and the edited building inputs.

Edit the existing constraint, preference, and target fields, then choose **Generate
Preview**. A successful current preview enables **Save Branch** with an optional
child name, using the same naming and draft-validation rules as root saving.
The branch request is sent to `POST /api/v1/options/{parent_id}/branches` with only
the complete replacement `hard_constraints`, `preferences`, `targets`, and optional
`name`. It never sends `site`, `site_geometry`, `parent_id`, computed geometry, or
results. The backend loads the parent site, recomputes, and returns HTTP 201 with a
new immutable snapshot. The receipt shows the returned child name, UUID, parent
UUID, and feasibility status; all four statuses and diagnostic snapshots are supported.

Editing or saving a branch never changes its parent's saved configuration or result.
The saved response also never replaces the current preview. A changed or invalid
draft blocks saving until a successful preview of that draft, including when an
earlier pending preview finishes after the edit. Pending duplicate submissions are
blocked. Generating another preview detaches its previous save receipt; a late save
response cannot appear in another parent session or preview attempt.

**Save Another Branch** creates another sibling under the same selected parent.
To branch from the newly saved child instead, choose **Create Branch** on its receipt.
Choose **Start New Root** to clear the branch session and return to the initial root
configuration, confirming replacement when active work would be discarded. Neither
action persists a snapshot. Reload clears the session and receipts while PostgreSQL
retains every saved option. Use Saved Options to reopen any persisted root or nested
child after reload and create further branches from it.

Branch errors use the existing structured messages and field paths. A missing parent
returns `404 PARENT_OPTION_NOT_FOUND`; the selected parent's identity remains visible
for diagnosis. Use **Start New Root** to continue with a new root, or open a different
option through Saved Options. Network failures, server errors, and malformed success
responses can leave the outcome unknown:
the child may have been saved, and another explicit save may
create a duplicate sibling. Branch mutations have no automatic retry or reconnect
replay, and leaving a session does not establish server rollback.

## Saved Options

The independent **Saved Options** section discovers persisted root options on page
load; **Browse saved options** in the page header jumps to it. Choose a root to
request its complete decision tree, then use the native
branch controls to expand or collapse children and selection buttons to inspect a
node. Selection has a visible state and a read-only summary with the saved name,
UUID, parent relationship, feasibility status, and metrics. Unnamed options remain
identifiable by UUID; missing actual metrics display **Not available**. All four
feasibility statuses are preserved. On opening a history, its root starts selected
and expanded, with deeper branches collapsed. Switching roots resets node selection
and expansion.

Root discovery uses `GET /api/v1/options?limit=50&offset=…`. That endpoint lists
roots and children together, newest first. The explorer filters roots for display
after receiving each page, while pagination advances by the number of unfiltered
summaries. **Load more options** requests one further page per action. A full page
containing only children does not establish an empty root list or the end of history: the UI
explains that more saved options can be searched. A short page establishes that all
current summaries have been checked. This bounds each interaction without hiding
older roots behind child-heavy pages. Offset boundaries can shift during concurrent
inserts. **Refresh saved options** refetches already loaded pages sequentially,
starting with the newest. Refresh errors retain the last loaded options or tree
with an explicit notice.

The selected root uses `GET /api/v1/options/tree?root_id={uuid}`. The returned nested
`children` arrays define every relationship and sibling order; the browser neither
sorts them nor reconstructs them from save receipts. Switching roots isolates the
requests and never substitutes another root's tree. Loading, empty history, request
errors, malformed responses, and missing selected roots have explicit states and
recovery controls. Root-only histories are valid trees with no children.

Successful saves invalidate option discovery; child saves also invalidate tree
queries because the parent can belong to any cached ancestor history.
**Refresh saved options** also refreshes discovery and the selected tree for
externally saved options or an uncertain save outcome. The explorer reads server
responses directly from TanStack Query; selected root/node identifiers and expanded
branches are local interaction state. Reload discovers persisted history again
rather than restoring the previous browser selection.

Browsing, expanding, and selecting nodes send no geometry-computation or write
requests and leave the current draft, preview, and branch parent unchanged. Use the
selected node's explicit **Open in Workspace** action to retrieve its complete
snapshot. Complete subtree responses and a native nested list suit small decision
histories; large-history search, server-side root filtering, and subtree pagination
remain future improvements. Comparison follows in PR 5.6.

### Open a saved option

Select a root or any nested child, then choose **Open in Workspace**. The workspace
retrieves `GET /api/v1/options/{option_id}`; tree summaries are never used as complete
snapshots. Loading and retrieval errors keep the current workspace intact. A missing
option, malformed response, or response for another UUID shows an explicit error
with recovery controls. A newer navigation or editing session supersedes an older
request, so late responses cannot replace the current content.

The opened **Saved Option** is read-only and identifies its name, UUID, parent,
versions, and creation time. It shows the stored site, hard constraints, preferences,
and target alongside the saved feasibility, SVG plan, metrics, assessments, and
diagnostics. The same result components present saved values and generated previews,
with a clear saved-snapshot label. Null configuration fields display **Not set**;
null result metrics display **Not available**, and zero values remain zero. Opening
sends no POST request, recalculates no massing, and writes nothing. Successful
navigation moves focus to the workspace heading and brings it into view.

**Create Branch** initializes an editable **Branch Draft** from that saved option.
Its exact UUID becomes the parent and its site, including holes, is inherited
read-only. The stored result remains historical; a branch requires an explicit new
preview before saving a separate child. **Start New Root** opens the initial editable
root configuration. These sessions are distinct from the read-only Saved Option.

### Replacing active work

Opening another option, selecting a receipt as a new branch parent, or starting a
new root must not silently replace an active draft. After the target snapshot is
loaded and validated, an inline confirmation offers **Keep Editing** and **Discard
Draft and Open**. Root/branch transitions use **Discard Draft and Continue**. Keeping
the draft preserves its fields and preview. Invalid edits and edits made before the
first preview are protected, as are a generated preview, a name draft, and a pending save.
Any preview attempt continues to count as active work after saving, because the
save recomputes a separate snapshot rather than persisting that preview response.

While a saved option loads, the current editor stays available. Replacement uses
only the latest validated request for that editing session. Edits made while loading
are included in the replacement check; changing sessions or choosing Keep Editing
prevents the superseded navigation from replacing current work. Leaving a
session does not cancel or roll back an accepted save. Its completion still refreshes
saved-option discovery, while its receipt cannot appear in a different session.
Reload clears browser interaction state; persisted snapshots remain in PostgreSQL.

## SVG plan renderer

`MassingResult` mounts `SitePlan` from the selected successful TanStack Query response,
alongside that response's metrics and diagnostics. Preview and saved views share this
presentation; all four geometry fields pass through unchanged. Empty, pending, and
preview-error states mount no viewer; infeasible and generation-failed results show
available site/setback context with an explicit missing-footprint message. Draft
edits retain this submitted backend plan while the separate outline in the form
reflects the current site inputs. Opening another saved option leaves the current
workspace visible until retrieval and any replacement confirmation succeed.

`SitePlan` also works independently. It needs no Query provider, API request, or
application state:

```tsx
<SitePlan
  siteGeometry={result.site_geometry}
  buildableGeometry={result.buildable_geometry}
  selectedBuildableGeometry={result.selected_buildable_geometry}
  footprintGeometry={result.footprint_geometry}
/>
```

Only `siteGeometry` is required. Geometry props reuse the existing response types;
the complete buildable region accepts Polygon or MultiPolygon, while the site,
selected component, and actual footprint accept Polygon, including interior holes.
Pass the backend's actual `footprint_geometry`. Default-generation geometry is a
separate capacity result and must never stand in for a missing selected building.

The site establishes one bounding box for every layer. The pure `geometryBounds`,
`createViewportTransform`, and `geometryPath` utilities fit that frame with uniform
scale, centered spare space, padding, and upward-positive world y coordinates.
Each ring becomes a closed subpath; even-odd fills preserve holes independently of
winding. Source vertex order and numeric precision are retained without rounding,
simplification, topology repair, component selection, area calculations, or
construction of new domain geometry.

The default logical viewport is 640 × 400 with 24 units of padding on every side.
Optional `width`, `height`, and `padding` props control the logical fit; sizes must
be finite and positive, and finite non-negative padding must leave a positive interior.
The SVG scales responsively to its container using `xMidYMid meet`. Padding scales
with the viewport; strokes retain their screen width. Fills, solid/dashed strokes,
and a visible legend distinguish the four layers. An instance-specific SVG title
and description identify displayed context and missing building geometry.

Omitted, null, or empty optional layers draw no paths. Available site/setback context
remains visible when the footprint is missing, with an explicit unavailable message.
An empty or unprojectable site frame displays an unavailable message and no paths;
it never fits an optional layer instead. These display guards do not validate
topology or determine feasibility. Pan/zoom, editing, and 3D
remain outside this component.

For browser smoke checks, run the app with its backend and select Rectangle,
L-shaped example, and Notched example in turn, submitting each explicitly.
The default rectangle and L-shaped site use a 3 m setback; the notched site at 3 m
shows two setback components. Select Custom Polygon to try the holed-site case in
`backend/tests/test_massing_preview_api.py`, using a zero setback. Check the legend,
hole openings, and selected component at desktop, tablet, 390 px, and 320 px widths.
Use a maximum height of 3 m with the floor cap blank to check infeasible context,
or a preferred footprint of `1e-30` to check generation failure with available
default capacity. A backend validation failure must remove the previous backend plan and
diagnostics; an unsubmitted edit must retain them with the changed-draft notice.

## Massing preview API

`previewMassing` posts a `MassingPreviewRequest` to `/api/v1/massing/preview`
using `VITE_API_BASE`. Omitted optional inputs stay omitted; explicit nulls and a
zero GFA target are preserved. Pass an `AbortSignal` to cancel superseded work.

The contracts mirror `backend/app/v1/schemas/massing.py` and validate responses at
runtime. Types are inferred from these schemas rather than maintained separately.
Parsing applies the backend's optional configuration defaults and accepts additive
response fields. Polygon holes, MultiPolygon setbacks, nullable metrics, preference
results, target assessments, and all four feasibility statuses are preserved.
An `infeasible` or `generation_failed` preview is a successful domain result.

Preview failures throw `ApiError`: `kind` distinguishes `http`, `network`, and
`malformed_response`; `status` retains the HTTP status when available, and `error`
contains a validated server error code, message, and field details when supplied.
Network failures retain their `cause`. Cancellation propagates its original reason.
The existing `getHealth()` behavior and errors remain unchanged.

Geometry validity and massing rules remain server-authoritative; response validation
checks transport shapes and numeric bounds, without recalculating domain results.
JavaScript numbers use binary64 precision; integer counts outside the safe integer
range are rejected rather than silently rounded.

`saveRootOption` reuses the massing request/result schemas and validates the complete
saved metadata, configuration, and nested result at runtime. It strips unknown
request fields, requires HTTP 201 and a null root `parent_id`, and preserves the same
`ApiError` categories and structured details. Its response remains separate from
the preview. `saveBranchOption(parentId, request)` reuses these schemas, sends only
replacement building configuration/name fields, and requires HTTP 201 with the
requested parent UUID.

The option-list and tree GET clients use the same API base, cancellation, and
`ApiError` conventions. Zod summary contracts reuse saved metadata, metrics, and
feasibility schemas; the recursive tree schema adds required `children` arrays.
Types are inferred from those schemas. Parsing preserves nullable names/parents and
metrics, UUIDs, timezone-aware timestamps, and all four statuses. These endpoints
return summaries only, without configuration or geometry.

`getOption(optionId, signal)` validates the complete response with the existing
`OptionResponse` Zod schema, requires HTTP 200, and checks that its UUID matches the
requested option. It preserves stored configuration/result fields and uses the same
`ApiError` categories, structured HTTP details, and AbortSignal cancellation. A
missing option returns `404 OPTION_NOT_FOUND`. Reading a snapshot never invokes
preview or save endpoints.

## Server state

`main.tsx` mounts `QueryClientProvider` with the stable application `queryClient`.
`createQueryClient()` supplies the same defaults for isolated tests: queries remain
fresh for 30 seconds, inactive queries use the library's five-minute retention,
and automatic retries and window-focus refetches are disabled. Mutations explicitly
disable retries because a repeated save would create another immutable snapshot.

The health display reads Query state directly, without copying it into local state.
Its reconnect refetch is disabled to preserve the existing check-on-mount behavior.
The preview key contains the parsed submitted configuration and a unique submission
ID, preventing cache reuse across explicit attempts or remounts. Query consumes the
API client's AbortSignal; results remain in Query without a local copy. Preview
queries are infinitely fresh for that attempt, with mount/reconnect refetch disabled
and network mode `always` so offline attempts surface an error. Unobserved results
use the library's five-minute retention. Submission snapshots and the draft-change
indicator are local interaction state. Saving uses `useMutation` with retries
disabled and network mode `always`, so offline attempts fail visibly instead of
being replayed on reconnect. Mutation data holds the returned snapshot directly;
the name draft and validation/submission interaction state remain local. Parent
selection has a separate session identity from preview attempts, so another preview
cannot silently discard or replace the selected immutable snapshot. Starting a new
parent session isolates its form and pending responses from the previous session.
Complete persisted snapshots use `['options', 'detail', optionId]`, with UUID keys
normalized to lowercase. Workspace navigation retains identifiers and session
identity rather than response copies. Read-only saved rendering reads that Query
data, and creating a branch derives a separate RHF draft through
`configurationDraftFromOption`. Form dirty state and
preview/save activity govern replacement protection rather than a duplicated
configuration store. Immutable detail snapshots remain fresh indefinitely, with
mount/reconnect refetch disabled and the standard inactive-cache retention. Explicit
retrieval uses network mode `always` and consumes the supplied AbortSignal. Successful
saves place the returned snapshot in its detail entry before refreshing discovery,
so branching from a receipt reuses the authoritative saved response.

Saved Options uses the `['options', 'list']` query namespace for paginated summaries
and `['options', 'tree', rootId]` for each selected history. Page responses and trees
remain in Query rather than component state. Every successful save invalidates
option-list queries even when its receipt is no longer mounted. Child saves also
invalidate tree queries. Saving does not change the preview query or select the
saved node automatically. The [explorer workflow](#saved-options) describes discovery,
refresh, and selection behavior.

## Browser smoke test

With the frontend and backend running:

1. Check backend health and the default Rectangle's **Live draft site** outline
   before submitting. Generate Preview and expect a separate backend plan with
   646 m² footprint, six floors, 21 m height, and 3,876 m² GFA.
2. Edit Width and Length, including decimals, without submitting: the draft outline
   updates while the backend plan and metrics stay unchanged and the draft notice
   appears. Empty, zero, negative, and non-numeric dimensions must replace the
   draft outline with its unavailable state, show inline errors on validation, and
   block submission. Correct them and submit to update the backend result.
3. Select L-shaped example and Notched example, checking that each selection alone
   updates only the draft outline and sends no preview request. Submit each and
   check the generated backend plan matches the selected site. Enter Custom Polygon
   and verify the current coordinates are available for editing. Switch presets
   again and check unrelated constraints and preferences remain intact.
4. Try a GFA target of 1,000,000 (target unmet, hard constraints satisfied), a preferred
   footprint of 300 m² (requested/effective/actual assessment), and a setback of 100
   (infeasible, actual metrics unavailable). Inspect diagnostic codes and details.
   A preferred floor count above the cap remains a backend validation error.
5. In Custom Polygon, enter malformed JSON to check inline errors and an unavailable
   draft outline. Remove both height/floor caps to check constraint errors; a valid
   site outline must remain visible. Try zero setback/target and a valid Polygon
   with a hole, checking its opening in both views after submission.
   Enter Custom from an invalid rectangle and verify no previous Polygon or outline
   is reused. A structurally valid outline still needs backend topology validation.
6. Generate the default preview, enter an optional name, and save. Check the receipt's
   returned name/UUID and retrieve `GET /api/v1/options/UUID`: expect null `parent_id`,
   complete configuration, metadata, and result. Edit or invalidate a draft and
   check saving is disabled while the submitted plan stays visible. Restore the
   submitted values, then explicitly save again and check for a different UUID.
   Repeat with an infeasible diagnostic preview.
7. Save a root, change an unsaved draft, then choose Create Branch from the receipt.
   Keep Editing first and check that fields and preview remain intact; repeat and
   explicitly discard. Check that the saved parent's configuration is restored, its
   UUID remains selected, the inherited site is read-only, and a new preview is required.
   Modify constraints, preferences, and target, preview explicitly, and Save Branch.
   Retrieve root and child by ID: expect distinct UUIDs, the root UUID as the child's
   `parent_id`, identical sites, and the unchanged complete root snapshot. Save another
   sibling, then use Create Branch on a child receipt to check nested branching.
   Exercise invalid drafts, backend preference errors, and diagnostic branch results.
   Reload: session/receipts clear, but GET must still return every unchanged snapshot.
   The explorer's read-only selection must not replace the current branch session.
8. In Saved Options, discover an existing root, select a history with siblings and
   a nested child, expand/collapse branches, and inspect node identifiers, parent
   links, statuses, and metrics. Check a diagnostic node with unavailable actual
   metrics. Save a new root and child through the workspace and verify discovery
   and the selected tree refresh. Reload and select the persisted history again.
   Use Load more options to reach older roots when recent pages contain children; a
   child-only page must not incorrectly end discovery. Switching roots must not
   show the previous root's tree or change the editor. Use Tab and Enter/Space for
   root selection, branch controls, node selection, and refresh.
9. After reload, select and open a persisted root, then a deeply nested child. Check
   that Open in Workspace sends only a detail GET, focuses the workspace, and shows
   the exact stored configuration, site geometry, metrics, status, and diagnostics.
   Check holes, nullable results, and all four feasibility statuses. Create Branch
   from the child, generate explicitly, and save a grandchild. Retrieve all snapshots:
   expect its selected parent UUID, the inherited site, distinct child identity, and
   unchanged historical values. Try failed/missing reads and rapidly switch options;
   no failure or older response may replace the current session. Repeat replacement
   cancellation with pre-preview/invalid edits, a name draft, and a pending save.
10. Check desktop layout and narrow viewports at 390 px and 320 px, including the
   selector, dimension fields, draft outline and unavailable state, backend plan,
   inherited site, parent identifiers, receipts, expanded diagnostic details, inline
   errors, Saved Options lists/tree/summary, saved configuration, replacement prompt,
   keyboard focus, and form submission. Reach Open in Workspace, Keep Editing,
   discard, Create Branch, and Save Branch with Tab and activate them with the keyboard.
   Request races, cancellation, network/malformed-response failures, and
   generation-failure rendering have focused automated coverage, as do duplicate
   save events, uncertain save failures, and late responses after new previews.

## Docker development

From the repository root, start the complete development stack:

```bash
docker compose up --build -d
docker compose ps
```

Open `http://localhost:5173` and verify that the page displays
`Backend health: healthy`. The backend health endpoint is
`http://localhost:8000/api/v1/health`. The frontend container runs the Vite
development server; `npm run build` produces the production bundle.
