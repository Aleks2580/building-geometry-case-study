import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getHealth } from "./api/api";
import type { HealthResponse } from "./api/api";
import MassingWorkspace from "./features/massing/MassingWorkspace";
import SavedOptionsExplorer from "./features/options/SavedOptionsExplorer";
import "./styles.css";
import styles from "./App.module.css";

export default function App() {
  const [openRequest, setOpenRequest] = useState<{ optionId: string; requestId: string } | null>(null);
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
    <main className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>Building Geometry Case Study</p>
          <h1>Explore a building massing</h1>
          <p>Configure a site and its rules, then generate a backend-calculated preview.</p>
          <a className={styles.savedOptionsLink} href="#saved-options">Browse saved options</a>
        </div>
        <p className={styles.health}>Backend health: <strong>{health}</strong></p>
      </header>
      <MassingWorkspace openRequest={openRequest} />
      <SavedOptionsExplorer onOpenOption={(optionId) => setOpenRequest({ optionId, requestId: crypto.randomUUID() })} />
    </main>
  );
}
