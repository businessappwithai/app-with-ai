import { createFileRoute } from "@tanstack/react-router";
import { ADListShell } from "@/components/admin/ad-list-shell";
import { FIELD_LEVEL } from "@/components/admin/ad-window-configs";

export const Route = createFileRoute("/admin/fields")({
  component: FieldsListPage,
});

function FieldsListPage() {
  return <ADListShell level={FIELD_LEVEL} parentContext={[]} showAdminCrumb />;
}
