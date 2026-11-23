import React from 'react';
import { TelemetryRow } from '../components/ui/LuxuryPrimitives';

export const DocsView = () => {
  return (
    <main className="flex-1 overflow-y-auto bg-[var(--bg-canvas)] p-4 sm:p-6 md:p-8 custom-scrollbar animate-fade-in-up">
      <div className="max-w-3xl mx-auto space-y-10">
        <div className="pb-5 border-b border-[var(--border-hairline)]">
          <h1 className="text-[20px] font-medium tracking-[-0.025em] text-[var(--text-primary)]">
            Documentation
          </h1>
          <p className="text-[13px] text-[var(--text-secondary)] mt-1 leading-relaxed">
            Operations guide for live vehicle monitoring, multi-camera bus binding, and emergency dispatch.
          </p>
        </div>

        <section className="space-y-3">
          <h2 className="text-[15px] font-medium tracking-[-0.02em] text-[var(--text-primary)]">
            System Overview
          </h2>
          <p className="text-[13px] text-[var(--text-secondary)] leading-[1.7]">
            TransGuard AI connects onboard vehicle cameras and physical ESP32 emergency hardware to
            a unified control-room console. Each camera defaults to a 1:1 vehicle binding, or you
            can attach multiple cameras (such as Front Cabin and Rear Door) to the same bus ID so
            GPS telemetry and cabin siren dispatch stay synchronized across every feed on that
            vehicle.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-[15px] font-medium tracking-[-0.02em] text-[var(--text-primary)]">
            Safety Monitoring Modules
          </h2>
          <div className="border-t border-[var(--border-hairline)]">
            <TelemetryRow
              label="Physical Emergency SOS"
              value="Immediate dashboard alert & GPS lock"
              mono={false}
            />
            <TelemetryRow
              label="Crowd Capacity"
              value="Continuous cabin occupancy monitoring"
              mono={false}
            />
            <TelemetryRow
              label="Unattended Baggage"
              value="Abandoned item & unauthorized pickup alerts"
              mono={false}
            />
            <TelemetryRow
              label="Passenger Safety"
              value="Fall detection & altercation response"
              mono={false}
            />
            <TelemetryRow
              label="Watchlist Registry"
              value="Multi-angle reference matching across cameras"
              mono={false}
            />
            <TelemetryRow
              label="Audit Logging"
              value="Exportable Excel & CSV validation records"
              mono={false}
            />
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-[15px] font-medium tracking-[-0.02em] text-[var(--text-primary)]">
            Hardware &amp; Stream Endpoints
          </h2>
          <div className="border-t border-[var(--border-hairline)]">
            <TelemetryRow label="RTSP Ingest" value="rtsp://127.0.0.1:8554/cam/CAM_01" />
            <TelemetryRow label="Low-Latency Playback" value="http://localhost:8889" />
            <TelemetryRow label="Vehicle Siren Command" value="/api/alerts/command?vehicle_id=BUS_001" />
            <TelemetryRow label="ESP32 SOS Ingest" value="POST /api/alerts/sos" />
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-[15px] font-medium tracking-[-0.02em] text-[var(--text-primary)]">
            Connecting a Local Camera Unit
          </h2>
          <pre className="p-4 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-hairline)] font-mono text-[12px] text-[var(--text-primary)] overflow-x-auto">
            python trans_guard_engine.py --camera CAM_01 --url rtsp://&lt;CAMERA_IP&gt;:554/ch0_0.264 --headless
          </pre>
        </section>
      </div>
    </main>
  );
};
