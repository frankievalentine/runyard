import { useEffect, useState } from "react";
import { Panel, Row } from "../tt.tsx";
import { Note, RowText, SIcon, rowButton } from "./parts.tsx";

/** Chrome and Edge's install prompt, held until the button asks for it. */
type InstallPrompt = Event & { prompt: () => Promise<void> };

let held: InstallPrompt | null = null;
const listeners = new Set<() => void>();
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    held = e as InstallPrompt;
    listeners.forEach((l) => l());
  });
}

const installed = () =>
  window.matchMedia?.("(display-mode: standalone)").matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

/** Installing Runyard on the home screen: the browser's prompt where there is one, else how. */
export function InstallPanel() {
  const [prompt, setPrompt] = useState(held);
  const [how, setHow] = useState(false);
  useEffect(() => {
    const update = () => setPrompt(held);
    listeners.add(update);
    return () => void listeners.delete(update);
  }, []);
  const secure = window.isSecureContext;
  const install = async () => {
    if (!prompt) return setHow(!how);
    await prompt.prompt();
    held = null;
    setPrompt(null);
  };
  return (
    <Panel id="install" title="Install the app">
      <Row className="!border-t-0">
        <SIcon name="phone" />
        <RowText
          title={installed() ? "Runyard is installed" : "Runyard on your home screen"}
          detail="Opens full screen and shows the last board when your tailnet drops. Needs HTTPS: your Tailscale address works."
        />
        {!installed() && secure && (
          <button
            type="button"
            className={rowButton.primary}
            onClick={() => void install()}
            aria-expanded={prompt ? undefined : how}
          >
            Install
          </button>
        )}
      </Row>
      {!installed() && !secure && (
        <Note>
          This address is plain HTTP, so the browser won't install it. Open Runyard at its tailnet
          address to install it.
        </Note>
      )}
      {how && (
        <Note>
          On iPhone and iPad: Share, then Add to Home Screen. In Chrome or Edge: the install button
          in the address bar. In Safari on a Mac: File, then Add to Dock.
        </Note>
      )}
    </Panel>
  );
}
