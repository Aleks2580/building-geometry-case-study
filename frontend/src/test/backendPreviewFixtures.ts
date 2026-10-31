import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { massingPreviewResponseSchema } from "../api/contracts";

type BackendPreviewFixture = "notched" | "holed" | "preferred" | "preferred_failed";

// Captured from preview_massing: supplied notched site, the API's holed-site test,
// and rectangle area preferences. Request configuration is retained in each response;
// geometry and its corresponding metrics must be refreshed together from the backend.
const responses = JSON.parse(readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "backendPreviewFixtures.json"), "utf8",
)) as Record<BackendPreviewFixture, unknown>;

export function backendPreviewResponse(name: BackendPreviewFixture) {
  return massingPreviewResponseSchema.parse(responses[name]);
}
