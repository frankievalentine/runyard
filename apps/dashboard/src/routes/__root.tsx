import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Link, Outlet } from "@tanstack/react-router";
import { ThemeMenu } from "../components/ThemeMenu.tsx";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: Layout,
});

const navLink =
  "flex h-7 items-center rounded-[6px] px-2 text-ink-2 hover:bg-hover data-[status=active]:bg-selected data-[status=active]:text-ink";

function Layout() {
  return (
    <div className="flex h-full">
      <aside className="flex w-56 shrink-0 flex-col border-r border-line bg-sidebar">
        <div className="px-4 pt-4 pb-3 text-[14px] font-semibold">Runyard</div>
        <nav className="flex flex-col gap-px px-2">
          <Link to="/" className={navLink}>
            Overview
          </Link>
        </nav>
        <div className="mt-auto p-2">
          <ThemeMenu />
        </div>
      </aside>
      <main className="scroll min-w-0 flex-1 px-8 py-6">
        <Outlet />
      </main>
    </div>
  );
}
