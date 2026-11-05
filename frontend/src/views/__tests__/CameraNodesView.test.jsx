import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CameraNodesView } from '../CameraNodesView';

describe('CameraNodesView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('/api/edge/cameras')) {
        return Promise.resolve({
          ok: true,
          json: async () => [],
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({}),
      });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders empty state when no active cameras are connected', async () => {
    await act(async () => {
      render(<CameraNodesView activeCameras={[]} token="test-token" />);
    });

    expect(screen.getByText('Camera Grid Operations')).toBeInTheDocument();
    expect(screen.getByText('No Active Cameras Connected')).toBeInTheDocument();
    expect(screen.getByText(/0 online · 0 offline · 0 registered/i)).toBeInTheDocument();
  });

  it('renders camera grid and telemetry table when cameras are provided', async () => {
    const mockCameras = [
      {
        camera_id: 'CAM_01',
        node_id: 'edge-host-1',
        status: 'ONLINE',
        fps: 24.5,
        last_heartbeat: new Date().toISOString(),
      },
      {
        camera_id: 'CAM_02',
        node_id: 'edge-host-2',
        status: 'OFFLINE',
        fps: 0,
        last_heartbeat: new Date().toISOString(),
      },
    ];

    global.fetch.mockImplementation((url) => {
      if (url.includes('/api/edge/cameras')) {
        return Promise.resolve({
          ok: true,
          json: async () => mockCameras,
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    await act(async () => {
      render(<CameraNodesView activeCameras={mockCameras} token="test-token" />);
    });

    expect(screen.getByText('1 online · 1 offline · 2 registered')).toBeInTheDocument();
    expect(screen.getByText('Node Hardware Telemetry')).toBeInTheDocument();
    expect(screen.getAllByText('CAM_01').length).toBeGreaterThan(0);
    expect(screen.getAllByText('CAM_02').length).toBeGreaterThan(0);
    expect(screen.getAllByText('24.5 FPS').length).toBeGreaterThan(0);
  });

  it('opens provision modal and validates Camera ID pattern', async () => {
    await act(async () => {
      render(<CameraNodesView activeCameras={[]} token="test-token" />);
    });

    const provisionBtn = screen.getByRole('button', { name: /provision node/i });
    fireEvent.click(provisionBtn);

    expect(screen.getByText('Provision AI Edge Node')).toBeInTheDocument();

    const idInput = screen.getByPlaceholderText(/e\.g\. CAM_02/i);
    const urlInput = screen.getByPlaceholderText(/rtsp:\/\/192\.168\.1\.100/i);
    const deployBtn = screen.getByRole('button', { name: /deploy node/i });

    // Invalid ID with spaces
    fireEvent.change(idInput, { target: { value: 'CAM 01 INVALID' } });
    fireEvent.change(urlInput, { target: { value: 'rtsp://10.0.0.1:554/stream' } });
    fireEvent.click(deployBtn);

    expect(await screen.findByText(/camera id must contain only letters, numbers, underscores, or hyphens/i)).toBeInTheDocument();
  });

  it('validates stream URL allowing webcams and video files', async () => {
    await act(async () => {
      render(<CameraNodesView activeCameras={[]} token="test-token" />);
    });

    fireEvent.click(screen.getByRole('button', { name: /provision node/i }));

    const idInput = screen.getByPlaceholderText(/e\.g\. CAM_02/i);
    const urlInput = screen.getByPlaceholderText(/rtsp:\/\/192\.168\.1\.100/i);
    const deployBtn = screen.getByRole('button', { name: /deploy node/i });

    // Invalid stream URL
    fireEvent.change(idInput, { target: { value: 'CAM_05' } });
    fireEvent.change(urlInput, { target: { value: 'not-a-valid-stream' } });
    fireEvent.click(deployBtn);

    expect(await screen.findByText(/stream must be a valid url/i)).toBeInTheDocument();
  });

  it('provisions a node successfully and adds optimistic state', async () => {
    global.fetch.mockImplementation((url, opts) => {
      if (url.includes('/api/edge/provision') && opts?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true, pid: 1234 }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => [],
      });
    });

    await act(async () => {
      render(<CameraNodesView activeCameras={[]} token="test-token" />);
    });

    fireEvent.click(screen.getByRole('button', { name: /provision node/i }));

    const idInput = screen.getByPlaceholderText(/e\.g\. CAM_02/i);
    const urlInput = screen.getByPlaceholderText(/rtsp:\/\/192\.168\.1\.100/i);
    const deployBtn = screen.getByRole('button', { name: /deploy node/i });

    fireEvent.change(idInput, { target: { value: 'CAM_99' } });
    fireEvent.change(urlInput, { target: { value: '0' } }); // Webcam device index
    fireEvent.click(deployBtn);

    await waitFor(() => {
      expect(screen.getByText(/provisioning started for CAM_99/i)).toBeInTheDocument();
    });

    expect(screen.getAllByText('CAM_99').length).toBeGreaterThan(0);
    expect(screen.getByText(/provisioning\.\.\./i)).toBeInTheDocument();
  });

  it('calls refresh endpoint when refresh button is clicked', async () => {
    let callCount = 0;
    global.fetch.mockImplementation((url) => {
      if (url.includes('/api/edge/cameras')) {
        callCount++;
        if (callCount > 1) {
          return Promise.resolve({
            ok: true,
            json: async () => [
              {
                camera_id: 'CAM_REFRESHED',
                node_id: 'node-x',
                status: 'ONLINE',
                fps: 30,
                last_heartbeat: new Date().toISOString(),
              },
            ],
          });
        }
      }
      return Promise.resolve({
        ok: true,
        json: async () => [],
      });
    });

    await act(async () => {
      render(<CameraNodesView activeCameras={[]} token="test-token" />);
    });

    const refreshBtn = screen.getByRole('button', { name: /refresh/i });
    await act(async () => {
      fireEvent.click(refreshBtn);
    });

    await waitFor(() => {
      expect(screen.getAllByText('CAM_REFRESHED').length).toBeGreaterThan(0);
    });
  });
});
