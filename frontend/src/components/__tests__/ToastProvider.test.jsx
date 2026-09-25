/**
 * ToastProvider component tests.
 *
 * Verifies toast creation, severity-based rendering, dismiss behavior,
 * and the max toast limit.
 */

import React from 'react';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ToastProvider, useToast } from '../ToastProvider';

// Test consumer that triggers toasts
function ToastTrigger({ severity = 'MEDIUM', title = 'Test Alert', message = 'Details here' }) {
  const { addToast } = useToast();
  return (
    <button onClick={() => addToast({ title, message, severity })}>
      Trigger Toast
    </button>
  );
}

describe('ToastProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders children without toasts initially', () => {
    render(
      <ToastProvider>
        <div>App Content</div>
      </ToastProvider>
    );

    expect(screen.getByText('App Content')).toBeInTheDocument();
    // No alerts visible initially
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows a toast when addToast is called', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    render(
      <ToastProvider>
        <ToastTrigger severity="CRITICAL" title="Weapon Detected" message="Camera 3, Zone A" />
      </ToastProvider>
    );

    await user.click(screen.getByText('Trigger Toast'));

    expect(screen.getByText('Weapon Detected')).toBeInTheDocument();
    expect(screen.getByText('Camera 3, Zone A')).toBeInTheDocument();
  });

  it('shows different severities', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    render(
      <ToastProvider>
        <ToastTrigger severity="SUCCESS" title="Incident Reviewed" />
      </ToastProvider>
    );

    await user.click(screen.getByText('Trigger Toast'));

    expect(screen.getByText('Incident Reviewed')).toBeInTheDocument();
    const alert = screen.getByRole('alert');
    // SUCCESS toasts use emerald background
    expect(alert.className).toContain('emerald');
  });

  it('auto-dismisses toast after timeout', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    render(
      <ToastProvider>
        <ToastTrigger title="Temporary Alert" />
      </ToastProvider>
    );

    await user.click(screen.getByText('Trigger Toast'));
    expect(screen.getByText('Temporary Alert')).toBeInTheDocument();

    // Advance past the 5000ms duration + 300ms exit animation
    act(() => { vi.advanceTimersByTime(5500); });

    expect(screen.queryByText('Temporary Alert')).not.toBeInTheDocument();
  });

  it('limits toasts to MAX_TOASTS (5)', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    render(
      <ToastProvider>
        <ToastTrigger title="Alert" />
      </ToastProvider>
    );

    // Fire 7 toasts rapidly
    for (let i = 0; i < 7; i++) {
      await user.click(screen.getByText('Trigger Toast'));
    }

    const alerts = screen.getAllByRole('alert');
    expect(alerts.length).toBeLessThanOrEqual(5);
  });
});
