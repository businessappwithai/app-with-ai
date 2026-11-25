import { createFileRoute } from "@tanstack/react-router";
import { ADDetailShell } from "@/components/admin/ad-detail-shell";
import { TAB_LEVEL } from "@/components/admin/ad-window-configs";

export const Route = createFileRoute("/admin/tab/$tabId/")({
  component: TabDetailPage,
});

function TabDetailPage() {
  const { tabId } = Route.useParams();
  return <ADDetailShell level={TAB_LEVEL} recordId={tabId} parentContext={[]} />;
}
