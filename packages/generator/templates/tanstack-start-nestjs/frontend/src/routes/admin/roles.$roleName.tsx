import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { WindowHelpButton } from '@/components/admin/window-help-button';
import { ADToolbar } from '@/components/admin/ad-toolbar';
import { ADBreadcrumb } from '@/components/admin/ad-breadcrumb';
import { apiClient } from '@/lib/api-client';
import { UserCog, ArrowLeft, Loader2, AlertCircle, Star, Check } from 'lucide-react';
import { errorText } from '@/components/admin/row-actions';
import { toast } from 'sonner';

export const Route = createFileRoute('/admin/roles/$roleName')({
  component: RoleDetailPage,
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
type Op = typeof OPERATIONS[number];

const OP_LABEL: Record<Op, string> = {
  read: 'Read',
  create: 'Create',
  update: 'Update',
  delete: 'Delete',
};

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-sm">
      <span className="block text-xs font-medium text-muted-foreground uppercase tracking-wide mb-0.5">
        {label}
      </span>
      <span className="text-foreground">{value || <em className="text-muted-foreground">—</em>}</span>
    </div>
  );
}

function RoleDetailPage() {
  const { roleName } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: rolesData, isLoading: rolesLoading } = useQuery<{ data: SysRole[] }>({
    queryKey: ['admin', 'sys-roles'],
    queryFn: () => apiClient.get('/sys/roles'),
  });

  const role = rolesData?.data?.find(
    (r) =>
      r.name.toLowerCase().replace(/[\s\-_]+/g, '') === roleName.toLowerCase().replace(/[\s\-_]+/g, '')
      || r.name === roleName,
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

  // Build lookup: table_name → op → grant id
  const grantMap = useMemo(() => {
    const map = new Map<string, Map<string, string>>();
    for (const g of grantsData?.data ?? []) {
      if (g.kind !== 'op') continue;
      if (!map.has(g.table_name)) map.set(g.table_name, new Map());
      map.get(g.table_name)!.set(g.action, g.sys_access_grant_id);
    }
    return map;
  }, [grantsData?.data]);

  // --- Role details view/edit state ---
  const [isEditing, setIsEditing] = useState(false);
  const [editBase, setEditBase] = useState<SysRole | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isMasterRole, setIsMasterRole] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    if (role && !isEditing) {
      setName(role.name);
      setDescription(role.description ?? '');
      setIsMasterRole(role.is_master_role);
    }
  }, [role?.sys_role_id, isEditing]);

  function startEdit() {
    if (!role) return;
    setEditBase({ ...role });
    setName(role.name);
    setDescription(role.description ?? '');
    setIsMasterRole(role.is_master_role);
    setHasChanges(false);
    setIsEditing(true);
  }

  function cancelEdit() {
    if (!editBase) return;
    setName(editBase.name);
    setDescription(editBase.description ?? '');
    setIsMasterRole(editBase.is_master_role);
    setHasChanges(false);
    setIsEditing(false);
    setEditBase(null);
  }

  const saveDetails = useMutation({
    mutationFn: async () => {
      if (!role) throw new Error('Role not found');
      const body: Record<string, unknown> = {};
      if (name.trim() !== role.name) body.name = name.trim();
      if (description !== (role.description ?? '')) body.description = description;
      if (isMasterRole !== role.is_master_role) body.isMasterRole = isMasterRole;
      if (Object.keys(body).length > 0) {
        await apiClient.patch(`/sys/roles/${role.sys_role_id}`, body);
      }
    },
    onSuccess: () => {
      toast.success('Role details saved.');
      setHasChanges(false);
      setIsEditing(false);
      setEditBase(null);
      void queryClient.invalidateQueries({ queryKey: ['admin', 'sys-roles'] });
    },
    onError: (err: any) => {
      toast.error(errorText(err, 'Could not save changes'));
    },
  });

  const refreshGrants = () =>
    void queryClient.invalidateQueries({ queryKey: ['admin', 'access-grants', role?.sys_role_id] });

  // --- Permissions: immediate click-to-toggle via POST/DELETE access-grants ---
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
      <ADToolbar
        onEdit={startEdit}
        onCancelEdit={cancelEdit}
        onSave={() => saveDetails.mutate()}
        onRefresh={() => {
          void queryClient.invalidateQueries({ queryKey: ['admin', 'sys-roles'] });
          void queryClient.invalidateQueries({ queryKey: ['admin', 'access-grants'] });
        }}
        isSaving={saveDetails.isPending}
        hasChanges={hasChanges}
        canDelete={false}
        canCreate={false}
        isEditing={isEditing}
        isDetailView={true}
        canEdit={true}
      />

      <header className="border-b border-border bg-gradient-to-r from-background to-muted/30">
        <div className="container-swiss pt-2 pb-0">
          <ADBreadcrumb levels={[
            { label: 'Administration', onClick: () => void navigate({ to: '/admin' }) },
            { label: 'Role Management', onClick: () => void navigate({ to: '/admin/roles' }) },
            { label: role?.name ?? roleName },
          ]} />
        </div>
        <div className="container-swiss">
          <div className="flex h-14 items-center gap-3">
            <Link
              to="/admin/roles"
              aria-label="Back to roles"
              className="text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <UserCog className="w-4 h-4 text-primary" />
            <h1 className="font-display text-lg font-semibold">
              {role ? (
                <span className="flex items-center gap-2">
                  {role.is_master_role && <Star className="w-4 h-4 text-amber-500 fill-amber-500" />}
                  {role.name}
                </span>
              ) : roleName}
            </h1>
            <WindowHelpButton windowName="/admin/roles" entityLabel="Role" />
          </div>
        </div>
      </header>

      <div className="container-swiss py-8 space-y-8 flex-1">
        {isLoading && (
          <div className="swiss-card p-12 text-center">
            <Loader2 className="w-8 h-8 mx-auto animate-spin text-primary" />
          </div>
        )}

        {!isLoading && !role && (
          <div className="swiss-alert-error p-8 text-center">
            <AlertCircle className="w-8 h-8 mx-auto mb-2 text-destructive" />
            <p>Role &ldquo;{roleName}&rdquo; not found</p>
          </div>
        )}

        {!rolesLoading && role && (
          <>
            {/* Role details — view/edit via ADToolbar */}
            <section className="swiss-card p-6">
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-4">
                Role details
              </h2>
              {isEditing ? (
                <div className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="text-sm">
                      <span className="mb-1 block text-xs font-medium text-muted-foreground uppercase tracking-wide">Name</span>
                      <input
                        required
                        maxLength={100}
                        value={name}
                        onChange={(e) => { setName(e.target.value); setHasChanges(true); }}
                        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                      />
                    </label>
                    <label className="text-sm">
                      <span className="mb-1 block text-xs font-medium text-muted-foreground uppercase tracking-wide">Description</span>
                      <input
                        value={description}
                        onChange={(e) => { setDescription(e.target.value); setHasChanges(true); }}
                        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                      />
                    </label>
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={isMasterRole}
                      onChange={(e) => { setIsMasterRole(e.target.checked); setHasChanges(true); }}
                      className="w-4 h-4 accent-primary"
                    />
                    <span>Master role (sees and changes everything, like the administrator)</span>
                  </label>
                </div>
              ) : (
                <div className="grid gap-6 sm:grid-cols-2">
                  <ReadOnlyField label="Name" value={name} />
                  <ReadOnlyField label="Description" value={description} />
                  <div className="text-sm">
                    <span className="block text-xs font-medium text-muted-foreground uppercase tracking-wide mb-0.5">Type</span>
                    {isMasterRole ? (
                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">
                        <Star className="w-3 h-3 fill-current" /> Master
                      </span>
                    ) : (
                      <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">Standard</span>
                    )}
                  </div>
                  <div className="text-sm">
                    <span className="block text-xs font-medium text-muted-foreground uppercase tracking-wide mb-0.5">Status</span>
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${role.is_active ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300' : 'bg-muted text-muted-foreground'}`}>
                      {role.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                </div>
              )}
            </section>

            {/* Entity permissions — always interactive */}
            <section className="swiss-card overflow-x-auto">
              <div className="px-4 py-3 border-b border-border">
                <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Entity permissions
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {role.is_master_role
                    ? 'Master roles have full access to every entity — no restrictions apply.'
                    : 'Click a cell to grant or revoke that operation for this role.'}
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
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Entity</th>
                      {OPERATIONS.map((op) => (
                        <th key={op} className="px-4 py-3 font-medium text-muted-foreground capitalize text-center w-24">
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
                            <span className="ml-2 text-xs text-muted-foreground font-mono">{table.table_name}</span>
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
          </>
        )}
      </div>
    </div>
  );
}
