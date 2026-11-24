import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { WindowHelpButton } from '@/components/admin/window-help-button';
import { ADBreadcrumb } from '@/components/admin/ad-breadcrumb';
import { apiClient } from '@/lib/api-client';
import {
  UserCog,
  ArrowLeft,
  Loader2,
  AlertCircle,
  Plus,
  Pencil,
  Trash2,
  X,
  Save,
  Star,
} from 'lucide-react';
import { errorText } from '@/components/admin/row-actions';
import { toast } from 'sonner';

export const Route = createFileRoute('/admin/roles')({
  component: RolesPage,
});

interface SysRole {
  sys_role_id: string;
  name: string;
  description?: string;
  is_master_role: boolean;
  is_active: boolean;
  created_at: string;
}

function RolesPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<SysRole | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<SysRole | null>(null);
  const [form, setForm] = useState({
    name: '',
    description: '',
    isMasterRole: false,
  });

  const { data, isLoading, error } = useQuery<{ data: SysRole[] }>({
    queryKey: ['admin', 'sys-roles'],
    queryFn: () => apiClient.get('/sys/roles'),
  });

  const roles = data?.data ?? [];
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['admin', 'sys-roles'] });

  const createMutation = useMutation({
    mutationFn: (body: { name: string; description?: string; isMasterRole?: boolean }) =>
      apiClient.post('/sys/roles', body),
    onSuccess: () => {
      refresh();
      setCreating(false);
      toast.success('Role created');
    },
    onError: (err: any) => toast.error(errorText(err, 'Could not create role')),
  });

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: string;
      name?: string;
      description?: string;
      isMasterRole?: boolean;
    }) => apiClient.patch(`/sys/roles/${id}`, body),
    onSuccess: () => {
      refresh();
      setEditing(null);
      toast.success('Role updated');
    },
    onError: (err: any) => toast.error(errorText(err, 'Could not update role')),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/sys/roles/${id}`),
    onSuccess: () => {
      refresh();
      setConfirmDelete(null);
      toast.success('Role deleted');
    },
    onError: (err: any) => toast.error(errorText(err, 'Could not delete role')),
  });

  const openCreate = () => {
    setForm({ name: '', description: '', isMasterRole: false });
    setCreating(true);
  };

  const openEdit = (r: SysRole) => {
    setForm({ name: r.name, description: r.description ?? '', isMasterRole: r.is_master_role });
    setEditing(r);
  };

  const handleCreate = () => {
    if (!form.name.trim()) {
      toast.error('Role name is required');
      return;
    }
    createMutation.mutate({
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      isMasterRole: form.isMasterRole,
    });
  };

  const handleUpdate = () => {
    if (!editing) return;
    updateMutation.mutate({
      id: editing.sys_role_id,
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      isMasterRole: form.isMasterRole,
    });
  };

  const isFormOpen = creating || !!editing;
  const isBusy =
    createMutation.isPending || updateMutation.isPending || deleteMutation.isPending;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 bg-card border-b border-border">
        <div className="container-swiss pt-2 pb-0">
          <ADBreadcrumb
            levels={[
              { label: 'Administration', onClick: () => void navigate({ to: '/admin' }) },
              { label: 'Role Management' },
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
            <UserCog className="w-4 h-4 text-primary" />
            <h1 className="font-display text-lg font-semibold">Role Management</h1>
            <WindowHelpButton windowName="/admin/roles" entityLabel="Role" />
            <div className="ml-auto">
              <button
                type="button"
                onClick={openCreate}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                New role
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="container-swiss py-8">
        <p className="mb-6 text-sm text-muted-foreground">
          Roles define what users may do in this application. Assign roles to users in{' '}
          <button
            type="button"
            onClick={() => void navigate({ to: '/admin/users' })}
            className="underline hover:text-primary"
          >
            User Management
          </button>
          , and configure entity-level permissions per role in{' '}
          <button
            type="button"
            onClick={() => void navigate({ to: '/admin/access-controls' })}
            className="underline hover:text-primary"
          >
            Access Controls
          </button>
          .
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
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => openEdit(r)}
                          aria-label={`Edit ${r.name}`}
                          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(r)}
                          aria-label={`Delete ${r.name}`}
                          className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
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

      {/* Create / Edit form panel */}
      {isFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-card rounded-lg shadow-xl w-full max-w-md border border-border">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h2 className="text-base font-semibold">
                {creating ? 'New role' : `Edit ${editing?.name}`}
              </h2>
              <button
                type="button"
                onClick={() => {
                  setCreating(false);
                  setEditing(null);
                }}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1" htmlFor="role-name">
                  Name
                </label>
                <input
                  id="role-name"
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
                  placeholder="e.g. Billing Manager"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1" htmlFor="role-description">
                  Description
                </label>
                <textarea
                  id="role-description"
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  rows={3}
                  className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm resize-none"
                  placeholder="What this role is for"
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  id="role-master"
                  type="checkbox"
                  checked={form.isMasterRole}
                  onChange={(e) => setForm((f) => ({ ...f, isMasterRole: e.target.checked }))}
                  className="w-4 h-4"
                />
                <label htmlFor="role-master" className="text-sm font-medium">
                  Master role (unrestricted access to all entities)
                </label>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border">
              <button
                type="button"
                onClick={() => {
                  setCreating(false);
                  setEditing(null);
                }}
                className="px-3 py-1.5 rounded-md border border-input text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isBusy}
                onClick={creating ? handleCreate : handleUpdate}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
              >
                {isBusy ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Save className="w-3.5 h-3.5" />
                )}
                {creating ? 'Create' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-card rounded-lg shadow-xl w-full max-w-sm border border-border p-6">
            <h2 className="text-base font-semibold mb-2">Delete role?</h2>
            <p className="text-sm text-muted-foreground mb-6">
              This will permanently delete the role{' '}
              <strong>{confirmDelete.name}</strong>. Users holding this role will lose it. This
              cannot be undone.
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                className="px-3 py-1.5 rounded-md border border-input text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isBusy}
                onClick={() => deleteMutation.mutate(confirmDelete.sys_role_id)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-destructive text-destructive-foreground text-sm font-medium hover:bg-destructive/90 disabled:opacity-50"
              >
                {isBusy ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Trash2 className="w-3.5 h-3.5" />
                )}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
