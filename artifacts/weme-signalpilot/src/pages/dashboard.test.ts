import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

test("monitoring start errors keep the existing dashboard queue visible", async () => {
  const dashboardSource = await readFile(
    fileURLToPath(new URL("./dashboard.tsx", import.meta.url)),
    "utf8",
  );

  assert.match(
    dashboardSource,
    /Kjøringen kunne ikke startes\./,
  );
  assert.match(
    dashboardSource,
    /const \{ data: latestRun, isLoading: isLoadingRun \} = useGetLatestMonitoringRun\(\);/,
  );
  assert.match(
    dashboardSource,
    /runMutation\.isError/,
  );
});