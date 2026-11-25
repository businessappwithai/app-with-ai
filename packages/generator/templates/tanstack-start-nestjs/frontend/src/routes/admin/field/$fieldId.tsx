import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/field/$fieldId")({
  component: FieldLayout,
});

function FieldLayout() {
  return <Outlet />;
}
