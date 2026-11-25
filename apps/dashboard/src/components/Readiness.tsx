import {
  readinessProblems,
  type MachineView,
  type ReadinessItem,
  type ReadinessTier,
} from "@runyard/core";
import { InfoTip, TipText } from "./InfoTip.tsx";
import { InlineCode, Kv, Kvh, type DotTone } from "./machine/parts.tsx";

const TIERS: [ReadinessTier, string, string][] = [
  ["required", "Required", "Jobs fail without these."],
  ["label", "Its pools' labels", ""],
  ["recommended", "Recommended", ""],
];

const tone: Record<ReadinessItem["status"], DotTone> = {
  ok: "ok",
  missing: "bad",
  warn: "warn",
  unknown: "unknown",
};

/** Readiness in a few words, for the folded section's note. */
export function readinessNote(m: MachineView): string {
  const r = m.readiness;
  if (!r) return "Not checked";
  const problems = readinessProblems(r).length;
  if (problems) return `${problems} to fix`;
  const unknown = r.items.filter((i) => i.status === "unknown").length;
  return unknown ? `${unknown} unknown` : "Ready";
}

/** Whether the machine has what its pools' jobs need, from its last check. */
export function RunnerReadiness({ m }: { m: MachineView }) {
  const r = m.readiness;
  if (!r)
    return (
      <p className="px-4 pt-1 pb-3 text-tt-ink-2">
        Not checked yet. Runyard checks once it can sign in.
      </p>
    );
  return (
    <>
      {r.capabilities.length > 0 && (
        <p className="px-4 pt-1 text-[12.5px] text-tt-ink-3">Has {r.capabilities.join(", ")}.</p>
      )}
      {TIERS.map(([tier, title, sub]) => {
        const items = r.items.filter((i) => i.tier === tier);
        if (!items.length) return null;
        return (
          <div key={tier}>
            <Kvh>{sub ? `${title}: ${sub.replace(/\.$/, "").toLowerCase()}` : title}</Kvh>
            {items.map((i) => (
              <Kv
                key={i.id}
                dot={tone[i.status]}
                label={
                  // Why it matters is in view when it isn't ok; a tooltip otherwise.
                  i.status === "ok" && i.detail ? (
                    <span className="inline-flex items-center gap-1">
                      {i.title}
                      <InfoTip label={i.title}>
                        <TipText what={i.detail} />
                      </InfoTip>
                    </span>
                  ) : (
                    i.title
                  )
                }
                value={i.value}
              >
                {i.status !== "ok" && (i.detail || i.command) ? (
                  <>
                    {i.detail && <span className="max-w-[60ch] leading-relaxed">{i.detail}</span>}
                    {i.command && <InlineCode text={i.command} />}
                  </>
                ) : null}
              </Kv>
            ))}
          </div>
        );
      })}
    </>
  );
}
