/**
 * ErrorBoundary component tests.
 *
 * Verifies that the boundary renders children normally and catches thrown
 * errors, displaying the fallback UI with error message and action buttons.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import ErrorBoundary from '../ErrorBoundary';

// Suppress React error boundary console output in tests
const originalError = console.error;
beforeAll(() => {
  console.error = (...args) => {
    if (/React error boundary|Unhandled React error/.test(args[0]?.toString?.())) return;
    originalError.call(console, ...args);
  };
});
afterAll(() => { console.error = originalError; });

function GoodChild() {
  return <div>Dashboard Content</div>;
}

function BadChild() {
  throw new Error('Something broke!');
}

describe('ErrorBoundary', () => {
  it('renders children normally when no error is thrown', () => {
    render(
      <ErrorBoundary>
        <GoodChild />
      </ErrorBoundary>
    );

    expect(screen.getByText('Dashboard Content')).toBeInTheDocument();
  });

  it('renders fallback UI when a child component throws', () => {
    render(
      <ErrorBoundary>
        <BadChild />
      </ErrorBoundary>
    );

    expect(screen.getByText('Application Encountered an Error')).toBeInTheDocument();
    expect(screen.getByText('Something broke!')).toBeInTheDocument();
    expect(screen.getByText('Reload')).toBeInTheDocument();
    expect(screen.getByText('Reset Session')).toBeInTheDocument();
  });
});
