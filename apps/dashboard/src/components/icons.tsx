/** fleet's icon set (aarondfrancis/fleet src/components/icons.tsx), with users and plus added and a cog for settings. */
export function Icon({ name, size = 14 }: { name: IconName; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.4,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (name) {
    case "search":
      return (
        <svg {...common}>
          <circle cx="6.8" cy="6.8" r="4.3" />
          <path d="m10 10 3.5 3.5" />
        </svg>
      );
    case "server":
      return (
        <svg {...common}>
          <rect x="2" y="2" width="12" height="5" rx="1.5" />
          <rect x="2" y="9" width="12" height="5" rx="1.5" />
          <path d="M5 4.5h.01M5 11.5h.01" />
        </svg>
      );
    case "inbox":
      return (
        <svg {...common}>
          <path d="m2 9 2-6h8l2 6v4H2zM2 9h4l1 2h2l1-2h4" />
        </svg>
      );
    case "grid":
      return (
        <svg {...common}>
          <rect x="2" y="2" width="5" height="5" rx="1.2" />
          <rect x="9" y="2" width="5" height="5" rx="1.2" />
          <rect x="2" y="9" width="5" height="5" rx="1.2" />
          <rect x="9" y="9" width="5" height="5" rx="1.2" />
        </svg>
      );
    case "queue":
      return (
        <svg {...common}>
          <path d="M3 4h10M3 8h10M3 12h6" />
        </svg>
      );
    case "chevron":
      return (
        <svg {...common}>
          <path d="M6 4l4 4-4 4" />
        </svg>
      );
    case "refresh":
      return (
        <svg {...common}>
          <path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.5V5h-2.5" />
        </svg>
      );
    case "machine":
      return (
        <svg {...common}>
          <rect x="2" y="3" width="12" height="8" rx="1.5" />
          <path d="M6 14h4M8 11v3" />
        </svg>
      );
    case "runner":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="5.5" />
          <path d="M7 5.8l2.6 2.2L7 10.2z" fill="currentColor" stroke="none" />
        </svg>
      );
    case "eye-off":
      return (
        <svg {...common}>
          <path d="M2 8s2.2-4 6-4 6 4 6 4-2.2 4-6 4-6-4-6-4z" />
          <path d="M3 13L13 3" />
        </svg>
      );
    case "alert":
      return (
        <svg {...common}>
          <path d="M8 2.5l6 10.5H2z" />
          <path d="M8 7v2.5M8 11.2v.1" />
        </svg>
      );
    case "external":
      return (
        <svg {...common}>
          <path d="M9 3h4v4M13 3L7.5 8.5M11 9.5V13H3V5h3.5" />
        </svg>
      );
    case "settings":
      // A cog. fleet's version was a circle with rays, which reads as a sun (a theme toggle).
      return (
        <svg {...common}>
          <path d="M6.68 3.07L7.07 1.37L8.93 1.37L9.32 3.07L10.55 3.58L12.03 2.65L13.35 3.97L12.42 5.45L12.93 6.68L14.63 7.07L14.63 8.93L12.93 9.32L12.42 10.55L13.35 12.03L12.03 13.35L10.55 12.42L9.32 12.93L8.93 14.63L7.07 14.63L6.68 12.93L5.45 12.42L3.97 13.35L2.65 12.03L3.58 10.55L3.07 9.32L1.37 8.93L1.37 7.07L3.07 6.68L3.58 5.45L2.65 3.97L3.97 2.65L5.45 3.58Z" />
          <circle cx="8" cy="8" r="2.2" />
        </svg>
      );
    case "check":
      return (
        <svg {...common}>
          <path d="M3.5 8.5l3 3 6-7" />
        </svg>
      );
    case "x":
      return (
        <svg {...common}>
          <path d="M4 4l8 8M12 4l-8 8" />
        </svg>
      );
    case "dash":
      return (
        <svg {...common}>
          <path d="M4.5 8h7" />
        </svg>
      );
    case "users":
      return (
        <svg {...common}>
          <circle cx="6" cy="5.5" r="2.5" />
          <path d="M1.8 13.5c.5-2.4 2.2-3.7 4.2-3.7s3.7 1.3 4.2 3.7M10.5 3.2a2.4 2.4 0 0 1 0 4.6M12 9.9c1.2.5 2 1.7 2.3 3.6" />
        </svg>
      );
    case "plus":
      return (
        <svg {...common}>
          <path d="M8 3.5v9M3.5 8h9" />
        </svg>
      );
    case "plan":
      return (
        <svg {...common}>
          <rect x="3" y="2.5" width="10" height="11" rx="1.5" />
          <path d="M5.5 6h5M5.5 8.5h5M5.5 11h3" />
        </svg>
      );
  }
}

export type IconName =
  | "search"
  | "server"
  | "inbox"
  | "grid"
  | "queue"
  | "chevron"
  | "refresh"
  | "machine"
  | "runner"
  | "eye-off"
  | "alert"
  | "external"
  | "settings"
  | "check"
  | "x"
  | "dash"
  | "plan"
  | "users"
  | "plus";
