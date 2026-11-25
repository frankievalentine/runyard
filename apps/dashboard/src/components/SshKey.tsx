import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { sshKeyQuery } from "../lib/queries.ts";
import { CodeBlock } from "./machine/parts.tsx";
import { Clipped, InfoTip, TipText } from "./InfoTip.tsx";

/** Runyard's public key, to copy into a machine's authorized_keys. */
export function SshKeyCard() {
  const { data: key, isPending } = useQuery(sshKeyQuery);
  if (isPending) return null;
  return key ? (
    <div className="flex flex-col gap-2">
      <CodeBlock text={key.line} label="Runyard's public key" />
      <p className="flex min-w-0 items-center gap-1.5 text-[12px] text-tt-ink-3">
        <span className="min-w-0 font-board">
          <Clipped value={key.fingerprint} label="Fingerprint" />
        </span>
        <InfoTip label="Runyard's key">
          <TipText what="The setup command adds this key to a machine, so Runyard can sign in. Your own keys keep working." />
        </InfoTip>
      </p>
    </div>
  ) : (
    <p className="text-[12.5px] text-tt-ink-2">
      Runyard couldn't create its SSH key and is using the Runyard host's keys.{" "}
      <Link to="/settings/account" className="font-semibold text-tt-ink underline">
        Fix it in Getting started
      </Link>
    </p>
  );
}
