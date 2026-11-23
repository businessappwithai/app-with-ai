import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { WindowHelpButton } from '@/components/admin/window-help-button';
import { ADToolbar } from '@/components/admin/ad-toolbar';
import { ADBreadcrumb } from '@/components/admin/ad-breadcrumb';
import { apiClient } from '@/lib/api-client';
import { Users, ArrowLeft, Loader2, AlertCircle, Shield } from 'lucide-react';
import { errorText } from '@/components/admin/row-actions';
import { toast } from 'sonner';

export const Route = createFileRoute('/admin/users/$userId')({
  component: UserDetailPage,
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

function ReadOnlyField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="text-sm">
      <span className="block text-xs font-medium text-muted-foreground uppercase tracking-wide mb-0.5">
        {label}
      </span>
      <span className="text-foreground">{value || <em className="text-muted-foreground">—</em>}</span>
    </div>
  );
}

function UserDetailPage() {
  const { userId } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: usersData, isLoading: usersLoading } = useQuery<{ data: SysUser[] }>({
    queryKey: ['admin', 'sys-users'],
    queryFn: () => apiClient.get('/sys/users'),
  });

  const user = usersData?.data?.find((u) => u.sys_user_id === userId);

  const { data: rolesData } = useQuery<{ data: SysRoleOption[] }>({
    queryKey: ['admin', 'sys-roles'],
    queryFn: () => apiClient.get('/sys/roles'),
  });
  const roles = rolesData?.data ?? [];

  // --- View/edit state ---
  const [isEditing, setIsEditing] = useState(false);
  const [editBase, setEditBase] = useState<SysUser | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [roleName, setRoleName] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [password, setPassword] = useState('');
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    if (user && !isEditing) {
      setName(user.name);
      setEmail(user.email);
      setRoleName(user.roles?.[0] ?? '');
      setIsActive(user.is_active);
      setPassword('');
    }
  }, [user?.sys_user_id, isEditing]);

  function startEdit() {
    if (!user) return;
    setEditBase({ ...user });
    setName(user.name);
    setEmail(user.email);
    setRoleName(user.roles?.[0] ?? '');
    setIsActive(user.is_active);
    setPassword('');
    setHasChanges(false);
    setIsEditing(true);
  }

  function cancelEdit() {
    if (!editBase) return;
    setName(editBase.name);
    setEmail(editBase.email);
    setRoleName(editBase.roles?.[0] ?? '');
    setIsActive(editBase.is_active);
    setPassword('');
    setHasChanges(false);
    setIsEditing(false);
    setEditBase(null);
  }

  const saveDetails = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error('User not found');
      const body: Record<string, unknown> = {};
      if (name.trim() !== user.name) body.name = name.trim();
      if (email.trim() !== user.email) body.email = email.trim();
      if (isActive !== user.is_active) body.isActive = isActive;
      if (password) body.password = password;

      // Single role — always send if changed
      const currentRole = user.roles?.[0] ?? '';
      if (roleName !== currentRole) {
        body.roleNames = roleName ? [roleName] : [];
      }

      if (Object.keys(body).length > 0) {
        await apiClient.patch(`/sys/users/${user.sys_user_id}`, body);
      }
    },
    onSuccess: () => {
      toast.success('User saved.');
      setPassword('');
      setHasChanges(false);
      setIsEditing(false);
      setEditBase(null);
      void queryClient.invalidateQueries({ queryKey: ['admin', 'sys-users'] });
    },
    onError: (err: any) => {
      toast.error(errorText(err, 'Could not save changes'));
    },
  });

  const isLoading = usersLoading;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <ADToolbar
        onEdit={startEdit}
        onCancelEdit={cancelEdit}
        onSave={() => saveDetails.mutate()}
        onRefresh={() => void queryClient.invalidateQueries({ queryKey: ['admin', 'sys-users'] })}
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
            { label: 'User Management', onClick: () => void navigate({ to: '/admin/users' }) },
            { label: user?.name ?? userId },
          ]} />
        </div>
        <div className="container-swiss">
          <div className="flex h-14 items-center gap-3">
            <Link to="/admin/users" aria-label="Back to users" className="text-muted-foreground hover:text-foreground">
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <Users className="w-4 h-4 text-primary" />
            <h1 className="font-display text-lg font-semibold">{user?.name ?? userId}</h1>
            <WindowHelpButton windowName="/admin/users" entityLabel="User" />
          </div>
        </div>
      </header>

      <div className="container-swiss py-8 space-y-8 flex-1">
        {isLoading && (
          <div className="swiss-card p-12 text-center">
            <Loader2 className="w-8 h-8 mx-auto animate-spin text-primary" />
          </div>
        )}

        {!isLoading && !user && (
          <div className="swiss-alert-error p-8 text-center">
            <AlertCircle className="w-8 h-8 mx-auto mb-2 text-destructive" />
            <p>User not found</p>
          </div>
        )}

        {!usersLoading && user && (
          <>
            {/* User details — view/edit */}
            <section className="swiss-card p-6">
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-4">
                User details
              </h2>
              {isEditing ? (
                <div className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="text-sm">
                      <span className="mb-1 block text-xs font-medium text-muted-foreground uppercase tracking-wide">Name</span>
                      <input
                        required
                        value={name}
                        onChange={(e) => { setName(e.target.value); setHasChanges(true); }}
                        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                      />
                    </label>
                    <label className="text-sm">
                      <span className="mb-1 block text-xs font-medium text-muted-foreground uppercase tracking-wide">Email</span>
                      <input
                        required
                        type="email"
                        value={email}
                        onChange={(e) => { setEmail(e.target.value); setHasChanges(true); }}
                        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                      />
                    </label>
                    <label className="text-sm">
                      <span className="mb-1 block text-xs font-medium text-muted-foreground uppercase tracking-wide">Role</span>
                      <select
                        value={roleName}
                        onChange={(e) => { setRoleName(e.target.value); setHasChanges(true); }}
                        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                      >
                        <option value="">— No role —</option>
                        {roles.map((r) => (
                          <option key={r.sys_role_id} value={r.name}>{r.name}</option>
                        ))}
                      </select>
                    </label>
                    <label className="text-sm">
                      <span className="mb-1 block text-xs font-medium text-muted-foreground uppercase tracking-wide">New password (leave blank to keep)</span>
                      <input
                        type="password"
                        minLength={8}
                        autoComplete="new-password"
                        value={password}
                        onChange={(e) => { setPassword(e.target.value); setHasChanges(e.target.value.length > 0 || hasChanges); }}
                        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                      />
                    </label>
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={isActive}
                      onChange={(e) => { setIsActive(e.target.checked); setHasChanges(true); }}
                      className="w-4 h-4 accent-primary"
                    />
                    <span>Active — clear to stop this person signing in, at once</span>
                  </label>
                </div>
              ) : (
                <div className="grid gap-6 sm:grid-cols-2">
                  <ReadOnlyField label="Name" value={name} />
                  <ReadOnlyField label="Email" value={email} />
                  <div className="text-sm">
                    <span className="block text-xs font-medium text-muted-foreground uppercase tracking-wide mb-0.5">Role</span>
                    {roleName ? (
                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary">
                        <Shield className="w-3 h-3" /> {roleName}
                      </span>
                    ) : (
                      <em className="text-muted-foreground text-sm">No role assigned</em>
                    )}
                  </div>
                  <div className="text-sm">
                    <span className="block text-xs font-medium text-muted-foreground uppercase tracking-wide mb-0.5">Status</span>
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${isActive ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300' : 'bg-muted text-muted-foreground'}`}>
                      {isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
