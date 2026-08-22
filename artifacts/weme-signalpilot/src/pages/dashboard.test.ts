import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

test("refresh errors keep the existing dashboard summary visible", async () => {
  const dashboardSource = await readFile(
    fileURLToPath(new URL("./dashboard.tsx", import.meta.url)),
    "utf8",
  );

  assert.match(
    dashboardSource,
    /Oppfriskningen mislyktes\. Forrige kjente resultat vises fortsatt\./,
  );
  assert.match(
    dashboardSource,
    /const \{ data: summary, isLoading: isLoadingSummary \} = useGetDashboardSummary\(\);/,
  );
  assert.doesNotMatch(
    dashboardSource,
    /onError:[\s\S]*setSummary|setSummary[\s\S]*onError/,
  );
});