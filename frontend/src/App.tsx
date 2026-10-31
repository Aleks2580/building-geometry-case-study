import { useQuery } from "@tanstack/react-query";
import { getHealth } from "./api";
import type { HealthResponse } from "./api";

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
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", lineHeight: 1.5 }}>
      <h1>Building Geometry Case Study</h1>
      <p>
        Backend health: <strong>{health}</strong>
      </p>

      <section
        style={{
          marginTop: "1.5rem",
          border: "2px dashed #bbb",
          borderRadius: 8,
          padding: "2rem",
          color: "#666",
        }}
      >
        {/* TODO(candidate): build the visualization here.
            Render the site polygon, the buildable footprint, the resulting massing,
            and the metrics. Let the user create options, branch them, and navigate
            the decision tree. Pick whatever rendering approach you can justify
            (2D canvas/SVG, 3D via three.js, …). Sample sites live in ../data/sites/. */}
        Visualization goes here.
      </section>
    </main>
  );
}
