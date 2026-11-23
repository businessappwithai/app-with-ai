import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { WindowHelpButton } from '@/components/admin/window-help-button';
import { ADBreadcrumb } from '@/components/admin/ad-breadcrumb';
import { apiClient } from '@/lib/api-client';
import { Shield, ArrowLeft, Loader2, AlertCircle, Star, Check, ChevronRight } from 'lucide-react';
import { errorText } from '@/components/admin/row-actions';
import { toast } from 'sonner';

export const Route = createFileRoute('/admin/access-controls')({
  validateSearch: (search: Record<string, unknown>) => ({
    role: (search.role as string | undefined) ?? undefined,
  }),
  component: AccessControlsPage,
});

interface SysRole {
  sys_role_id: string;
  name: string;
  description?: string;
  is_master_role: boolean;
  is_active: boolean;
}

interface AccessGrant {
  sys_access_grant_id: string;
  kind: string;
  table_name: string;
  action: string;
}

interface TableMetadata {
  sys_table_id: string;
  table_name: string;
  name: string;
}

const OPERATIONS = ['read', 'create', 'update', 'delete'] as const;
type Op = (typeof OPERATIONS)[number];

const OP_LABEL: Record<Op, string> = {
  read: 'Read',
  create: 'Create',
  update: 'Update',
  delete: 'Delete',
};

function AccessControlsPage() {
  const { role: selectedRoleName } = Route.useSearch();
  const navigate = useNavigate({ from: '/admin/access-controls' });

  if (selectedRoleName) {
    return (
      <RolePermissionsView
        roleName={selectedRoleName}
        onBack={() => void navigate({ search: {} })}
      />
    );
  }
  return (
    <RoleListView onSelect={(name) => void navigate({ search: { role: name } })} />
  );
}

// ── List view ─────────────────────────────────────────────────────────────────

function RoleListView({ onSelect }: { onSelect: (name: string) => void }) {
  const navigate = useNavigate();
  const { data, isLoading, error } = useQuery<{ data: SysRole[] }>({
    queryKey: ['admin', 'sys-roles'],
    queryFn: () => apiClient.get('/sys/roles'),
  });

  const roles = data?.data ?? [];

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 bg-card border-b border-border">
        <div className="container-swiss pt-2 pb-0">
          <ADBreadcrumb
            levels={[
              { label: 'Administration', onClick: () => void navigate({ to: '/admin' }) },
              { label: 'Access Controls' },
            ]}
          />
        </div>
        <div className="container-swiss">
          <div className="flex h-14 items-center gap-3">
            <button
              type="button"
              onClick={() => void navigate({ to: '/admin' })}
              aria-label="Back to administration"
              className="text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <Shield className="w-4 h-4 text-primary" />
            <h1 className="font-display text-lg font-semibold">Access Controls</h1>
            <WindowHelpButton windowName="/admin/access-controls" entityLabel="Access Control" />
          </div>
        </div>
      </header>

      <div className="container-swiss py-8">
        <p className="mb-6 text-sm text-muted-foreground">
          Select a role to view and edit its entity-level access grants. The Administrator role
          has unrestricted access and is not shown.
        </p>

        {isLoading && (
          <div className="swiss-card p-12 text-center">
            <Loader2 className="w-8 h-8 mx-auto animate-spin text-primary" />
          </div>
        )}

        {error && (
          <div className="swiss-alert-error p-8 text-center">
            <AlertCircle className="w-8 h-8 mx-auto mb-2 text-destructive" />
            <p>Failed to load roles</p>
          </div>
        )}

        {!isLoading && !error && (
          <div className="swiss-card overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Role</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                    Description
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Type</th>
                  <th className="px-4 py-3">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {roles.map((r) => (
                  <tr
                    key={r.sys_role_id}
                    className="border-b border-border last:border-0 hover:bg-muted/20"
                  >
                    <td className="px-4 py-3 font-medium">
                      <span className="flex items-center gap-2">
                        {r.is_master_role && (
                          <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
                        )}
                        {r.name}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{r.description ?? '—'}</td>
                    <td className="px-4 py-3">
                      {r.is_master_role ? (
                        <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">
                          Master
                        </span>
                      ) : (
                        <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
                          Standard
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => onSelect(r.name)}
                        className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                      >
                        Manage access
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
                {roles.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-12 text-center text-muted-foreground">
                      No roles found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Role permissions detail view ───────────────────────────────────────────────

function RolePermissionsView({ roleName, onBack }: { roleName: string; onBack: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: rolesData, isLoading: rolesLoading } = useQuery<{ data: SysRole[] }>({
    queryKey: ['admin', 'sys-roles'],
    queryFn: () => apiClient.get('/sys/roles'),
  });

  const role = rolesData?.data?.find(
    (r) =>
      r.name.toLowerCase().replace(/[\s\-_]+/g, '') ===
        roleName.toLowerCase().replace(/[\s\-_]+/g, '') || r.name === roleName,
  );

  const { data: grantsData, isLoading: grantsLoading } = useQuery<{ data: AccessGrant[] }>({
    queryKey: ['admin', 'access-grants', role?.sys_role_id],
    queryFn: () => apiClient.get(`/sys/access-grants?roleId=${role!.sys_role_id}`),
    enabled: !!role?.sys_role_id,
  });

  const { data: tablesData } = useQuery<{ data: TableMetadata[] }>({
    queryKey: ['admin', 'bus-tables'],
    queryFn: () => apiClient.get('/sys/tables'),
  });

  const tables = useMemo(
    () => (tablesData?.data ?? []).filter((t) => t.table_name.startsWith('bus_')),
    [tablesData?.data],
  );

  const grantMap = useMemo(() => {
    const map = new Map<string, Map<string, string>>();
    for (const g of grantsData?.data ?? []) {
      if (g.kind !== 'op') continue;
      if (!map.has(g.table_name)) map.set(g.table_name, new Map());
      map.get(g.table_name)!.set(g.action, g.sys_access_grant_id);
    }
    return map;
  }, [grantsData?.data]);

  const refreshGrants = () =>
    void queryClient.invalidateQueries({
      queryKey: ['admin', 'access-grants', role?.sys_role_id],
    });

  const addGrant = useMutation({
    mutationFn: ({ tableName, action }: { tableName: string; action: string }) =>
      apiClient.post('/sys/access-grants', {
        tableName,
        action,
        roleName: role!.name,
        kind: 'op',
      }),
    onSuccess: refreshGrants,
    onError: (err: any) => toast.error(errorText(err, 'Could not grant permission')),
  });

  const removeGrant = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/sys/access-grants/${id}`),
    onSuccess: refreshGrants,
    onError: (err: any) => toast.error(errorText(err, 'Could not revoke permission')),
  });

  const togglePerm = (tableName: string, op: Op) => {
    if (role?.is_master_role) return;
    const id = grantMap.get(tableName)?.get(op);
    if (id) {
      removeGrant.mutate(id);
    } else {
      addGrant.mutate({ tableName, action: op });
    }
  };

  const isLoading = rolesLoading || grantsLoading;
  const permBusy = addGrant.isPending || removeGrant.isPending;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border bg-gradient-to-r from-background to-muted/30">
        <div className="container-swiss pt-2 pb-0">
          <ADBreadcrumb
            levels={[
              { label: 'Administration', onClick: () => void navigate({ to: '/admin' }) },
              { label: 'Access Controls', onClick: onBack },
              { label: role?.name ?? roleName },
            ]}
          />
        </div>
        <div className="container-swiss">
          <div className="flex h-14 items-center gap-3">
            <button
              type="button"
              onClick={onBack}
              aria-label="Back to access controls"
              className="text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <Shield className="w-4 h-4 text-primary" />
            <h1 className="font-display text-lg font-semibold">
              {role ? (
                <span className="flex items-center gap-2">
                  {role.is_master_role && (
                    <Star className="w-4 h-4 text-amber-500 fill-amber-500" />
                  )}
                  {role.name}
                </span>
              ) : (
                roleName
              )}
            </h1>
            <WindowHelpButton windowName="/admin/access-controls" entityLabel="Access Control" />
          </div>
        </div>
      </header>

      <div className="container-swiss py-8 space-y-6 flex-1">
        {isLoading && (
          <div className="swiss-card p-12 text-center">
            <Loader2 className="w-8 h-8 mx-auto animate-spin text-primary" />
          </div>
        )}

        {!rolesLoading && !role && (
          <div className="swiss-alert-error p-8 text-center">
            <AlertCircle className="w-8 h-8 mx-auto mb-2 text-destructive" />
            <p>Role &ldquo;{roleName}&rdquo; not found</p>
          </div>
        )}

        {!rolesLoading && role && (
          <section className="swiss-card overflow-x-auto">
            <div className="px-4 py-3 border-b border-border">
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Entity permissions
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {role.is_master_role
                  ? 'Master roles have full access to every entity — no restrictions apply.'
                  : 'Click a cell to grant or revoke that operation for this role. An empty cell means no explicit grant.'}
              </p>
            </div>

            {tables.length === 0 && (
              <div className="p-8 text-center text-sm text-muted-foreground">
                <Loader2 className="w-6 h-6 mx-auto animate-spin text-primary mb-2" />
                Loading entities…
              </div>
            )}

            {tables.length > 0 && (
              <table className="w-full min-w-[32rem] text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                      Entity
                    </th>
                    {OPERATIONS.map((op) => (
                      <th
                        key={op}
                        className="px-4 py-3 font-medium text-muted-foreground capitalize text-center w-24"
                      >
                        {OP_LABEL[op]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tables.map((table, idx) => {
                    const tableGrants = grantMap.get(table.table_name);
                    return (
                      <tr
                        key={table.table_name}
                        className={`border-b border-border last:border-0 ${idx % 2 === 0 ? 'bg-background' : 'bg-muted/20'}`}
                      >
                        <td className="px-4 py-2.5 font-medium">
                          {table.name}
                          <span className="ml-2 text-xs text-muted-foreground font-mono">
                            {table.table_name}
                          </span>
                        </td>
                        {OPERATIONS.map((op) => {
                          const granted = tableGrants?.has(op) ?? false;
                          return (
                            <td key={op} className="px-4 py-2.5 text-center">
                              <button
                                type="button"
                                disabled={permBusy || role.is_master_role}
                                onClick={() => togglePerm(table.table_name, op)}
                                aria-label={`${granted ? 'Revoke' : 'Grant'} ${OP_LABEL[op]} on ${table.name}`}
                                className={[
                                  'inline-flex items-center justify-center w-7 h-7 rounded-md border transition-colors',
                                  granted
                                    ? 'bg-primary border-primary text-primary-foreground hover:bg-primary/80'
                                    : 'border-border text-transparent hover:border-primary/50',
                                  permBusy || role.is_master_role
                                    ? 'opacity-50 cursor-not-allowed'
                                    : 'cursor-pointer',
                                ].join(' ')}
                              >
                                <Check className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
