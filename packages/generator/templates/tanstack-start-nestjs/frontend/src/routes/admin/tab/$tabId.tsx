import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/tab/$tabId")({
  component: TabLayout,
});

function TabLayout() {
  return <Outlet />;
}
