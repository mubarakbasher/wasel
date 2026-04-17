import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Send } from 'lucide-react';
import api from '../lib/api';

interface SupportMessage {
  id: string;
  sender: 'user' | 'admin';
  body: string;
  readAt: string | null;
  createdAt: string;
}

interface ThreadResponse {
  data: SupportMessage[];
  meta: {
    page: number;
    limit: number;
    total: number;
    user: { id: string; name: string; email: string } | null;
  };
}

export default function ConversationPage() {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [reply, setReply] = useState('');
  const [page] = useState(1);
  const endRef = useRef<HTMLDivElement | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-conversation', userId, page],
    queryFn: async () => {
      const { data: res } = await api.get<ThreadResponse>(
        `/admin/support/conversations/${userId}`,
        { params: { page, limit: 50 } },
      );
      return res;
    },
    enabled: !!userId,
  });

  // Mark all user messages read once, after the thread loads.
  useEffect(() => {
    if (data && userId) {
      api.post(`/admin/support/conversations/${userId}/read`).then(() => {
        queryClient.invalidateQueries({ queryKey: ['admin-conversations'] });
        queryClient.invalidateQueries({ queryKey: ['admin-support-unread'] });
      }).catch(() => { /* silent */ });
    }
  }, [data, userId, queryClient]);

  // Auto-scroll to latest on load.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [data]);

  const replyMutation = useMutation({
    mutationFn: async (body: string) => {
      await api.post(`/admin/support/conversations/${userId}/messages`, { body });
    },
    onSuccess: () => {
      setReply('');
      queryClient.invalidateQueries({ queryKey: ['admin-conversation', userId] });
      queryClient.invalidateQueries({ queryKey: ['admin-conversations'] });
    },
  });

  const messages = (data?.data ?? []).slice().reverse(); // oldest → newest for display
  const user = data?.meta?.user;
  const canSend = reply.trim().length > 0 && !replyMutation.isPending;

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 4rem)' }}>
      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={() => navigate('/messages')}
          className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900 transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>
        {user && (
          <div>
            <div className="font-semibold text-gray-900">{user.name}</div>
            <div className="text-xs text-gray-500">{user.email}</div>
          </div>
        )}
      </div>

      <div className="flex-1 bg-white rounded-xl border border-slate-200 overflow-hidden flex flex-col">
        <div className="flex-1 overflow-y-auto p-6 space-y-3">
          {isLoading ? (
            <div className="text-sm text-slate-400">Loading...</div>
          ) : messages.length === 0 ? (
            <div className="text-sm text-slate-400 text-center py-16">
              No messages yet.
            </div>
          ) : (
            messages.map((m) => {
              const isAdmin = m.sender === 'admin';
              return (
                <div
                  key={m.id}
                  className={`flex ${isAdmin ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[70%] rounded-2xl px-4 py-2 ${
                      isAdmin
                        ? 'bg-indigo-600 text-white rounded-br-sm'
                        : 'bg-slate-100 text-slate-900 rounded-bl-sm'
                    }`}
                  >
                    <div className="text-sm whitespace-pre-wrap break-words">{m.body}</div>
                    <div
                      className={`text-[10px] mt-1 ${
                        isAdmin ? 'text-indigo-100' : 'text-slate-500'
                      }`}
                    >
                      {new Date(m.createdAt).toLocaleString()}
                    </div>
                  </div>
                </div>
              );
            })
          )}
          <div ref={endRef} />
        </div>

        <div className="border-t border-slate-200 p-3 bg-slate-50">
          <div className="flex items-end gap-2">
            <textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (canSend) replyMutation.mutate(reply.trim());
                }
              }}
              placeholder="Write a reply..."
              rows={2}
              maxLength={2000}
              className="flex-1 px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
            />
            <button
              onClick={() => canSend && replyMutation.mutate(reply.trim())}
              disabled={!canSend}
              className="inline-flex items-center gap-1 px-4 py-2 text-sm font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              <Send className="w-4 h-4" />
              {replyMutation.isPending ? 'Sending...' : 'Send'}
            </button>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Enter to send, Shift+Enter for a new line.
          </p>
        </div>
      </div>
    </div>
  );
}
