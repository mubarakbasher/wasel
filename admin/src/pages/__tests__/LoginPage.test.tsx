import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

// Mock the axios wrapper so no real HTTP happens and we control login outcomes.
vi.mock('../../lib/api', () => ({
  default: { post: vi.fn(), get: vi.fn() },
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
