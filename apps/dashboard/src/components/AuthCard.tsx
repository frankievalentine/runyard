import type { ReactNode } from "react";
import { Card } from "./ui.tsx";

/** The centered card around the sign-in and setup forms. */
export function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-full items-center justify-center bg-bg p-4">
      <Card className="w-full max-w-sm px-6 py-6">
        <div className="text-[13px] font-semibold text-ink-2">Runyard</div>
        <h1 className="mt-1 text-[20px] font-semibold tracking-tight">{title}</h1>
        {children}
      </Card>
    </div>
  );
}
