import { useEffect, useRef } from "react";

/**
 * A step's output as a terminal shows it: dark in both themes, following the
 * end while it runs unless the reader has scrolled up to look at something.
 */
export function Terminal({ text, running }: { text: string; running: boolean }) {
  const box = useRef<HTMLPreElement>(null);
  const following = useRef(true);
  useEffect(() => {
    const el = box.current;
    if (el && following.current) el.scrollTop = el.scrollHeight;
  }, [text]);
  return (
    <pre
      ref={box}
      onScroll={(e) => {
        const el = e.currentTarget;
        following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
      }}
      className="mt-1.5 max-h-80 overflow-auto rounded-md bg-[#0f1115] px-3 py-2.5 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-[#d7dae0] select-text"
    >
      {text || (running ? "" : "No output.")}
      {running && (
        <span className="ml-px inline-block h-[1.1em] w-[0.55em] translate-y-[2px] animate-pulse bg-[#d7dae0]" />
      )}
    </pre>
  );
}
