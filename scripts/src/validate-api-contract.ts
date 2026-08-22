import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(import.meta.url), "../../..");
const openapiPath = resolve(root, "lib/api-spec/openapi.yaml");
const routesPath = resolve(root, "artifacts/api-server/src/routes/candidates.ts");
const clientPath = resolve(root, "lib/api-client-react/src/generated/api.ts");

const candidateOperations = [
  ["GET", "/candidates", "listCandidates", "query"],
  ["GET", "/candidates/:id", "getCandidate", "query"],
  ["POST", "/candidates/import", "importCandidateSnapshots", "mutation"],
  ["POST", "/candidates/:id/evidence", "addCandidateEvidence", "mutation"],
  ["PATCH", "/candidates/:id/relevance", "updateCandidateRelevance", "mutation"],
  ["PATCH", "/candidates/:id/monitoring", "updateCandidateMonitoring", "mutation"],
  ["POST", "/candidates/analysis-batches", "createCandidateAnalysisBatch", "mutation"],
] as const;

const responseTypeByStatus: Record<string, string> = {
  "400": "BadRequestResponse",
  "404": "NotFoundResponse",
  "409": "ConflictResponse",
};

function routeStatuses(source: string, method: string, route: string): string[] {
  const start = source.indexOf(`router.${method.toLowerCase()}("${route}"`);
  assert.notEqual(start, -1, `Candidate route is missing from server source: ${method} ${route}`);
  const end = source.indexOf("\nrouter.", start + 1);
  const handler = source.slice(start, end === -1 ? source.length : end);
  return [...handler.matchAll(/res\.status\((\d{3})\)/g)]
    .map((match) => match[1])
    .filter((status) => Number(status) >= 400);
}

function documentedStatuses(spec: string, operationId: string): string[] {
  const start = spec.indexOf(`operationId: ${operationId}`);
  assert.notEqual(start, -1, `Candidate operation is missing from OpenAPI: ${operationId}`);
  const nextPath = spec.indexOf("\n  /", start + 1);
  const operation = spec.slice(start, nextPath === -1 ? spec.indexOf("\ncomponents:", start) : nextPath);
  const responsesStart = operation.indexOf("responses:");
  assert.notEqual(responsesStart, -1, `OpenAPI operation has no responses: ${operationId}`);
  return [...operation.slice(responsesStart).matchAll(/^\s{8}"?(\d{3})"?\s*:/gm)].map((match) => match[1]);
}

function generatedErrorTypes(client: string, operationId: string, kind: "query" | "mutation"): string {
  const suffix = kind === "query" ? "QueryError" : "MutationError";
  const typeName = operationId[0].toUpperCase() + operationId.slice(1);
  const match = client.match(new RegExp(`export type ${typeName}${suffix} = ErrorType<([^>]+)>`));
  assert.ok(match, `Generated client error type is missing: ${typeName}${suffix}`);
  return match[1];
}

const [spec, source, client] = await Promise.all([
  readFile(openapiPath, "utf8"),
  readFile(routesPath, "utf8"),
  readFile(clientPath, "utf8"),
]);

for (const [method, route, operationId, kind] of candidateOperations) {
  const returned = routeStatuses(source, method, route);
  const documented = documentedStatuses(spec, operationId);
  for (const status of returned) {
    assert.ok(documented.includes(status), `${method} ${route} returns undocumented error status ${status}`);
    const responseType = responseTypeByStatus[status];
    assert.ok(responseType, `No generated response type mapping exists for status ${status}`);
    assert.match(
      generatedErrorTypes(client, operationId, kind),
      new RegExp(`\\b${responseType}\\b`),
      `${operationId} client error type does not include ${status} (${responseType})`,
    );
  }
}

console.log("API contract validation passed for candidate source endpoints.");