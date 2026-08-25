import { runMonitoringScan } from "../routes/monitoring";

const run = await runMonitoringScan("scheduled");
console.log(JSON.stringify({
  id: run.id,
  status: run.status,
  requestedCount: run.requestedCount,
  processedCount: run.processedCount,
  signalsCreated: run.signalsCreated,
  sourceErrorCount: run.sourceErrorCount,
}));