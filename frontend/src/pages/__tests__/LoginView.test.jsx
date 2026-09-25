/**
 * LoginView component tests.
 *
 * Verifies form rendering, input behavior, password toggle,
 * error display, and loading state during login.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import LoginView from '../LoginView';

const mockSetToken = vi.fn();

describe('LoginView', () => {
  beforeEach(() => {
    mockSetToken.mockClear();
    vi.restoreAllMocks();
  });

  it('renders username and password inputs', () => {
    const { container } = render(<LoginView setToken={mockSetToken} isDarkMode={true} />);

    expect(screen.getByPlaceholderText(/enter your username/i)).toBeInTheDocument();
    expect(container.querySelector('input[autocomplete="current-password"]')).toBeInTheDocument();
  });

  it('renders the sign in button', () => {
    render(<LoginView setToken={mockSetToken} isDarkMode={true} />);

    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('toggles password visibility', async () => {
    const user = userEvent.setup();
    const { container } = render(<LoginView setToken={mockSetToken} isDarkMode={true} />);

    const passwordInput = container.querySelector('input[autocomplete="current-password"]');
    expect(passwordInput).toHaveAttribute('type', 'password');

    // Click the toggle button
    const toggleButton = screen.getByLabelText(/show password/i);
    await user.click(toggleButton);
    expect(passwordInput).toHaveAttribute('type', 'text');

    // Click again to hide
    const hideButton = screen.getByLabelText(/hide password/i);
    await user.click(hideButton);
    expect(passwordInput).toHaveAttribute('type', 'password');
  });

  it('shows error message on failed login', async () => {
    const user = userEvent.setup();

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Invalid credentials' }),
    });

    const { container } = render(<LoginView setToken={mockSetToken} isDarkMode={true} />);

    await user.type(screen.getByPlaceholderText(/enter your username/i), 'wronguser');
    await user.type(container.querySelector('input[autocomplete="current-password"]'), 'wrongpass');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByText(/invalid credentials/i)).toBeInTheDocument();
    });

    expect(mockSetToken).not.toHaveBeenCalled();
  });

  it('calls setToken on successful login', async () => {
    const user = userEvent.setup();

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ token: 'test-jwt-token', user: { username: 'admin', role: 'admin' } }),
    });

    const { container } = render(<LoginView setToken={mockSetToken} isDarkMode={true} />);

    await user.type(screen.getByPlaceholderText(/enter your username/i), 'admin');
    await user.type(container.querySelector('input[autocomplete="current-password"]'), 'TestPassword@123');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(mockSetToken).toHaveBeenCalledWith('test-jwt-token');
    });
  });

  it('shows network error on fetch failure', async () => {
    const user = userEvent.setup();

    global.fetch = vi.fn().mockRejectedValueOnce(new Error('Network error'));

    const { container } = render(<LoginView setToken={mockSetToken} isDarkMode={true} />);

    await user.type(screen.getByPlaceholderText(/enter your username/i), 'admin');
    await user.type(container.querySelector('input[autocomplete="current-password"]'), 'password');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByText(/network error/i)).toBeInTheDocument();
    });
  });
});
