import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  AppWindow,
  ArrowRight,
  Columns,
  Hash,
  Home,
  Layers,
  LayoutList,
  RefreshCw,
  Table2,
} from "lucide-react";
import { ADMIN_PAGES } from "@/components/admin/admin-pages";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { apiClient, type PaginatedResponse } from "@/lib/api-client";

export const Route = createFileRoute("/admin/")({
  component: AdminDashboardPage,
});

interface CountResponse {
  meta: { total: number };
}

function AdminDashboardPage() {
  const {
    data: tablesRes,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["admin", "tables-count"],
    queryFn: () => apiClient.get<CountResponse>("/sys/tables", { limit: 1 }),
  });
  const { data: columnsRes } = useQuery({
    queryKey: ["admin", "columns-count"],
    queryFn: () => apiClient.get<CountResponse>("/sys/columns", { limit: 1 }),
  });
  const { data: windowsRes } = useQuery({
    queryKey: ["admin", "windows-count"],
    queryFn: () => apiClient.get<CountResponse>("/sys/windows", { limit: 1 }),
  });
  const { data: tabsRes } = useQuery({
    queryKey: ["admin", "tabs-count"],
    queryFn: () => apiClient.get<CountResponse>("/sys/tabs", { limit: 1 }),
  });
  const { data: fieldsRes } = useQuery({
    queryKey: ["admin", "fields-count"],
    queryFn: () => apiClient.get<CountResponse>("/sys/fields", { limit: 1 }),
  });
  const { data: refsRes } = useQuery({
    queryKey: ["admin", "references-count"],
    queryFn: () => apiClient.get<CountResponse>("/sys/references", { limit: 1 }),
  });

  const stats = [
    { label: "Tables", count: tablesRes?.meta?.total || 0, icon: Table2, color: "text-blue-600 dark:text-blue-400" },
    {
      label: "Columns",
      count: columnsRes?.meta?.total || 0,
      icon: Columns,
      color: "text-indigo-600 dark:text-indigo-400",
    },
    {
      label: "Windows",
      count: windowsRes?.meta?.total || 0,
      icon: AppWindow,
      color: "text-violet-600 dark:text-violet-400",
    },
    { label: "Tabs", count: tabsRes?.meta?.total || 0, icon: Layers, color: "text-purple-600 dark:text-purple-400" },
    {
      label: "Fields",
      count: fieldsRes?.meta?.total || 0,
      icon: LayoutList,
      color: "text-pink-600 dark:text-pink-400",
    },
    {
      label: "References",
      count: refsRes?.meta?.total || 0,
      icon: Hash,
      color: "text-emerald-600 dark:text-emerald-400",
    },
  ];


  return (
    <div className="flex flex-col min-h-0">
      {/* Compact header */}
      <header className="border-b border-border bg-card px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              to="/dashboard"
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary transition-colors"
            >
              <Home className="h-3.5 w-3.5" />
              Back
            </Link>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground">Application Dictionary</h1>
              <p className="text-xs text-muted-foreground">Manage entities, field layouts, and configuration</p>
            </div>
          </div>
          {/* Stats inline */}
          <div className="hidden lg:flex items-center gap-3">
            {stats.map((stat) => (
              <div key={stat.label} className="flex items-center gap-1.5 text-sm">
                <stat.icon className={`h-3.5 w-3.5 ${stat.color}`} />
                <span className="font-semibold tabular-nums">{stat.count}</span>
                <span className="text-muted-foreground text-xs">{stat.label}</span>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
              <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>
      </header>

      {/* 4-column card grid — all 16 fit in 4 rows */}
      <div className="px-6 py-4">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {ADMIN_PAGES.map((page) => (
            <Link key={page.to} to={page.to}>
              <Card className="group hover:border-primary/50 transition-all cursor-pointer h-full">
                <CardHeader className="p-4">
                  <div className="flex items-center justify-between mb-1">
                    <page.icon className="h-5 w-5 text-primary" />
                    <ArrowRight className="h-3.5 w-3.5 text-primary opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                  <CardTitle className="text-sm font-semibold leading-tight">{page.title}</CardTitle>
                  <CardDescription className="text-xs line-clamp-2">{page.description}</CardDescription>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
