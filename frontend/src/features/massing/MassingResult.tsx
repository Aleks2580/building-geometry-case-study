import type { MassingPreviewResponse } from "../../api/contracts";
import SitePlan from "../visualization/SitePlan";
import DetailedMetrics from "./DetailedMetrics";
import Diagnostics from "./Diagnostics";
import FeasibilitySummary from "./FeasibilitySummary";
import PreferenceAssessments from "./PreferenceAssessments";

export default function MassingResult({ result }: { result: MassingPreviewResponse }) {
  return <>
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
  </>;
}
