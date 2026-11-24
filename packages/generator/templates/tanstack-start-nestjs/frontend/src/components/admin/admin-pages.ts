import type { ElementType } from "react";
import {
  AppWindow,
  BarChart3,
  Database,
  FileText,
  GitBranch,
  Hash,
  History,
  LayoutList,
  Printer,
  Settings,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  Tags,
  UserCog,
  Users,
} from "lucide-react";

export interface AdminPage {
  title: string;
  description: string;
  icon: ElementType;
  to: string;
}

/**
 * The single list of admin pages — drives both the dashboard cards and the
 * sidebar navigation so the two are always identical.
 *
 * Order here is the order shown on the dashboard and in the sidebar.
 * Every top-level route under /admin/ has an entry here.
 */
export const ADMIN_PAGES: AdminPage[] = [
  {
    title: "Table and Column",
    description: "Browse database tables and their column definitions in master/detail view",
    icon: Database,
    to: "/admin/tables",
  },
  {
    title: "Window, Tab and Field",
    description: "Manage application windows with nested tabs and field configurations",
    icon: AppWindow,
    to: "/admin/windows",
  },
  {
    title: "Element",
    description: "Manage system elements — column names, print names, and descriptions",
    icon: FileText,
    to: "/admin/elements",
  },
  {
    title: "Reference",
    description: "Manage data types, validation rules, and lookup definitions",
    icon: Hash,
    to: "/admin/references",
  },
  {
    title: "Entity Categories",
    description: "Organise entities into named groups shown on the dashboard and sidebar",
    icon: Tags,
    to: "/admin/categories",
  },
  {
    title: "Field Layout Manager",
    description: "Customize field order, visibility, and grouping with drag-and-drop",
    icon: LayoutList,
    to: "/admin/fields",
  },
  {
    title: "Rules & Workflows",
    description:
      "Write the rules that judge a write, and the lifecycles, processes and status machines around it",
    icon: Settings,
    to: "/admin/automations",
  },
  {
    title: "Workflow Definitions",
    description: "View the workflows declared in the model — sagas, lifecycles and state machines",
    icon: GitBranch,
    to: "/admin/workflow-definitions",
  },
  {
    title: "Workflow Run History",
    description: "Monitor workflow execution history, status and step-level details",
    icon: History,
    to: "/admin/workflows",
  },
  {
    title: "User Management",
    description: "Create and manage application users, assign roles, and control account status",
    icon: Users,
    to: "/admin/users",
  },
  {
    title: "Role Management",
    description: "Create and manage roles that define what users may do in this application",
    icon: UserCog,
    to: "/admin/roles",
  },
  {
    title: "Access Controls",
    description: "Grant or revoke entity-level read, create, update and delete permissions per role",
    icon: Shield,
    to: "/admin/access-controls",
  },
  {
    title: "Audit Log",
    description: "Immutable tamper-proof audit trail of all user and system actions",
    icon: ShieldCheck,
    to: "/admin/audit",
  },
  {
    title: "Report Designs",
    description:
      "Design printable document reports for each entity; users get a Print button on their records",
    icon: Printer,
    to: "/admin/reports",
  },
  {
    title: "Analysis",
    description: "The questions this model declared with %%report, answered against this database",
    icon: BarChart3,
    to: "/admin/analysis",
  },
  {
    title: "System Configuration",
    description:
      "Runtime settings: AI endpoints, feature toggles, rate limits, and application identity",
    icon: SlidersHorizontal,
    to: "/admin/system-config",
  },
];
