import { createFileRoute } from "@tanstack/react-router";
import { ADListShell } from "@/components/admin/ad-list-shell";
import { TAB_LEVEL } from "@/components/admin/ad-window-configs";

export const Route = createFileRoute("/admin/tabs")({
  component: TabsListPage,
});

function TabsListPage() {
  return <ADListShell level={TAB_LEVEL} parentContext={[]} showAdminCrumb />;
}
