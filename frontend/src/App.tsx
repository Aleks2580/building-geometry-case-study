import { useQuery } from "@tanstack/react-query";
import { getHealth } from "./api/api";
import type { HealthResponse } from "./api/api";
import MassingWorkspace from "./features/massing/MassingWorkspace";
import "./styles.css";

export default function App() {
  const { data, error, isPending, isError } = useQuery<HealthResponse, unknown>({
    queryKey: ["health"],
    queryFn: getHealth,
    refetchOnReconnect: false,
  });
  const message = error instanceof Error ? error.message : String(error);
  const health = isPending
    ? "checking…"
    : isError ? `unreachable (${message})` : data.status;

  return (
    <main>
      <header className="page-header">
        <div>
          <p className="eyebrow">Building Geometry Case Study</p>
          <h1>Explore a building massing</h1>
          <p>Configure a site and its rules, then generate a backend-calculated preview.</p>
        </div>
        <p className="health">Backend health: <strong>{health}</strong></p>
      </header>
      <MassingWorkspace />
    </main>
  );
}
