import { useEffect, useRef, useState, type CSSProperties } from "react";

/**
 * "Show more" for a Board panel's list, whose first `shown` items show until it's opened. On
 * desktop the opened list keeps the height it had and scrolls, so it doesn't stretch the Board
 * and the departure board beside it. So that the click visibly does something, the list then
 * slides the first new item into view; `atEnd` says when there's nothing more below, for a fade
 * and a hint. On phones, where the panels stack, the list just grows.
 */
export function useExpandInPlace(shown: number) {
  const [all, setAll] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  const [atEnd, setAtEnd] = useState(false);
  const toggle = () => {
    if (!all) {
      const desktop = window.matchMedia("(min-width: 1024px)").matches;
      setHeight(desktop ? (list.current?.offsetHeight ?? null) : null);
      setAtEnd(false);
    }
    setAll(!all);
  };
  const scrolls = all && height !== null;

  useEffect(() => {
    const el = list.current;
    const next = el?.children[shown] as HTMLElement | undefined;
    if (!scrolls || !el || !next) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({
      top: next.offsetTop + next.offsetHeight - el.clientHeight + 8,
      behavior: reduced ? "auto" : "smooth",
    });
  }, [scrolls, shown]);

  const onScroll = () => {
    const el = list.current;
    if (el) setAtEnd(el.scrollTop + el.clientHeight >= el.scrollHeight - 2);
  };
  const style: CSSProperties | undefined = scrolls ? { maxHeight: height } : undefined;
  return { all, toggle, list, style, scrolls, atEnd, onScroll };
}
