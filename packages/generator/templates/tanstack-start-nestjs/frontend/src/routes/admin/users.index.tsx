import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { WindowHelpButton } from '@/components/admin/window-help-button';
import { ADBreadcrumb } from '@/components/admin/ad-breadcrumb';
import { apiClient } from '@/lib/api-client';
import { Users, ArrowLeft, Loader2, AlertCircle, Shield, Plus } from 'lucide-react';
import { RowActions, errorText } from '@/components/admin/row-actions';

export const Route = createFileRoute('/admin/users/')({
  component: UsersPage,
});

interface SysUser {
  sys_user_id: string;
  name: string;
  email: string;
  is_active: boolean;
  created_at: string;
  roles?: string[];
}

interface SysRoleOption {
  sys_role_id: string;
  name: string;
}

const EMPTY_USER = { name: '', email: '', password: '', roleName: '' };

function UsersPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery<{ data: SysUser[] }>({
    queryKey: ['admin', 'sys-users'],
    queryFn: () => apiClient.get('/sys/users'),
  });

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_USER);

  const { data: rolesData } = useQuery<{ data: SysRoleOption[] }>({
    queryKey: ['admin', 'sys-roles'],
    queryFn: () => apiClient.get('/sys/roles'),
    enabled: showForm,
  });
  const roles = rolesData?.data ?? [];

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin', 'sys-users'] });

  const createUser = useMutation({
    mutationFn: (input: typeof EMPTY_USER) =>
      apiClient.post('/sys/users', { ...input, roleName: input.roleName || undefined }),
    onSuccess: () => {
      setForm(EMPTY_USER);
      setShowForm(false);
      void refresh();
    },
  });

  const users = data?.data ?? [];

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 bg-card border-b border-border">
        <div className="container-swiss pt-2 pb-0">
          <ADBreadcrumb levels={[
            { label: 'Administration', onClick: () => void navigate({ to: '/admin' }) },
            { label: 'User Management' },
          ]} />
        </div>
        <div className="container-swiss">
          <div className="flex h-14 items-center gap-3">
            <Link to="/admin" aria-label="Back to administration" className="text-muted-foreground hover:text-foreground">
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <Users className="w-4 h-4 text-primary" />
            <h1 className="font-display text-lg font-semibold">User Management</h1>
            <WindowHelpButton windowName="/admin/users" entityLabel="User" />
            <button
              type="button"
              onClick={() => setShowForm((open) => !open)}
              className="ml-auto inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              <Plus className="w-4 h-4" />
              {showForm ? 'Cancel' : 'New user'}
            </button>
          </div>
        </div>
      </header>

      <div className="container-swiss py-8">
        {showForm && (
          <form
            className="swiss-card mb-6 p-4 space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              createUser.mutate(form);
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="text-sm">
                <span className="mb-1 block text-muted-foreground">Name</span>
                <input
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full rounded-md border border-border bg-background px-3 py-2"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-muted-foreground">Email</span>
                <input
                  required
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="w-full rounded-md border border-border bg-background px-3 py-2"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-muted-foreground">Password (8+ characters)</span>
                <input
                  required
                  minLength={8}
                  type="password"
                  autoComplete="new-password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  className="w-full rounded-md border border-border bg-background px-3 py-2"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-muted-foreground">Role</span>
                <select
                  value={form.roleName}
                  onChange={(e) => setForm({ ...form, roleName: e.target.value })}
                  className="w-full rounded-md border border-border bg-background px-3 py-2"
                >
                  <option value="">— No role —</option>
                  {roles.map((r) => (
                    <option key={r.sys_role_id} value={r.name}>{r.name}</option>
                  ))}
                </select>
              </label>
            </div>
            {createUser.isError && (
              <p className="text-sm text-destructive">
                {errorText(createUser.error, 'Could not create the account')}
              </p>
            )}
            <button
              type="submit"
              disabled={createUser.isPending}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
            >
              {createUser.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              Create account
            </button>
          </form>
        )}

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
            <table className="w-full min-w-[44rem] text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Name</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Email</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Role</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                  <th className="px-4 py-3"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.sys_user_id} className="border-b border-border last:border-0 hover:bg-muted/20">
                    <td className="px-4 py-3 font-medium">
                      <Link
                        to="/admin/users/$userId"
                        params={{ userId: u.sys_user_id }}
                        className="hover:underline"
                      >
                        {u.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{u.email}</td>
                    <td className="px-4 py-3">
                      {u.roles?.[0] ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-medium">
                          <Shield className="w-3 h-3" />{u.roles[0]}
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-xs">No role</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${u.is_active ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300' : 'bg-muted text-muted-foreground'}`}>
                        {u.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <RowActions
                        label={u.name}
                        onEdit={() => void navigate({ to: '/admin/users/$userId', params: { userId: u.sys_user_id } })}
                        remove={() => apiClient.delete(`/sys/users/${u.sys_user_id}`)}
                        onRemoved={() => void refresh()}
                      />
                    </td>
                  </tr>
                ))}
                {users.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-12 text-center text-muted-foreground">No users found</td>
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
