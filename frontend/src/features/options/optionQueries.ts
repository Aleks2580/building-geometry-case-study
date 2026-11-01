export const optionKeys = {
  all: ["options"] as const,
  lists: () => ["options", "list"] as const,
  list: () => ["options", "list", "paginated"] as const,
  trees: () => ["options", "tree"] as const,
  tree: (rootId: string | null) => ["options", "tree", rootId] as const,
};
import type { QueryClient } from "@tanstack/react-query";


export async function refreshOptionQueries(client: QueryClient, includeTrees: boolean) {
  const namespaces = includeTrees ? [optionKeys.lists(), optionKeys.trees()] : [optionKeys.lists()];
  // Invalidation alone reuses initial reads without cached data. Cancel those GETs
  // first so a response started before a save or explicit refresh cannot become fresh.
  await Promise.all(namespaces.map((queryKey) => client.cancelQueries({ queryKey })));
  await Promise.all(namespaces.map((queryKey) => client.invalidateQueries({ queryKey })));
}
