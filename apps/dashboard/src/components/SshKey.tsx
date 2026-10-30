import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { sshKeyQuery } from "../lib/queries.ts";
import { CopyValue } from "./CopyValue.tsx";
import { Card } from "./ui.tsx";

/** Runyard's public key, to copy into a machine's authorized_keys. */
export function SshKeyCard() {
  const { data: key, isPending } = useQuery(sshKeyQuery);
  if (isPending) return null;
  return (
    <Card className="flex max-w-3xl flex-col gap-2 px-4 py-3 text-[13px]">
      {key ? (
        <>
          <CopyValue
            value={key.line}
            label="Runyard's public key"
            className="font-mono text-[12px]"
            truncate
          />
          <p className="text-[12px] text-ink-2">
            {key.fingerprint}. The setup command adds this key to a machine. Your own keys still
            work.
          </p>
        </>
      ) : (
        <p className="text-[12.5px] text-ink-2">
          Runyard couldn't create its SSH key and is using the Runyard host's keys.{" "}
          <Link to="/settings/account" className="text-accent hover:underline">
            Fix it in Getting started
          </Link>
        </p>
      )}
    </Card>
  );
}
