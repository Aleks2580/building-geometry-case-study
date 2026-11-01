import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getHealth } from "./api/api";
import type { HealthResponse } from "./api/api";
import MassingWorkspace from "./features/massing/MassingWorkspace";
import SavedOptionsExplorer from "./features/options/SavedOptionsExplorer";
import "./styles.css";
import styles from "./App.module.css";

const sections = {
  workspace: { label: "Workspace", title: "Explore a building massing", description: "Configure your site and constraints to generate a massing proposal." },
  "saved-options": { label: "Saved Options", title: "Your saved options", description: "Explore your decision history and branch from an existing design." },
  compare: { label: "Compare", title: "Compare design options", description: "Review two saved designs, their inputs, and their results." },
} as const;
type Section = keyof typeof sections;

function NavigationIcon({ section }: { section: Section | "brand" }) {
  const paths = {
    brand: "M4 21V7l8-4v18M12 9l8-4v16M2 21h20M7 9v2m0 3v2m9-5v2m0 3v2",
    workspace: "M3 10l9-7 9 7v11h-6v-7H9v7H3z",
    "saved-options": "M5 3h14v18l-7-4-7 4zM9 7h6",
    compare: "M3 5h7v14H3zM14 5h7v14h-7zM6 8h1M17 8h1",
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={paths[section]} />
  </svg>;
}

export default function App() {
  const [section, setSection] = useState<Section>("workspace");
  const [openRequest, setOpenRequest] = useState<{ optionId: string; requestId: string } | null>(null);
  const explorer = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const previousSection = useRef(section);
  const { data, error, isPending, isError } = useQuery<HealthResponse, unknown>({
    queryKey: ["health"],
    queryFn: getHealth,
    refetchOnReconnect: false,
  });
  const message = error instanceof Error ? error.message : String(error);
  const health = isPending
    ? "checking…"
    : isError ? `unreachable (${message})` : data.status;

  useEffect(() => {
    if (previousSection.current === section) return;
    previousSection.current = section;
    heading.current?.focus({ preventScroll: true });
    if (section !== "workspace" && explorer.current) explorer.current.scrollTop = 0;
  }, [section]);

  return (
    <div className={styles.shell}>
      <a className={styles.skipLink} href="#main-content">Skip to content</a>
      <aside className={styles.sidebar} aria-label="Application sidebar">
        <div className={styles.brand}>
          <span className={styles.brandIcon}><NavigationIcon section="brand" /></span>
          <div><span className={styles.brandName}>Building Geometry</span><span className={styles.brandCaption}>Massing Studio</span></div>
        </div>
        <nav className={styles.navigation} aria-label="Main navigation">
          <p className={styles.navigationLabel}>Design workspace</p>
          {(Object.keys(sections) as Section[]).map((item) => <button
            key={item}
            type="button"
            aria-current={section === item ? "page" : undefined}
            aria-controls={`${item}-view`}
            onClick={() => setSection(item)}
          >
            <NavigationIcon section={item} />
            <span>{sections[item].label}</span>
          </button>)}
        </nav>
        <div className={styles.sidebarFooter}>
          <span className={styles.footerMark} aria-hidden="true">BG</span>
          <div><strong>Building Geometry</strong><span>Case study · Local metres</span></div>
        </div>
      </aside>
      <main id="main-content" className={styles.main} tabIndex={-1}>
        <header className={styles.pageHeader}>
          <div>
            <p className={styles.eyebrow}>Building Geometry / {sections[section].label}</p>
            <h1 ref={heading} tabIndex={-1}>{sections[section].title}</h1>
            <p className={styles.description}>{sections[section].description}</p>
          </div>
          <p className={styles.health} role="status" data-state={isPending ? "pending" : isError ? "error" : "ready"}>
            <span className={styles.healthDot} aria-hidden="true" />
            <span>Backend health: <strong>{health}</strong></span>
          </p>
        </header>
        {/* These owners retain drafts, pending requests, and comparison choices.
            Section navigation must never remount them or bypass replacement guards. */}
        <div id="workspace-view" className={`${styles.sectionContent} ${styles.workspaceContent}`} hidden={section !== "workspace"}>
          <MassingWorkspace openRequest={openRequest} />
        </div>
        <div ref={explorer} className={styles.sectionContent} hidden={section === "workspace"}>
          <SavedOptionsExplorer
            activeView={section === "compare" ? "compare" : "saved-options"}
            onViewChange={setSection}
            onOpenOption={(optionId) => {
              setSection("workspace");
              setOpenRequest({ optionId, requestId: crypto.randomUUID() });
            }}
          />
        </div>
      </main>
    </div>
  );
}
