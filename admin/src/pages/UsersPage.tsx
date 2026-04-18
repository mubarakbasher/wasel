import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, MoreVertical, Check, X, Loader2 } from 'lucide-react';
import api from '../lib/api';
import DataTable, { type Column } from '../components/DataTable';
import StatusBadge from '../components/StatusBadge';
import ErrorPanel from '../components/ErrorPanel';

interface User {
  id: string;
  name: string;
  email: string;
  business_name: string;
  is_verified: boolean;
  is_active: boolean;
  created_at: string;
  [key: string]: unknown;
}

export default function UsersPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);

  // Edit modal state
  const [editUser, setEditUser] = useState<User | null>(null);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');

  // Confirm dialog state
  const [confirmAction, setConfirmAction] = useState<{
    type: 'suspend' | 'unsuspend' | 'delete';
    user: User;
  } | null>(null);

  const limit = 20;

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['admin', 'users', page, limit, search, status],
    queryFn: async () => {
      const params: Record<string, string | number> = { page, limit };
      if (search) params.search = search;
      if (status) params.status = status;
      const { data: res } = await api.get('/admin/users', { params });
      return res;
    },
  });

  const users: User[] = data?.data ?? [];
  const total: number = data?.meta?.total ?? 0;

  const updateMutation = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: Record<string, unknown> }) => {
      await api.put(`/admin/users/${id}`, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      setEditUser(null);
      setConfirmAction(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/admin/users/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      setConfirmAction(null);
    },
  });

  const openEdit = (user: User) => {
    setEditName(user.name);
    setEditEmail(user.email);
    setEditUser(user);
    setOpenDropdown(null);
  };

  const handleEditSave = () => {
    if (!editUser) return;
    updateMutation.mutate({ id: editUser.id, body: { name: editName, email: editEmail } });
  };

  const handleConfirm = () => {
    if (!confirmAction) return;
    if (confirmAction.type === 'delete') {
      deleteMutation.mutate(confirmAction.user.id);
    } else {
      updateMutation.mutate({
        id: confirmAction.user.id,
        body: { is_active: confirmAction.type === 'unsuspend' },
      });
    }
  };

  const columns: Column<User>[] = [
    { key: 'name', header: 'Name' },
    { key: 'email', header: 'Email' },
    {
      key: 'business_name',
      header: 'Business',
      render: (row) => row.business_name || <span className="text-gray-400">-</span>,
    },
    {
      key: 'is_verified',
      header: 'Verified',
      render: (row) =>
        row.is_verified ? (
          <Check className="w-4 h-4 text-green-600" />
        ) : (
          <X className="w-4 h-4 text-gray-400" />
        ),
    },
    {
      key: 'is_active',
      header: 'Active',
      render: (row) => <StatusBadge status={row.is_active ? 'active' : 'suspended'} />,
    },
    {
      key: 'created_at',
      header: 'Created',
      render: (row) => new Date(row.created_at).toLocaleDateString(),
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (row) => (
        <div className="relative" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => setOpenDropdown(openDropdown === row.id ? null : row.id)}
            className="p-1 rounded hover:bg-gray-100 cursor-pointer"
          >
            <MoreVertical className="w-4 h-4 text-gray-500" />
          </button>
          {openDropdown === row.id && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setOpenDropdown(null)} />
              <div className="absolute right-0 mt-1 w-40 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-40">
                <button
                  onClick={() => {
                    navigate(`/users/${row.id}`);
                    setOpenDropdown(null);
                  }}
                  className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 cursor-pointer"
                >
                  View
                </button>
                <button
                  onClick={() => openEdit(row)}
                  className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 cursor-pointer"
                >
                  Edit
                </button>
                <button
                  onClick={() => {
                    setConfirmAction({
                      type: row.is_active ? 'suspend' : 'unsuspend',
                      user: row,
                    });
                    setOpenDropdown(null);
                  }}
                  className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 cursor-pointer"
                >
                  {row.is_active ? 'Suspend' : 'Unsuspend'}
                </button>
                <button
                  onClick={() => {
                    setConfirmAction({ type: 'delete', user: row });
                    setOpenDropdown(null);
                  }}
                  className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50 cursor-pointer"
                >
                  Delete
                </button>
              </div>
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search users..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          className="px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 cursor-pointer"
        >
          <option value="">All Status</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </select>
      </div>

      {isError ? (
        <ErrorPanel
          message={error instanceof Error ? error.message : undefined}
          onRetry={() => refetch()}
        />
      ) : (
        <div className="bg-white rounded-lg border border-slate-200">
          <DataTable
            columns={columns}
            data={users}
            total={total}
            page={page}
            limit={limit}
            onPageChange={setPage}
            isLoading={isLoading}
            onRowClick={(row) => navigate(`/users/${row.id}`)}
          />
        </div>
      )}

      {/* Edit Modal */}
      {editUser && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Edit User</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Name</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
                <input
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setEditUser(null)}
                className="px-4 py-2 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleEditSave}
                disabled={updateMutation.isPending}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-60 transition-colors cursor-pointer"
              >
                {updateMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Dialog */}
      {confirmAction && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-lg font-semibold text-slate-900 mb-2">
              {confirmAction.type === 'delete'
                ? 'Delete User'
                : confirmAction.type === 'suspend'
                  ? 'Suspend User'
                  : 'Unsuspend User'}
            </h2>
            <p className="text-sm text-slate-600 mb-6">
              Are you sure you want to {confirmAction.type}{' '}
              <span className="font-medium">{confirmAction.user.name}</span>?
              {confirmAction.type === 'delete' && ' This action cannot be undone.'}
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirmAction(null)}
                className="px-4 py-2 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                disabled={updateMutation.isPending || deleteMutation.isPending}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-white text-sm font-medium disabled:opacity-60 transition-colors cursor-pointer ${
                  confirmAction.type === 'delete'
                    ? 'bg-red-600 hover:bg-red-700'
                    : 'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                {(updateMutation.isPending || deleteMutation.isPending) && (
                  <Loader2 className="w-4 h-4 animate-spin" />
                )}
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
