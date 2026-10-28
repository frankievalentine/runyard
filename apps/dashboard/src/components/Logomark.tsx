import { useEffect, useId, useState } from "react";

/** Whether the viewer asked their system for less motion; SVG animation can't check this itself. */
function useReducedMotion(): boolean {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const media = window.matchMedia?.(query);
    if (!media) return;
    const update = () => setReduced(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return reduced;
}

/**
 * Runyard's mark, "Sunset run": an orange locomotive pulling its train across
 * an evening yard. `small` is the simplified badge for sizes under about 40 px.
 * With reduced motion it's a still frame, the train mid-crossing.
 */
export function Logomark({ size = 48, small = false }: { size?: number; small?: boolean }) {
  // useId's colons aren't safe inside url(#…).
  const clip = `runyard-${useId().replace(/[^a-zA-Z0-9-]/g, "")}`;
  const still = useReducedMotion();
  return small ? (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      role="img"
      aria-label="Runyard"
      className="shrink-0"
    >
      <defs>
        <clipPath id={clip}>
          <rect width="24" height="24" rx="6" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        <rect width="24" height="24" fill="#F3B27A" />
        <rect width="24" height="7" fill="#F7D1A6" />
        <circle cx="16" cy="11" r="4.5" fill="#FDE7C2" />
        <rect y="14.5" width="24" height="9.5" fill="#6A4136" />
        <path d="M0 19.6 H24" stroke="#2A1A17" strokeWidth="1" />
        <g transform={still ? "translate(6 0)" : undefined}>
          {!still && (
            <animateTransform
              attributeName="transform"
              type="translate"
              values="-16 0;30 0"
              dur="6s"
              repeatCount="indefinite"
            />
          )}
          <rect x="0" y="11" width="4" height="7.5" rx="0.6" fill="#E8732A" />
          <rect x="3.5" y="13.5" width="9" height="5" rx="0.6" fill="#E8732A" />
          <rect x="0.8" y="12" width="2.4" height="1.8" rx="0.3" fill="#2B2420" />
        </g>
      </g>
    </svg>
  ) : (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      role="img"
      aria-label="Runyard"
      className="shrink-0"
    >
      <defs>
        <clipPath id={clip}>
          <rect width="64" height="64" rx="14" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        <rect width="64" height="20" fill="#F7D1A6" />
        <rect y="20" width="64" height="12" fill="#F3B27A" />
        <rect y="32" width="64" height="10" fill="#EC9461" />
        <circle cx="44" cy="31" r="8" fill="#FDE7C2" opacity="0.95" />
        <g fill="#B46A4F" opacity="0.55">
          <rect x="2" y="34" width="6" height="8" />
          <rect x="9" y="31" width="4" height="11" />
          <rect x="14" y="35" width="5" height="7" />
          <rect x="50" y="33" width="5" height="9" />
          <rect x="56" y="36" width="8" height="6" />
        </g>
        <path
          d="M21 42 L24 22 L27 42 M21.9 36 H26.1 M22.7 30 H25.3 M23.4 25 H24.6 M21 42 L26.1 36 M27 42 L21.9 36 M21.9 36 L25.3 30 M26.1 36 L22.7 30"
          stroke="#8A4D3B"
          strokeWidth="0.7"
          fill="none"
        />
        <path
          d="M8 43 V31 M5 32 H11 M37 43 V31 M34 32 H40 M58 43 V31 M55 32 H61 M8 33 C 20 35, 25 35, 37 33 M37 33 C 47 35, 50 35, 58 33"
          stroke="#7A4536"
          strokeWidth="0.6"
          fill="none"
        />
        <rect y="42" width="64" height="22" fill="#6A4136" />
        <rect y="53" width="64" height="11" fill="#5A362E" />
        <path
          d="M0 50 H64 M0 59 H64"
          stroke="#3F2722"
          strokeWidth="2.6"
          strokeDasharray="0.8 1.6"
        />
        <path
          d="M0 49.3 H64 M0 50.7 H64 M0 58.3 H64 M0 59.7 H64"
          stroke="#C98A63"
          strokeWidth="0.5"
        />
        <rect x="4" y="51" width="16" height="7" rx="0.8" fill="#A5482F" />
        <rect x="23" y="52" width="16" height="6" rx="3" fill="#8E3B26" />
        <rect x="42" y="51" width="18" height="7" rx="0.8" fill="#4E7A58" />
        <g transform={still ? "translate(30 0)" : undefined}>
          {!still && (
            <animateTransform
              attributeName="transform"
              type="translate"
              values="-20 0;106 0"
              dur="10s"
              repeatCount="indefinite"
            />
          )}
          <rect x="-40" y="42" width="19" height="7" rx="3.5" fill="#A4A7A9" />
          <rect x="-20" y="41" width="19" height="8" rx="0.8" fill="#3F6B4D" />
          <path d="M-16 41 V49 M-11 41 V49 M-6 41 V49" stroke="#335A40" strokeWidth="0.6" />
          <rect x="0" y="37" width="7" height="12" rx="0.9" fill="#E8732A" />
          <rect x="6" y="41" width="12" height="8" rx="0.9" fill="#E8732A" />
          <rect x="1.5" y="38.5" width="4" height="2.6" rx="0.4" fill="#2B2420" />
          <rect x="0" y="46" width="18" height="1.2" fill="#F3B27A" />
          <circle cx="17.2" cy="43.5" r="0.8" fill="#FFF1C4" />
          <g fill="#2A1A17">
            {[3, 7, 12, 16, -17, -4, -37, -24].map((cx) => (
              <circle key={cx} cx={cx} cy="49.4" r="1.1" />
            ))}
          </g>
        </g>
      </g>
    </svg>
  );
}
