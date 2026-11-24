import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { WindowHelpButton } from '@/components/admin/window-help-button';
import { ADBreadcrumb } from '@/components/admin/ad-breadcrumb';
import { apiClient } from '@/lib/api-client';
import {
  Users,
  ArrowLeft,
  Loader2,
  AlertCircle,
  Plus,
  Pencil,
  Trash2,
  X,
  Save,
  Eye,
  EyeOff,
} from 'lucide-react';
import { errorText } from '@/components/admin/row-actions';
import { toast } from 'sonner';

export const Route = createFileRoute('/admin/users')({
  component: UsersPage,
});

interface SysUser {
  sys_user_id: string;
  name: string;
  email: string;
  is_active: boolean;
  created_at: string;
  roles: string[];
}

interface SysRole {
  sys_role_id: string;
  name: string;
}

function UsersPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<SysUser | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<SysUser | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    isActive: true,
    roleNames: [] as string[],
  });

  const { data, isLoading, error } = useQuery<{ data: SysUser[] }>({
    queryKey: ['admin', 'sys-users'],
    queryFn: () => apiClient.get('/sys/users'),
  });

  const { data: rolesData } = useQuery<{ data: SysRole[] }>({
    queryKey: ['admin', 'sys-roles'],
    queryFn: () => apiClient.get('/sys/roles'),
  });

  const users = data?.data ?? [];
  const roles = rolesData?.data ?? [];

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['admin', 'sys-users'] });

  const createMutation = useMutation({
    mutationFn: (body: { name: string; email: string; password: string; roleName?: string }) =>
      apiClient.post('/sys/users', body),
    onSuccess: () => {
      refresh();
      setCreating(false);
      toast.success('User created');
    },
    onError: (err: any) => toast.error(errorText(err, 'Could not create user')),
  });

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: string;
      name?: string;
      email?: string;
      password?: string;
      isActive?: boolean;
      roleNames?: string[];
    }) => apiClient.patch(`/sys/users/${id}`, body),
    onSuccess: () => {
      refresh();
      setEditing(null);
      toast.success('User updated');
    },
    onError: (err: any) => toast.error(errorText(err, 'Could not update user')),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/sys/users/${id}`),
    onSuccess: () => {
      refresh();
      setConfirmDelete(null);
      toast.success('User deleted');
    },
    onError: (err: any) => toast.error(errorText(err, 'Could not delete user')),
  });

  const openCreate = () => {
    setForm({ name: '', email: '', password: '', isActive: true, roleNames: [] });
    setShowPassword(false);
    setCreating(true);
  };

  const openEdit = (u: SysUser) => {
    setForm({
      name: u.name,
      email: u.email,
      password: '',
      isActive: u.is_active,
      roleNames: u.roles,
    });
    setShowPassword(false);
    setEditing(u);
  };

  const handleCreate = () => {
    if (!form.name.trim() || !form.email.trim() || !form.password.trim()) {
      toast.error('Name, email and password are required');
      return;
    }
    createMutation.mutate({
      name: form.name.trim(),
      email: form.email.trim(),
      password: form.password,
      roleName: form.roleNames[0],
    });
  };

  const handleUpdate = () => {
    if (!editing) return;
    const body: Parameters<typeof updateMutation.mutate>[0] = { id: editing.sys_user_id };
    if (form.name.trim() !== editing.name) body.name = form.name.trim();
    if (form.email.trim() !== editing.email) body.email = form.email.trim();
    if (form.password) body.password = form.password;
    body.isActive = form.isActive;
    body.roleNames = form.roleNames;
    updateMutation.mutate(body);
  };

  const selectRole = (roleName: string) => {
    setForm((f) => ({
      ...f,
      roleNames: f.roleNames[0] === roleName ? [] : [roleName],
    }));
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
              { label: 'User Management' },
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
            <Users className="w-4 h-4 text-primary" />
            <h1 className="font-display text-lg font-semibold">User Management</h1>
            <WindowHelpButton windowName="/admin/users" entityLabel="User" />
            <div className="ml-auto">
              <button
                type="button"
                onClick={openCreate}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                New user
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="container-swiss py-8 space-y-6">
        {isLoading && (
          <div className="swiss-card p-12 text-center">
            <Loader2 className="w-8 h-8 mx-auto animate-spin text-primary" />
          </div>
        )}

        {error && (
          <div className="swiss-alert-error p-8 text-center">
            <AlertCircle className="w-8 h-8 mx-auto mb-2 text-destructive" />
            <p>Failed to load users</p>
          </div>
        )}

        {!isLoading && !error && (
          <div className="swiss-card overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Name</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Email</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Roles</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                  <th className="px-4 py-3">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr
                    key={u.sys_user_id}
                    className="border-b border-border last:border-0 hover:bg-muted/20"
                  >
                    <td className="px-4 py-3 font-medium">{u.name}</td>
                    <td className="px-4 py-3 text-muted-foreground">{u.email}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {u.roles.map((r) => (
                          <span
                            key={r}
                            className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary"
                          >
                            {r}
                          </span>
                        ))}
                        {u.roles.length === 0 && (
                          <span className="text-muted-foreground text-xs">No roles</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {u.is_active ? (
                        <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300">
                          Active
                        </span>
                      ) : (
                        <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
                          Inactive
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => openEdit(u)}
                          aria-label={`Edit ${u.name}`}
                          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(u)}
                          aria-label={`Delete ${u.name}`}
                          className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {users.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-12 text-center text-muted-foreground">
                      No users found
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
                {creating ? 'New user' : `Edit ${editing?.name}`}
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
                <label className="block text-sm font-medium mb-1" htmlFor="user-name">
                  Name
                </label>
                <input
                  id="user-name"
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
                  placeholder="Full name"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1" htmlFor="user-email">
                  Email
                </label>
                <input
                  id="user-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
                  placeholder="user@example.com"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1" htmlFor="user-password">
                  {creating ? 'Password' : 'New password (leave blank to keep current)'}
                </label>
                <div className="relative">
                  <input
                    id="user-password"
                    type={showPassword ? 'text' : 'password'}
                    value={form.password}
                    onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                    className="w-full h-9 px-3 pr-9 rounded-md border border-input bg-background text-sm"
                    placeholder={creating ? 'Password' : '(unchanged)'}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Role</label>
                <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto">
                  {roles.map((r) => {
                    const selected = form.roleNames[0] === r.name;
                    return (
                      <button
                        key={r.sys_role_id}
                        type="button"
                        onClick={() => selectRole(r.name)}
                        className={[
                          'px-2.5 py-1 rounded-full text-xs font-medium border transition-colors',
                          selected
                            ? 'bg-primary border-primary text-primary-foreground'
                            : 'border-border text-muted-foreground hover:border-primary/50',
                        ].join(' ')}
                      >
                        {r.name}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">Select one role. Click the selected role to deselect it.</p>
              </div>

              {editing && (
                <div className="flex items-center gap-2">
                  <input
                    id="user-active"
                    type="checkbox"
                    checked={form.isActive}
                    onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
                    className="w-4 h-4"
                  />
                  <label htmlFor="user-active" className="text-sm font-medium">
                    Active
                  </label>
                </div>
              )}
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
            <h2 className="text-base font-semibold mb-2">Delete user?</h2>
            <p className="text-sm text-muted-foreground mb-6">
              This will permanently delete <strong>{confirmDelete.name}</strong> (
              {confirmDelete.email}). This cannot be undone.
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
                onClick={() => deleteMutation.mutate(confirmDelete.sys_user_id)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-destructive text-destructive-foreground text-sm font-medium hover:bg-destructive/90 disabled:opacity-50"
              >
                {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
