import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import BrandMark from '../components/BrandMark';
import Button from '../components/ui/Button';

/**
 * Pull a human-readable message out of a failed login. The backend uses the
 * envelope `{ success:false, error:{ message, code } }`, so the structured
 * message wins; client-side guards (e.g. the non-admin role check) throw a
 * plain Error whose message we surface next; anything else falls back.
 */
function loginErrorMessage(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'response' in err) {
    const axiosErr = err as { response?: { data?: { error?: { message?: string } } } };
    const backendMessage = axiosErr.response?.data?.error?.message;
    if (backendMessage) return backendMessage;
  }
  if (err instanceof Error && err.message) return err.message;
  return 'Login failed. Please try again.';
}

export default function LoginPage() {
  const { isLoggedIn, login } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);

  // If the API interceptor bounced the user here on an expired session, explain
  // why — then clear the one-shot flag so a manual revisit stays clean.
  useEffect(() => {
    if (sessionStorage.getItem('wasel.sessionExpired')) {
      setSessionExpired(true);
      sessionStorage.removeItem('wasel.sessionExpired');
    }
  }, []);

  if (isLoggedIn) {
    return <Navigate to="/dashboard" replace />;
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await login(email, password);
      navigate('/dashboard', { replace: true });
    } catch (err: unknown) {
      setError(loginErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8">
          <div className="flex flex-col items-center mb-8">
            <BrandMark size={56} className="mb-4" />
            <h1 className="text-2xl font-bold text-slate-900">Wasel Admin</h1>
            <p className="text-sm text-slate-500 mt-1">Sign in to your admin account</p>
          </div>

          {sessionExpired && (
            <div
              role="status"
              className="mb-6 p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800"
            >
              Your session expired — please sign in again.
            </div>
          )}

          {error && (
            <div className="mb-6 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-1.5">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                placeholder="admin@wasel.app"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-slate-700 mb-1.5">
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                placeholder="Enter your password"
              />
            </div>

            <Button type="submit" loading={loading} className="w-full">
              Sign in
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
