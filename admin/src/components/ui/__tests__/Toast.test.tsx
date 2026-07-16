import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ToastProvider, useToast, TOAST_EVENT } from '../../../hooks/useToast';
import { TOAST_DURATION_MS } from '../Toast';

// Small harness that exposes the toast API through two buttons.
function Harness() {
  const toast = useToast();
  return (
    <>
      <button onClick={() => toast.success('Saved!')}>raise-success</button>
      <button onClick={() => toast.error('Boom!')}>raise-error</button>
    </>
  );
}

function renderWithProvider(ui: ReactNode = <Harness />) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

describe('Toast system', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders a success toast with an accessible status role', () => {
    renderWithProvider();
    fireEvent.click(screen.getByText('raise-success'));

    expect(screen.getByText('Saved!')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Saved!');
  });

  it('renders an error toast', () => {
    renderWithProvider();
    fireEvent.click(screen.getByText('raise-error'));

    expect(screen.getByText('Boom!')).toBeInTheDocument();
  });

  it('auto-dismisses a toast after the duration elapses', () => {
    vi.useFakeTimers();
    renderWithProvider();

    fireEvent.click(screen.getByText('raise-success'));
    expect(screen.getByText('Saved!')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS);
    });

    expect(screen.queryByText('Saved!')).not.toBeInTheDocument();
  });

  it('can be dismissed manually via the close button', () => {
    renderWithProvider();
    fireEvent.click(screen.getByText('raise-error'));
    expect(screen.getByText('Boom!')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(screen.queryByText('Boom!')).not.toBeInTheDocument();
  });

  it('raises a toast from the wasel:toast window event (non-React path)', () => {
    renderWithProvider(<div>no-hook-here</div>);

    act(() => {
      window.dispatchEvent(
        new CustomEvent(TOAST_EVENT, { detail: { type: 'error', message: 'From lib/api' } }),
      );
    });

    expect(screen.getByText('From lib/api')).toBeInTheDocument();
  });

  it('ignores window events without a message', () => {
    renderWithProvider(<div />);

    act(() => {
      window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: { type: 'success' } }));
    });

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
