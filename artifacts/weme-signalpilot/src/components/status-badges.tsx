import { Candidate } from "@workspace/api-client-react";
import { Badge } from "@workspace/weme-earth-tones-system/components/ui/badge";

export function relevanceLabel(status: Candidate["relevanceStatus"]) {
  return {
    relevant: "Relevant",
    possible: "Mulig relevant",
    not_relevant: "Ikke relevant",
    needs_review: "Må vurderes",
    insufficient_data: "Utilstrekkelig data",
  }[status];
}

export function RelevanceBadge({ status }: { status: Candidate["relevanceStatus"] }) {
  const styles = {
    relevant: "border-primary/50 bg-primary/15 text-foreground",
    possible: "border-accent/60 bg-accent/20 text-foreground",
    not_relevant: "border-border bg-muted/50 text-muted-foreground",
    needs_review: "border-destructive/50 bg-destructive/10 text-destructive",
    insufficient_data: "border-accent/50 bg-accent/10 text-foreground",
  } satisfies Record<Candidate["relevanceStatus"], string>;

  return (
    <Badge variant="outline" className={`${styles[status]} text-[10px] font-semibold`}>
      {relevanceLabel(status)}
    </Badge>
  );
}

export function MonitoringBadge({ status }: { status: Candidate["monitoringStatus"] }) {
  return (
    <Badge
      variant="outline"
      className={
        status === "monitoring"
          ? "border-primary/50 bg-primary/15 text-foreground text-[10px] font-semibold"
          : "border-border bg-muted/40 text-muted-foreground text-[10px] font-semibold"
      }
    >
      {status === "monitoring" ? "Overvåkes" : "Ikke overvåket"}
    </Badge>
  );
}

export function PriorityBadge({ score }: { score: number }) {
  const style =
    score >= 25
      ? "border-primary/50 bg-primary/15 text-foreground"
      : score > 0
        ? "border-accent/60 bg-accent/20 text-foreground"
        : "border-border bg-muted/40 text-muted-foreground";

  return (
    <Badge variant="outline" className={`${style} text-[10px] font-semibold`}>
      Prioritet {score}
    </Badge>
  );
}