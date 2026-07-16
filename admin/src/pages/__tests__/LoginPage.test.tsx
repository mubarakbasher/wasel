import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import axios from 'axios';

// Mock the axios wrapper so no real HTTP happens and we control login outcomes.
vi.mock('../../lib/api', () => ({
  default: { post: vi.fn(), get: vi.fn() },
  apiBaseUrl: '/api/v1',
}));

import api from '../../lib/api';
import { AuthProvider } from '../../hooks/useAuth';
import LoginPage from '../LoginPage';

const mockPost = api.post as unknown as Mock;

function renderLogin() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <LoginPage />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("surfaces the backend's message on a wrong-password 401", async () => {
    const user = userEvent.setup();
    // Backend envelope: { success:false, error:{ message, code } }
    mockPost.mockRejectedValueOnce({
      response: {
        data: { success: false, error: { message: 'Invalid credentials', code: 'INVALID_CREDENTIALS' } },
      },
    });

    renderLogin();

    await user.type(screen.getByLabelText('Email'), 'admin@wasel.app');
    await user.type(screen.getByLabelText('Password'), 'wrongpass');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByText('Invalid credentials')).toBeInTheDocument();
    expect(mockPost).toHaveBeenCalledWith('/auth/login', {
      email: 'admin@wasel.app',
      password: 'wrongpass',
    });
  });

  it('stores only the access token on success — never a refreshToken (cookie auth)', async () => {
    const user = userEvent.setup();
    // Seed a stale pre-cookie refresh token to prove login purges it.
    localStorage.setItem('refreshToken', 'stale-legacy-token');

    // useAuth reads resp.data.data — the backend envelope's `data` payload.
    // No refreshToken in the body: the server set it as an HttpOnly cookie.
    mockPost.mockResolvedValueOnce({
      data: {
        data: {
          accessToken: 'access-abc',
          user: { id: 'u1', name: 'Admin', email: 'admin@wasel.app', role: 'admin' },
        },
      },
    });

    renderLogin();

    await user.type(screen.getByLabelText('Email'), 'admin@wasel.app');
    await user.type(screen.getByLabelText('Password'), 'correct-horse');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => expect(localStorage.getItem('accessToken')).toBe('access-abc'));
    expect(localStorage.getItem('refreshToken')).toBeNull();
    expect(JSON.parse(localStorage.getItem('user') ?? '{}').role).toBe('admin');
    expect(mockPost).toHaveBeenCalledWith('/auth/login', {
      email: 'admin@wasel.app',
      password: 'correct-horse',
    });
  });

  it('revokes the legacy token pair and persists nothing on a non-admin login', async () => {
    const user = userEvent.setup();
    // A non-admin can't get the HttpOnly cookie treatment, so the backend
    // falls back to the legacy body pair — that refresh token must be
    // revoked, not left alive server-side for 7 days.
    mockPost.mockResolvedValueOnce({
      data: {
        data: {
          accessToken: 'access-xyz',
          refreshToken: 'refresh-xyz',
          user: { id: 'u2', name: 'Operator', email: 'op@wasel.app', role: 'operator' },
        },
      },
    });
    const logoutSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({ data: {} });

    renderLogin();

    await user.type(screen.getByLabelText('Email'), 'op@wasel.app');
    await user.type(screen.getByLabelText('Password'), 'whatever');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(
      await screen.findByText('Access denied. Admin privileges required.'),
    ).toBeInTheDocument();

    // Fired via bare axios (no access token exists yet to route through the
    // `api` instance), carrying the just-issued refresh token from the body.
    expect(logoutSpy).toHaveBeenCalledWith('/api/v1/auth/logout', { refreshToken: 'refresh-xyz' });

    // Nothing from this rejected session is persisted.
    expect(localStorage.getItem('accessToken')).toBeNull();
    expect(localStorage.getItem('refreshToken')).toBeNull();
    expect(localStorage.getItem('user')).toBeNull();
  });

  it('shows a generic message when the error has no backend envelope', async () => {
    const user = userEvent.setup();
    mockPost.mockRejectedValueOnce({ request: {} }); // network-style failure, no response

    renderLogin();

    await user.type(screen.getByLabelText('Email'), 'admin@wasel.app');
    await user.type(screen.getByLabelText('Password'), 'whatever');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByText('Login failed. Please try again.')).toBeInTheDocument();
  });

  it('shows the session-expired notice when the flag is set, then clears it', () => {
    sessionStorage.setItem('wasel.sessionExpired', '1');

    renderLogin();

    expect(
      screen.getByText('Your session expired — please sign in again.'),
    ).toBeInTheDocument();
    // One-shot: the flag is consumed on mount so a manual revisit stays clean.
    expect(sessionStorage.getItem('wasel.sessionExpired')).toBeNull();
  });

  it('does not show the session-expired notice without the flag', () => {
    renderLogin();
    expect(
      screen.queryByText('Your session expired — please sign in again.'),
    ).not.toBeInTheDocument();
  });
});
