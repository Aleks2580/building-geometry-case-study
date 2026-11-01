import type { MassingPreviewResponse } from "../../api/contracts";
import MassingVisualization from "../visualization/MassingVisualization";
import DetailedMetrics from "./DetailedMetrics";
import Diagnostics from "./Diagnostics";
import FeasibilitySummary from "./FeasibilitySummary";
import PreferenceAssessments from "./PreferenceAssessments";

export default function MassingResult({ result }: { result: MassingPreviewResponse }) {
  return <>
    <FeasibilitySummary feasibility={result.feasibility} />
    <MassingVisualization result={result} />
    <DetailedMetrics result={result} />
    <PreferenceAssessments result={result} />
    <Diagnostics diagnostics={result.feasibility.diagnostics} />
  </>;
}
