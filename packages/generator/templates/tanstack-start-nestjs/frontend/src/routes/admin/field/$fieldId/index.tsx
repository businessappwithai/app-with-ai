import { createFileRoute } from "@tanstack/react-router";
import { ADDetailShell } from "@/components/admin/ad-detail-shell";
import { FIELD_LEVEL } from "@/components/admin/ad-window-configs";

export const Route = createFileRoute("/admin/field/$fieldId/")({
  component: FieldDetailPage,
});

function FieldDetailPage() {
  const { fieldId } = Route.useParams();
  return <ADDetailShell level={FIELD_LEVEL} recordId={fieldId} parentContext={[]} />;
}
