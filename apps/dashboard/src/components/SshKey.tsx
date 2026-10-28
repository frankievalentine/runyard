import { useQuery } from "@tanstack/react-query";
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
            {key.fingerprint}. Machines authorize this key so Runyard can sign in to them; a
            machine's setup command adds it for you. Your own keys and ~/.ssh/config still work too.
          </p>
        </>
      ) : (
        <p className="text-[12.5px] text-ink-2">
          Runyard couldn't create its own SSH key, so it uses this machine's keys only. See the SSH
          key check under Getting started.
        </p>
      )}
    </Card>
  );
}
