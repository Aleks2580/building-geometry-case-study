// Minimal API client. Point at the backend; override with VITE_API_BASE if needed.
const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8000";

export interface HealthResponse {
  status: string;
}

export async function getHealth(): Promise<HealthResponse> {
  const res = await fetch(`${API_BASE}/api/v1/health`);
  if (!res.ok) throw new Error(`health check failed: ${res.status}`);
  const data: unknown = await res.json();
  if (
    typeof data !== "object" ||
    data === null ||
    !("status" in data) ||
    typeof data.status !== "string"
  ) {
    throw new Error("invalid health response");
  }
  return { status: data.status };
}

// TODO(candidate): add the calls for your massing / options API here, e.g.
//   export async function createMassing(payload) { ... }
//   export async function branchOption(id, payload) { ... }
//   export async function listOptions() { ... }
