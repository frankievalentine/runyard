import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { sshKeyQuery } from "../lib/queries.ts";
import { CodeBlock } from "./machine/parts.tsx";

/** Runyard's public key, to copy into a machine's authorized_keys. */
export function SshKeyCard() {
  const { data: key, isPending } = useQuery(sshKeyQuery);
  if (isPending) return null;
  return key ? (
    <div className="flex flex-col gap-2">
      <CodeBlock text={key.line} label="Runyard's public key" />
      <p className="text-[12px] text-tt-ink-3">
        <span className="font-board">{key.fingerprint}</span>. The setup command adds this key to a
        machine. Your own keys still work.
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
