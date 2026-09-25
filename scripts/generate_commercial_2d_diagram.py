"""
TransGuard AI — 2D Commercial Electronic Circuit Layout Diagram
Investor-Grade 2D Flat Vector Technical Diagram

Components:
1. Central Hub: Green Double-Sided "Zero PCB" (Perfboard) with solder eyelet grid and 4 brass standoffs
2. Microcontroller: Arduino Nano V3 plugged into dual female header sockets (Blue USB cable to Laptop)
3. Sensors:
   - u-blox NEO-M8N GPS Module (Blue board with square tan ceramic patch antenna)
   - MQ-2 Smoke & Gas Sensor Module (Silver circular mesh cylinder)
4. Safety Input: Heavy-Duty Industrial Red Mushroom E-Stop Button with 10kΩ resistor + 100nF capacitor RC debounce
5. Actuator Output: 5V 1-Channel Optocoupler Relay Module driving a 12V Amber Industrial Strobe Siren
6. Vision: TP-Link Tapo C310 IP Camera with thick Cat6 Ethernet cable to AI Engine PC
7. Wiring: 100% Orthogonal 90-degree straight color-coded solid-core bus traces soldered flat to PCB.
"""

import matplotlib.pyplot as plt
import matplotlib.patches as patches
from matplotlib.patches import FancyBboxPatch, Circle, Rectangle, PathPatch, Polygon
from matplotlib.path import Path
import numpy as np
import os

def generate_2d_circuit_diagram(output_path="commercial_circuit_2d.png"):
    # Canvas: 26 x 15 inches @ 220 DPI = 5720 x 3300 px
    fig = plt.figure(figsize=(26, 15), dpi=220)
    ax = fig.add_axes([0, 0, 1, 1])
    ax.set_xlim(0, 130)
    ax.set_ylim(0, 75)
    ax.axis('off')

    bg_color = "#0B0F19"  # Deep technical slate blueprint background
    fig.patch.set_facecolor(bg_color)
    ax.set_facecolor(bg_color)

    # -------------------------------------------------------------------------
    # 0. SUBTLE BLUEPRINT GRID
    # -------------------------------------------------------------------------
    for x in range(5, 126, 5):
        ax.plot([x, x], [4, 71], color='#1E293B', linewidth=0.5, alpha=0.45, zorder=0)
    for y in range(5, 71, 5):
        ax.plot([5, 125], [y, y], color='#1E293B', linewidth=0.5, alpha=0.45, zorder=0)

    # Outer border frame
    ax.add_patch(Rectangle((3.5, 3.5), 123, 68, facecolor='none', edgecolor='#334155', linewidth=1.2, zorder=1))
    ax.add_patch(Rectangle((4.5, 4.5), 121, 66, facecolor='none', edgecolor='#1E293B', linewidth=0.8, zorder=1))

    # Title block in bottom right
    tb_x, tb_y, tb_w, tb_h = 92.0, 5.0, 32.0, 9.0
    ax.add_patch(Rectangle((tb_x, tb_y), tb_w, tb_h, facecolor='#0F172A', edgecolor='#334155', linewidth=1.0, zorder=2))
    ax.text(tb_x + 1.5, tb_y + 7.0, "TRANSGUARD AI — HARDWARE SUBSYSTEM", fontsize=7.5, fontweight='bold', color='#38BDF8', family='sans-serif', zorder=3)
    ax.text(tb_x + 1.5, tb_y + 4.8, "COMMERCIAL 2D EDGE-AI SURVEILLANCE CIRCUIT", fontsize=6.2, fontweight='bold', color='#F1F5F9', family='sans-serif', zorder=3)
    ax.text(tb_x + 1.5, tb_y + 2.5, "DWG NO: TG-HW-2026-V2   |   SCALE: 1:1 2D TOP-DOWN", fontsize=5.2, color='#94A3B8', family='monospace', zorder=3)
    ax.text(tb_x + 1.5, tb_y + 0.8, "STATUS: INVESTOR VERIFIED (ZERO-BREADBOARD)", fontsize=5.0, fontweight='bold', color='#22C55E', family='monospace', zorder=3)

    # -------------------------------------------------------------------------
    # 1. HELPER: ORTHOGONAL 90° SOLDERED TRACE (2D FLAT SOLID-CORE BUS WIRE)
    # -------------------------------------------------------------------------
    def draw_orthogonal_trace(points, color, width=2.6, zorder=15):
        xs = [p[0] for p in points]
        ys = [p[1] for p in points]
        
        # Subtle glowing under-trace for dark theme
        ax.plot(xs, ys, color=color, linewidth=width + 2.0, alpha=0.22, solid_capstyle='round', zorder=zorder - 1)
        # Main solid-core bus trace
        ax.plot(xs, ys, color=color, linewidth=width, solid_capstyle='projecting', solid_joinstyle='miter', zorder=zorder)

        # Solder fillet dot at endpoints and joints
        for pt in points:
            ax.add_patch(Circle(pt, width * 0.22, facecolor='#E2E8F0', edgecolor='#64748B', linewidth=0.5, zorder=zorder + 1))

    # -------------------------------------------------------------------------
    # 2. HELPER: PROFESSIONAL LEADER LABELS
    # -------------------------------------------------------------------------
    def draw_callout(target_pt, label_pt, title, subtitle="", align="left", side="left"):
        tx, ty = target_pt
        lx, ly = label_pt

        # Anchor dot
        ax.add_patch(Circle((tx, ty), 0.5, facecolor='#38BDF8', edgecolor='#0284C7', linewidth=0.8, zorder=40))
        
        # Two-segment orthogonal leader line
        mid_x = lx if align == "left" else (lx - 2.0 if side == "right" else lx + 2.0)
        ax.plot([tx, mid_x, lx], [ty, ly, ly], color='#64748B', linewidth=1.1, zorder=39)

        # Crisp label text
        ax.text(lx, ly + 0.9, title, fontsize=8.2, fontweight='bold', color='#F8FAFC', ha=align, va='bottom', family='sans-serif', zorder=41)
        if subtitle:
            ax.text(lx, ly - 0.7, subtitle, fontsize=6.2, color='#94A3B8', ha=align, va='top', family='sans-serif', zorder=41)

    # =========================================================================
    # COMPONENT 1: CENTRAL ZERO PCB PERFBOARD (70 x 90 mm)
    # Center: px=28.0, py=14.0, pw=58.0, ph=48.0
    # =========================================================================
    px, py, pw, ph = 28.0, 14.0, 58.0, 48.0

    # Board shadow
    ax.add_patch(FancyBboxPatch((px + 0.8, py - 0.8), pw, ph, boxstyle="round,pad=0.2,rounding_size=1.2",
                                facecolor='#020617', alpha=0.7, zorder=2))
    # Green Soldermask (FR-4 Double Sided Zero PCB)
    ax.add_patch(FancyBboxPatch((px, py), pw, ph, boxstyle="round,pad=0.2,rounding_size=1.2",
                                facecolor='#0F4C27', edgecolor='#15803D', linewidth=1.8, zorder=3))

    # Matrix of Plated Through-Hole (PTH) Solder Eyelets (2.54mm Grid)
    grid_xs = np.linspace(px + 2.5, px + pw - 2.5, 29)
    grid_ys = np.linspace(py + 2.5, py + ph - 2.5, 23)
    for gx in grid_xs:
        for gy in grid_ys:
            ax.add_patch(Circle((gx, gy), 0.36, facecolor='#B45309', edgecolor='#FBBF24', linewidth=0.3, alpha=0.65, zorder=4))
            ax.add_patch(Circle((gx, gy), 0.16, facecolor='#020617', zorder=5))

    # 4 Brass Corner Standoffs with Hexagonal Screws
    standoff_coords = [
        (px + 2.8, py + 2.8),
        (px + pw - 2.8, py + 2.8),
        (px + 2.8, py + ph - 2.8),
        (px + pw - 2.8, py + ph - 2.8)
    ]
    for sx, sy in standoff_coords:
        # Brass outer rim
        ax.add_patch(Circle((sx, sy), 1.9, facecolor='#CA8A04', edgecolor='#EAB308', linewidth=1.0, zorder=6))
        # Hex screw head
        angles = np.linspace(0, 2*np.pi, 7)[:-1]
        hex_pts = np.column_stack([sx + 1.2 * np.cos(angles), sy + 1.2 * np.sin(angles)])
        ax.add_patch(Polygon(hex_pts, facecolor='#E2E8F0', edgecolor='#64748B', linewidth=0.6, zorder=7))
        # Center screw slot
        ax.plot([sx - 0.7, sx + 0.7], [sy, sy], color='#475569', lw=0.9, zorder=8)

    # Silkscreen Grid Labels on PCB
    ax.text(px + pw/2, py + ph - 1.6, "ZERO PCB COMMERCIAL PERFBOARD (70x90mm FR-4)", fontsize=5.8, fontweight='bold', color='#86EFAC', ha='center', va='center', zorder=6)
    ax.text(px + pw/2, py + 1.6, "SOLDERING SIDE: COMPONENT TOP LAYER", fontsize=5.2, fontweight='bold', color='#4ADE80', ha='center', va='center', zorder=6)

    # =========================================================================
    # COMPONENT 2: ARDUINO NANO V3 (SOCKETED IN FEMALE HEADERS)
    # Center of board: nx=50.0, ny=22.0, nw=14.0, nh=32.0
    # =========================================================================
    nx, ny, nw, nh = 50.0, 22.0, 14.0, 32.0

    # Female Header Sockets (Dual 15-pin black strips)
    ax.add_patch(Rectangle((nx - 2.0, ny), 1.8, nh, facecolor='#090D16', edgecolor='#1E293B', linewidth=0.8, zorder=7))
    ax.add_patch(Rectangle((nx + nw + 0.2, ny), 1.8, nh, facecolor='#090D16', edgecolor='#1E293B', linewidth=0.8, zorder=7))

    # Nano Teal PCB Body
    ax.add_patch(FancyBboxPatch((nx, ny), nw, nh, boxstyle="round,pad=0.1,rounding_size=0.8",
                                facecolor='#00878F', edgecolor='#005F65', linewidth=1.4, zorder=8))

    # Mini-B USB Port (Top)
    usb_w, usb_h = 5.2, 4.2
    ax.add_patch(FancyBboxPatch((nx + nw/2 - usb_w/2, ny + nh - 1.5), usb_w, usb_h, boxstyle="round,pad=0.08,rounding_size=0.3",
                                facecolor='#E2E8F0', edgecolor='#64748B', linewidth=1.0, zorder=9))
    ax.add_patch(Rectangle((nx + nw/2 - 1.8, ny + nh + 0.8), 3.6, 1.2, facecolor='#0F172A', zorder=10))

    # Blue USB Cable exiting up toward laptop
    cable_x = nx + nw/2
    cable_y = ny + nh + 2.0
    ax.plot([cable_x, cable_x, 15.0], [cable_y, 68.0, 68.0], color='#0284C7', linewidth=4.8, zorder=6)
    ax.plot([cable_x, cable_x, 15.0], [cable_y, 68.0, 68.0], color='#38BDF8', linewidth=1.6, alpha=0.8, zorder=7)
    # Cable boot
    ax.add_patch(FancyBboxPatch((cable_x - 1.5, cable_y), 3.0, 3.2, boxstyle="round,pad=0.05,rounding_size=0.2",
                                facecolor='#1E293B', edgecolor='#0F172A', linewidth=0.8, zorder=9))

    # ATmega328P Chip (Square TQFP-32 package)
    chip_cx, chip_cy = nx + nw/2, ny + nh/2 + 1.0
    chip_s = 4.8
    ax.add_patch(Rectangle((chip_cx - chip_s/2, chip_cy - chip_s/2), chip_s, chip_s, facecolor='#1E293B', edgecolor='#0F172A', linewidth=0.8, zorder=10))
    ax.add_patch(Circle((chip_cx - chip_s/2 + 0.7, chip_cy + chip_s/2 - 0.7), 0.35, facecolor='#94A3B8', zorder=11))
    ax.text(chip_cx, chip_cy, "MEGA328P\n16MHz", fontsize=4.8, fontweight='bold', color='#F8FAFC', ha='center', va='center', zorder=11)

    # 16 MHz Crystal
    ax.add_patch(FancyBboxPatch((chip_cx - 1.6, chip_cy - 5.5), 3.2, 1.4, boxstyle="round,pad=0.05,rounding_size=0.4",
                                facecolor='#CBD5E1', edgecolor='#64748B', linewidth=0.6, zorder=10))
    ax.text(chip_cx, chip_cy - 4.8, "16.0", fontsize=4.2, color='#334155', ha='center', va='center', zorder=11)

    # Reset Button & Silkscreen
    ax.add_patch(Circle((chip_cx, chip_cy - 8.2), 0.7, facecolor='#DC2626', edgecolor='#991B1B', linewidth=0.5, zorder=10))
    ax.text(nx + nw/2, ny + nh - 4.0, "ARDUINO NANO", fontsize=6.2, fontweight='bold', color='#FFFFFF', ha='center', va='center', zorder=10)

    # Nano Pin Mapping
    left_pins_name = ["D13", "3V3", "REF", "A0", "A1", "A2", "A3", "A4", "A5", "A6", "A7", "5V", "RST", "GND", "VIN"]
    right_pins_name = ["D12", "D11", "D10", "D9", "D8", "D7", "D6", "D5", "D4", "D3", "D2", "GND", "RST", "RX", "TX"]

    nano_pins = {}
    pin_step = (nh - 4.0) / 14.0
    for i in range(15):
        py_i = ny + 2.0 + i * pin_step
        # Left Pin
        lx_i = nx - 1.1
        ax.add_patch(Circle((lx_i, py_i), 0.65, facecolor='#CBD5E1', edgecolor='#334155', linewidth=0.5, zorder=9))
        ax.add_patch(Circle((lx_i, py_i), 0.28, facecolor='#020617', zorder=10))
        ax.text(lx_i + 2.0, py_i, left_pins_name[i], fontsize=4.4, fontweight='bold', color='#FFFFFF', ha='left', va='center', zorder=11)
        nano_pins[left_pins_name[i]] = (lx_i, py_i)

        # Right Pin
        rx_i = nx + nw + 1.1
        ax.add_patch(Circle((rx_i, py_i), 0.65, facecolor='#CBD5E1', edgecolor='#334155', linewidth=0.5, zorder=9))
        ax.add_patch(Circle((rx_i, py_i), 0.28, facecolor='#020617', zorder=10))
        ax.text(rx_i - 2.0, py_i, right_pins_name[i], fontsize=4.4, fontweight='bold', color='#FFFFFF', ha='right', va='center', zorder=11)
        nano_pins[right_pins_name[i]] = (rx_i, py_i)

    # =========================================================================
    # COMPONENT 3: u-blox NEO-M8N GPS MODULE (Top-Left of PCB)
    # gx=31.0, gy=42.0, gw=14.0, gh=17.0
    # =========================================================================
    gx, gy, gw, gh = 31.0, 42.0, 14.0, 17.0
    ax.add_patch(FancyBboxPatch((gx, gy), gw, gh, boxstyle="round,pad=0.1,rounding_size=0.6",
                                facecolor='#1D4ED8', edgecolor='#1E3A8A', linewidth=1.2, zorder=8))

    # Ceramic Patch Antenna (Square tan block with silver center electrode)
    ax.add_patch(FancyBboxPatch((gx + 1.2, gy + 4.8), 11.6, 11.0, boxstyle="round,pad=0.08,rounding_size=0.4",
                                facecolor='#E2CBAF', edgecolor='#B59975', linewidth=0.9, zorder=9))
    ax.add_patch(Circle((gx + 7.0, gy + 10.3), 1.6, facecolor='#CBD5E1', edgecolor='#94A3B8', linewidth=0.6, zorder=10))
    ax.text(gx + 7.0, gy + 10.3, "GPS", fontsize=4.8, fontweight='bold', color='#475569', ha='center', va='center', zorder=11)

    # Metal Shield & Label
    ax.add_patch(Rectangle((gx + 1.2, gy + 1.2), 11.6, 2.6, facecolor='#CBD5E1', edgecolor='#64748B', linewidth=0.6, zorder=9))
    ax.text(gx + 7.0, gy + 2.5, "u-blox NEO-M8N", fontsize=4.6, fontweight='bold', color='#0F172A', ha='center', va='center', zorder=10)

    # 4 Soldered Header Pins: VCC, GND, TX, RX (Facing right side of module)
    gps_pins = {}
    gps_labels = ["VCC", "GND", "TX", "RX"]
    for i, lbl in enumerate(gps_labels):
        py_g = gy + 3.0 + i * 3.2
        px_g = gx + gw + 1.4
        ax.add_patch(Circle((px_g, py_g), 0.65, facecolor='#F59E0B', edgecolor='#D97706', linewidth=0.5, zorder=10))
        ax.add_patch(Circle((px_g, py_g), 0.28, facecolor='#020617', zorder=11))
        ax.text(px_g - 1.8, py_g, lbl, fontsize=4.2, fontweight='bold', color='#FFFFFF', ha='right', va='center', zorder=11)
        gps_pins[lbl] = (px_g, py_g)

    # =========================================================================
    # COMPONENT 4: MQ-2 SMOKE & GAS SENSOR MODULE (Middle-Left of PCB)
    # mq_x=31.0, mq_y=23.0, mq_w=14.0, mq_h=16.0
    # =========================================================================
    mq_x, mq_y, mq_w, mq_h = 31.0, 23.0, 14.0, 16.0
    ax.add_patch(FancyBboxPatch((mq_x, mq_y), mq_w, mq_h, boxstyle="round,pad=0.1,rounding_size=0.6",
                                facecolor='#0284C7', edgecolor='#0369A1', linewidth=1.2, zorder=8))

    # Cylindrical Silver Steel Mesh Sensor Chamber
    sensor_cx, sensor_cy = mq_x + mq_w/2, mq_y + mq_h/2 + 1.0
    ax.add_patch(Circle((sensor_cx, sensor_cy), 5.2, facecolor='#E2E8F0', edgecolor='#94A3B8', linewidth=1.4, zorder=9))
    ax.add_patch(Circle((sensor_cx, sensor_cy), 4.4, facecolor='#CBD5E1', edgecolor='#64748B', linewidth=0.8, zorder=10))
    ax.add_patch(Circle((sensor_cx, sensor_cy), 2.8, facecolor='none', edgecolor='#94A3B8', linewidth=0.6, linestyle='--', zorder=11))
    ax.add_patch(Circle((sensor_cx, sensor_cy), 1.2, facecolor='#64748B', edgecolor='none', zorder=11))
    ax.text(sensor_cx, sensor_cy - 0.1, "MQ-2", fontsize=5.0, fontweight='bold', color='#0F172A', ha='center', va='center', zorder=12)
    ax.text(mq_x + mq_w/2, mq_y + 1.8, "SMOKE & GAS", fontsize=4.0, fontweight='bold', color='#FFFFFF', ha='center', va='center', zorder=10)

    # 4 Soldered Header Pins: VCC, GND, DOUT, AOUT (Facing right side of module)
    mq_pins = {}
    mq_labels = ["VCC", "GND", "DOUT", "AOUT"]
    for i, lbl in enumerate(mq_labels):
        py_m = mq_y + 2.5 + i * 3.2
        px_m = mq_x + mq_w + 1.4
        ax.add_patch(Circle((px_m, py_m), 0.65, facecolor='#F59E0B', edgecolor='#D97706', linewidth=0.5, zorder=10))
        ax.add_patch(Circle((px_m, py_m), 0.28, facecolor='#020617', zorder=11))
        ax.text(px_m - 1.8, py_m, lbl, fontsize=4.0, fontweight='bold', color='#FFFFFF', ha='right', va='center', zorder=11)
        mq_pins[lbl] = (px_m, py_m)

    # =========================================================================
    # COMPONENT 5: INDUSTRIAL HEAVY-DUTY RED MUSHROOM E-STOP BUTTON
    # Located at Bottom-Left: es_x=10.0, es_y=8.0
    # Includes Soldered RC Debounce Network (10kΩ + 100nF)
    # =========================================================================
    es_x, es_y = 10.0, 8.0
    # Yellow Industrial Base
    ax.add_patch(FancyBboxPatch((es_x, es_y), 12.0, 11.0, boxstyle="round,pad=0.1,rounding_size=0.6",
                                facecolor='#EAB308', edgecolor='#CA8A04', linewidth=1.2, zorder=8))
    # Red Mushroom Head (Top-Down View)
    ax.add_patch(Circle((es_x + 6.0, es_y + 5.5), 4.8, facecolor='#DC2626', edgecolor='#991B1B', linewidth=1.5, zorder=9))
    ax.add_patch(Circle((es_x + 6.0, es_y + 5.5), 3.4, facecolor='#EF4444', edgecolor='#B91C1C', linewidth=0.8, zorder=10))
    ax.text(es_x + 6.0, es_y + 5.5, "EMERGENCY\nSTOP", fontsize=4.8, fontweight='bold', color='#FFFFFF', ha='center', va='center', zorder=11)

    # Terminal Block of E-Stop (Right side of switch body)
    tb_es_x = es_x + 12.0
    t1_y, t2_y = es_y + 7.5, es_y + 3.5
    ax.add_patch(Rectangle((tb_es_x, es_y + 2.0), 3.0, 7.0, facecolor='#1E293B', edgecolor='#0F172A', linewidth=0.6, zorder=9))
    ax.add_patch(Circle((tb_es_x + 1.5, t1_y), 0.7, facecolor='#E2E8F0', edgecolor='#64748B', linewidth=0.6, zorder=10))
    ax.add_patch(Circle((tb_es_x + 1.5, t2_y), 0.7, facecolor='#E2E8F0', edgecolor='#64748B', linewidth=0.6, zorder=10))

    # --- SOLDERED HARDWARE RC DEBOUNCE NETWORK ---
    rc_node_x = tb_es_x + 6.0
    rc_node_y = t1_y

    # E-Stop lead to debounce node
    ax.plot([tb_es_x + 1.5, rc_node_x], [t1_y, t1_y], color='#EA580C', lw=2.4, zorder=15)
    ax.plot([tb_es_x + 1.5, rc_node_x, rc_node_x], [t2_y, t2_y, t2_y - 2.5], color='#1E293B', lw=2.4, zorder=15)

    # 10kΩ Resistor (Soldered directly near terminals)
    res_x, res_y = rc_node_x + 2.0, rc_node_y + 2.5
    ax.plot([rc_node_x, res_x, res_x + 4.0], [rc_node_y, res_y, res_y], color='#94A3B8', lw=1.6, zorder=16)
    ax.add_patch(FancyBboxPatch((res_x + 0.4, res_y - 0.7), 3.2, 1.4, boxstyle="round,pad=0.04,rounding_size=0.3",
                                facecolor='#F5E6CC', edgecolor='#D4C3A3', linewidth=0.6, zorder=17))
    # 4 Bands: Brown, Black, Orange, Gold (10kΩ 5%)
    ax.plot([res_x + 1.0, res_x + 1.0], [res_y - 0.7, res_y + 0.7], color='#78350F', lw=1.3, zorder=18)
    ax.plot([res_x + 1.6, res_x + 1.6], [res_y - 0.7, res_y + 0.7], color='#0F172A', lw=1.3, zorder=18)
    ax.plot([res_x + 2.2, res_x + 2.2], [res_y - 0.7, res_y + 0.7], color='#EA580C', lw=1.3, zorder=18)
    ax.plot([res_x + 2.8, res_x + 2.8], [res_y - 0.7, res_y + 0.7], color='#F59E0B', lw=1.0, zorder=18)
    ax.text(res_x + 2.0, res_y + 1.5, "10kΩ", fontsize=4.8, fontweight='bold', color='#F8FAFC', ha='center', va='bottom', zorder=19)

    # 100nF Ceramic Disc Capacitor (Soldered directly across node to Ground)
    cap_x, cap_y = rc_node_x + 2.0, rc_node_y - 2.5
    ax.plot([rc_node_x, cap_x, cap_x + 3.0], [rc_node_y, cap_y, cap_y], color='#94A3B8', lw=1.6, zorder=16)
    ax.add_patch(Circle((cap_x + 1.5, cap_y), 1.2, facecolor='#D97706', edgecolor='#B45309', linewidth=0.8, zorder=17))
    ax.text(cap_x + 1.5, cap_y, "104", fontsize=3.8, fontweight='bold', color='#FFFFFF', ha='center', va='center', zorder=18)
    ax.text(cap_x + 1.5, cap_y - 1.8, "100nF", fontsize=4.8, fontweight='bold', color='#F8FAFC', ha='center', va='top', zorder=19)

    # =========================================================================
    # COMPONENT 6: 5V 1-CHANNEL OPTOCOUPLER RELAY MODULE (Right Side of PCB)
    # ry_x=69.0, ry_y=28.0, ry_w=14.0, ry_h=22.0
    # =========================================================================
    ry_x, ry_y, ry_w, ry_h = 69.0, 28.0, 14.0, 22.0
    ax.add_patch(FancyBboxPatch((ry_x, ry_y), ry_w, ry_h, boxstyle="round,pad=0.1,rounding_size=0.6",
                                facecolor='#1E293B', edgecolor='#0F172A', linewidth=1.2, zorder=8))

    # Blue Songle Relay Cube
    ax.add_patch(FancyBboxPatch((ry_x + 1.2, ry_y + 6.0), 11.6, 14.5, boxstyle="round,pad=0.08,rounding_size=0.4",
                                facecolor='#1D4ED8', edgecolor='#1E3A8A', linewidth=1.0, zorder=9))
    ax.text(ry_x + 7.0, ry_y + 15.5, "SONGLE", fontsize=5.5, fontweight='bold', color='#FFFFFF', ha='center', va='center', zorder=10)
    ax.text(ry_x + 7.0, ry_y + 13.0, "SRD-05VDC-SL-C", fontsize=4.0, color='#93C5FD', ha='center', va='center', zorder=10)
    ax.text(ry_x + 7.0, ry_y + 10.0, "10A 250VAC / 10A 30VDC", fontsize=3.6, color='#E2E8F0', ha='center', va='center', zorder=10)

    # Optocoupler IC (EL817) & Transistor
    ax.add_patch(Rectangle((ry_x + 2.0, ry_y + 2.0), 3.0, 2.4, facecolor='#020617', edgecolor='#334155', linewidth=0.5, zorder=9))
    ax.text(ry_x + 3.5, ry_y + 3.2, "OPTO", fontsize=3.4, color='#94A3B8', ha='center', va='center', zorder=10)

    # Status LEDs (PWR=Green, Relay=Red)
    ax.add_patch(Rectangle((ry_x + 6.5, ry_y + 2.2), 1.0, 0.8, facecolor='#22C55E', zorder=10))
    ax.add_patch(Rectangle((ry_x + 8.5, ry_y + 2.2), 1.0, 0.8, facecolor='#EF4444', zorder=10))

    # Low-Voltage Logic Input Pins (Left side of relay: VCC, GND, IN)
    relay_in_pins = {}
    relay_labels = ["VCC", "GND", "IN"]
    for i, lbl in enumerate(relay_labels):
        py_r = ry_y + 2.0 + i * 2.2
        px_r = ry_x - 1.4
        ax.add_patch(Circle((px_r, py_r), 0.65, facecolor='#F59E0B', edgecolor='#D97706', linewidth=0.5, zorder=10))
        ax.add_patch(Circle((px_r, py_r), 0.28, facecolor='#020617', zorder=11))
        ax.text(px_r + 1.8, py_r, lbl, fontsize=4.0, fontweight='bold', color='#FFFFFF', ha='left', va='center', zorder=11)
        relay_in_pins[lbl] = (px_r, py_r)

    # High-Voltage Screw Terminals (Right side of relay: NO, COM, NC)
    terminal_x = ry_x + ry_w + 1.2
    term_labels = ["NO", "COM", "NC"]
    relay_out_pins = {}
    for i, lbl in enumerate(term_labels):
        py_t = ry_y + 8.0 + i * 4.4
        ax.add_patch(Rectangle((terminal_x - 1.2, py_t - 1.5), 3.0, 3.0, facecolor='#047857', edgecolor='#065F46', linewidth=0.8, zorder=9))
        ax.add_patch(Circle((terminal_x + 0.3, py_t), 0.9, facecolor='#E2E8F0', edgecolor='#64748B', linewidth=0.6, zorder=10))
        ax.text(terminal_x - 2.0, py_t, lbl, fontsize=4.2, fontweight='bold', color='#FFFFFF', ha='right', va='center', zorder=11)
        relay_out_pins[lbl] = (terminal_x + 0.3, py_t)

    # =========================================================================
    # COMPONENT 7: 12V HIGH-INTENSITY AMBER INDUSTRIAL STROBE SIREN
    # Located to the Right: str_x=102.0, str_y=28.0
    # =========================================================================
    str_x, str_y = 102.0, 28.0
    ax.add_patch(Circle((str_x, str_y + 10.0), 8.5, facecolor='#0F172A', edgecolor='#334155', linewidth=1.5, zorder=8))
    ax.add_patch(Circle((str_x, str_y + 10.0), 7.4, facecolor='#D97706', edgecolor='#B45309', linewidth=1.2, zorder=9))
    ax.add_patch(Circle((str_x, str_y + 10.0), 6.0, facecolor='#F59E0B', edgecolor='#FBBF24', linewidth=1.0, zorder=10))
    ax.add_patch(Circle((str_x, str_y + 10.0), 3.2, facecolor='#FEF08A', edgecolor='#EAB308', linewidth=0.8, zorder=11))
    ax.text(str_x, str_y + 10.0, "12V\nSTROBE\nSIREN", fontsize=4.8, fontweight='bold', color='#78350F', ha='center', va='center', zorder=12)

    # 12V Industrial Power Cable from Relay & DC Supply to Siren
    p_no = relay_out_pins["NO"]
    p_com = relay_out_pins["COM"]
    draw_orthogonal_trace([p_no, (str_x - 9.0, p_no[1]), (str_x - 9.0, str_y + 8.5), (str_x - 7.4, str_y + 8.5)], color='#EF4444', width=3.2, zorder=15)
    draw_orthogonal_trace([p_com, (p_com[0] + 3.0, p_com[1]), (p_com[0] + 3.0, str_y + 3.0), (str_x - 7.4, str_y + 3.0)], color='#1E293B', width=3.2, zorder=15)
    ax.text(p_com[0] + 3.5, str_y + 3.0, "+12V EXT DC", fontsize=4.6, fontweight='bold', color='#EF4444', ha='left', va='bottom', zorder=16)

    # =========================================================================
    # COMPONENT 8: TP-LINK TAPO C310 OUTDOOR IP CAMERA (VISION SUBSYSTEM)
    # Located at Upper Right: cam_x=104.0, cam_y=55.0
    # =========================================================================
    cam_x, cam_y, cam_w, cam_h = 104.0, 55.0, 16.0, 11.0
    ax.add_patch(FancyBboxPatch((cam_x - 4.5, cam_y + 1.5), 3.5, 8.0, boxstyle="round,pad=0.1,rounding_size=0.5",
                                facecolor='#E2E8F0', edgecolor='#64748B', linewidth=1.0, zorder=7))
    ax.add_patch(FancyBboxPatch((cam_x, cam_y), cam_w, cam_h, boxstyle="round,pad=0.2,rounding_size=1.4",
                                facecolor='#FFFFFF', edgecolor='#CBD5E1', linewidth=1.5, zorder=8))

    # Dual External Antennas
    ax.plot([cam_x + 3.0, cam_x + 1.0], [cam_y + cam_h, cam_y + cam_h + 5.5], color='#F1F5F9', lw=2.4, solid_capstyle='round', zorder=7)
    ax.plot([cam_x + cam_w - 3.0, cam_x + cam_w - 1.0], [cam_y + cam_h, cam_y + cam_h + 5.5], color='#F1F5F9', lw=2.4, solid_capstyle='round', zorder=7)

    # Lens
    ax.add_patch(Circle((cam_x + cam_w/2, cam_y + cam_h/2), 3.8, facecolor='#0F172A', edgecolor='#1E293B', linewidth=1.2, zorder=9))
    ax.add_patch(Circle((cam_x + cam_w/2, cam_y + cam_h/2), 2.2, facecolor='#0284C7', edgecolor='#38BDF8', linewidth=0.8, zorder=10))
    ax.add_patch(Circle((cam_x + cam_w/2 - 0.5, cam_y + cam_h/2 + 0.6), 0.5, facecolor='#FFFFFF', alpha=0.8, zorder=11))
    ax.text(cam_x + cam_w/2, cam_y + 1.8, "tapo C310", fontsize=5.0, fontweight='bold', color='#0284C7', ha='center', va='center', zorder=10)

    # Cat6 Ethernet Cable exiting Camera toward Edge AI PC
    eth_start = (cam_x + cam_w, cam_y + cam_h/2)
    ax.plot([eth_start[0], 126.0, 126.0], [eth_start[1], eth_start[1], 70.0], color='#0369A1', linewidth=5.2, zorder=6)
    ax.plot([eth_start[0], 126.0, 126.0], [eth_start[1], eth_start[1], 70.0], color='#38BDF8', linewidth=1.8, alpha=0.9, zorder=7)
    ax.add_patch(Rectangle((eth_start[0], eth_start[1] - 1.2), 2.6, 2.4, facecolor='#1E293B', edgecolor='#0F172A', linewidth=0.6, zorder=9))

    # =========================================================================
    # COMPONENT 9: WORKSTATION / EDGE AI PC (Top Left)
    # laptop_x=8.0, laptop_y=55.0
    # =========================================================================
    lap_x, lap_y, lap_w, lap_h = 7.0, 57.0, 16.0, 11.0
    ax.add_patch(FancyBboxPatch((lap_x, lap_y), lap_w, lap_h, boxstyle="round,pad=0.1,rounding_size=0.6",
                                facecolor='#1E293B', edgecolor='#475569', linewidth=1.2, zorder=7))
    ax.add_patch(Rectangle((lap_x + 1.0, lap_y + 1.0), lap_w - 2.0, lap_h - 2.0, facecolor='#020617', edgecolor='#0F172A', linewidth=0.8, zorder=8))
    ax.text(lap_x + lap_w/2, lap_y + lap_h/2 + 1.5, "EDGE AI ENGINE", fontsize=5.8, fontweight='bold', color='#38BDF8', ha='center', va='center', zorder=9)
    ax.text(lap_x + lap_w/2, lap_y + lap_h/2 - 1.2, "YOLOv8 + RTSP", fontsize=4.8, color='#94A3B8', ha='center', va='center', zorder=9)
    ax.text(lap_x + lap_w/2, lap_y + lap_h/2 - 3.2, "USB Telemetry In", fontsize=4.2, color='#22C55E', ha='center', va='center', zorder=9)

    # =========================================================================
    # PCB 90-DEGREE ORTHOGONAL WIRING TRACES (PERMANENT SOLDERED SOLID-CORE)
    # STRICT 90-DEGREE STRAIGHT BUSES ONLY — ZERO BREADBOARDS OR LOOPS!
    # =========================================================================

    # 1. +5V REGULATED BUS (SOLID RED): Arduino 5V -> Distribution Trunk
    p_nano_5v = nano_pins["5V"]
    bus_5v_y = 19.5
    draw_orthogonal_trace([p_nano_5v, (p_nano_5v[0] - 4.5, p_nano_5v[1]), (p_nano_5v[0] - 4.5, bus_5v_y), (px + 4.0, bus_5v_y)], color='#EF4444', width=3.0, zorder=16)

    # 5V Drops to GPS, MQ-2, Relay, E-Stop Pull-Up
    draw_orthogonal_trace([gps_pins["VCC"], (gps_pins["VCC"][0] + 1.5, gps_pins["VCC"][1]), (gps_pins["VCC"][0] + 1.5, 38.0), (p_nano_5v[0] - 4.5, 38.0)], color='#EF4444', width=2.4, zorder=16)
    draw_orthogonal_trace([mq_pins["VCC"], (mq_pins["VCC"][0] + 1.5, mq_pins["VCC"][1]), (mq_pins["VCC"][0] + 1.5, bus_5v_y + 1.2), (p_nano_5v[0] - 4.5, bus_5v_y + 1.2)], color='#EF4444', width=2.4, zorder=16)
    draw_orthogonal_trace([relay_in_pins["VCC"], (relay_in_pins["VCC"][0] - 2.5, relay_in_pins["VCC"][1]), (relay_in_pins["VCC"][0] - 2.5, bus_5v_y), (p_nano_5v[0] - 4.5, bus_5v_y)], color='#EF4444', width=2.4, zorder=16)
    draw_orthogonal_trace([(res_x + 4.0, res_y), (res_x + 6.5, res_y), (res_x + 6.5, bus_5v_y), (px + 4.0, bus_5v_y)], color='#EF4444', width=2.0, zorder=16)

    # 2. SYSTEM GROUND BUS (SOLID BLACK): Arduino GND -> Distribution Trunk
    p_nano_gnd = nano_pins["GND"]
    bus_gnd_y = 17.0
    draw_orthogonal_trace([p_nano_gnd, (p_nano_gnd[0] - 3.2, p_nano_gnd[1]), (p_nano_gnd[0] - 3.2, bus_gnd_y), (px + 3.0, bus_gnd_y)], color='#1E293B', width=3.0, zorder=15)

    # GND Drops to GPS, MQ-2, Relay, E-Stop Cap
    draw_orthogonal_trace([gps_pins["GND"], (gps_pins["GND"][0] + 2.5, gps_pins["GND"][1]), (gps_pins["GND"][0] + 2.5, 36.5), (p_nano_gnd[0] - 3.2, 36.5)], color='#1E293B', width=2.4, zorder=15)
    draw_orthogonal_trace([mq_pins["GND"], (mq_pins["GND"][0] + 2.5, mq_pins["GND"][1]), (mq_pins["GND"][0] + 2.5, bus_gnd_y + 1.2), (p_nano_gnd[0] - 3.2, bus_gnd_y + 1.2)], color='#1E293B', width=2.4, zorder=15)
    draw_orthogonal_trace([relay_in_pins["GND"], (relay_in_pins["GND"][0] - 1.5, relay_in_pins["GND"][1]), (relay_in_pins["GND"][0] - 1.5, bus_gnd_y), (p_nano_gnd[0] - 3.2, bus_gnd_y)], color='#1E293B', width=2.4, zorder=15)
    draw_orthogonal_trace([(cap_x + 3.0, cap_y), (cap_x + 5.0, cap_y), (cap_x + 5.0, bus_gnd_y), (px + 3.0, bus_gnd_y)], color='#1E293B', width=2.0, zorder=15)

    # 3. GPS TX -> ARDUINO D2 (SOLID GREEN)
    p_gps_tx = gps_pins["TX"]
    p_nano_d2 = nano_pins["D2"]
    draw_orthogonal_trace([p_gps_tx, (p_gps_tx[0] + 3.8, p_gps_tx[1]), (p_gps_tx[0] + 3.8, 56.0), (p_nano_d2[0] + 2.5, 56.0), (p_nano_d2[0] + 2.5, p_nano_d2[1]), p_nano_d2], color='#10B981', width=2.6, zorder=18)

    # 4. GPS RX -> ARDUINO D3 (SOLID YELLOW)
    p_gps_rx = gps_pins["RX"]
    p_nano_d3 = nano_pins["D3"]
    draw_orthogonal_trace([p_gps_rx, (p_gps_rx[0] + 4.8, p_gps_rx[1]), (p_gps_rx[0] + 4.8, 54.0), (p_nano_d3[0] + 4.0, 54.0), (p_nano_d3[0] + 4.0, p_nano_d3[1]), p_nano_d3], color='#F59E0B', width=2.6, zorder=18)

    # 5. MQ-2 AOUT -> ARDUINO A0 (SOLID BLUE)
    p_mq_aout = mq_pins["AOUT"]
    p_nano_a0 = nano_pins["A0"]
    draw_orthogonal_trace([p_mq_aout, (p_mq_aout[0] + 1.8, p_mq_aout[1]), (p_mq_aout[0] + 1.8, p_nano_a0[1]), p_nano_a0], color='#0284C7', width=2.6, zorder=18)

    # 6. E-STOP HARDWARE DEBOUNCED NODE -> ARDUINO D4 (SOLID ORANGE)
    p_nano_d4 = nano_pins["D4"]
    draw_orthogonal_trace([(rc_node_x, rc_node_y), (rc_node_x, 15.0), (p_nano_d4[0] + 5.5, 15.0), (p_nano_d4[0] + 5.5, p_nano_d4[1]), p_nano_d4], color='#EA580C', width=2.6, zorder=18)

    # 7. ARDUINO D8 -> RELAY IN1 (SOLID PURPLE)
    p_nano_d8 = nano_pins["D8"]
    p_relay_in = relay_in_pins["IN"]
    draw_orthogonal_trace([p_nano_d8, (p_nano_d8[0] + 2.0, p_nano_d8[1]), (p_nano_d8[0] + 2.0, p_relay_in[1]), p_relay_in], color='#A855F7', width=2.6, zorder=18)

    # =========================================================================
    # CALLOUT LABELS & ANNOTATIONS (CLEAN, PERIMETER POSITIONED, ZERO OVERLAPS)
    # =========================================================================

    # 1. Edge AI Engine PC
    draw_callout((lap_x + lap_w, lap_y + lap_h/2), (lap_x + lap_w + 3.0, 71.5), "Edge AI Engine PC", "YOLOv8 & RTSP Pipeline via USB Virtual COM", align="left")

    # 2. USB Telemetry Cable
    draw_callout((cable_x, 68.0), (cable_x + 3.0, 71.5), "Shielded USB Cable", "Bidirectional Serial (115200 bps)", align="left")

    # 3. Arduino Nano V3
    draw_callout((nx + nw/2, ny + nh), (nx + nw/2, 60.5), "Arduino Nano V3", "ATmega328P seated in Gold-Plated Female Headers", align="center")

    # 4. u-blox NEO-M8N GPS
    draw_callout((gx + gw/2, gy + gh), (gx - 3.0, 68.0), "u-blox NEO-M8N GNSS", "Ceramic Patch Antenna | D2(RX) - D3(TX)", align="right")

    # 5. MQ-2 Gas & Smoke Sensor
    draw_callout((mq_x, mq_y + mq_h/2), (mq_x - 3.0, 31.0), "MQ-2 Gas / Smoke Sensor", "Analog Out to Pin A0 (ADC Gas Metric)", align="right")

    # 6. Industrial E-Stop Push Button
    draw_callout((es_x, es_y + 5.5), (es_x - 1.0, 13.0), "Heavy-Duty E-Stop Button", "Twist-to-Reset Industrial Mushroom", align="right")

    # 7. Hardware RC Debounce
    draw_callout((rc_node_x + 1.5, t1_y), (rc_node_x + 1.5, 3.5), "Hardware RC Debounce Filter", "10kΩ Metal Film + 100nF Ceramic (τ = 1ms)", align="center")

    # 8. Zero PCB Perfboard
    draw_callout((px + 2.8, py + ph - 2.8), (px - 2.0, 52.0), "Zero PCB Perfboard Hub", "Double-Sided FR-4 on 4x Brass Hex Standoffs", align="right")

    # 9. 5V Optocoupler Relay
    draw_callout((ry_x + ry_w/2, ry_y + ry_h), (ry_x + ry_w/2, 54.0), "5V Optocoupler Relay Module", "2.5kV Galvanic Isolation | Driven by Pin D8", align="center")

    # 10. 12V Industrial Strobe Siren
    draw_callout((str_x, str_y + 18.5), (str_x, 50.0), "12V Industrial Strobe Siren", "High-Intensity Amber Flasher & Audible Alert", align="center")

    # 11. TP-Link Tapo C310 IP Camera
    draw_callout((cam_x + cam_w/2, cam_y + cam_h), (cam_x + cam_w/2, 71.5), "TP-Link Tapo C310 IP Camera", "3MP/1080p Stream to AI Engine PC", align="center")

    # 12. Cat6 Ethernet Cable
    draw_callout((125.0, 64.0), (105.0, 66.0), "Cat6 Shielded Ethernet", "Dedicated RTSP Video Transport Pipeline", align="left")

    # Save diagram
    plt.savefig(output_path, dpi=220, bbox_inches='tight', facecolor=bg_color, pad_inches=0.3)
    plt.close()
    print(f"2D Commercial Circuit Layout diagram successfully generated at: {output_path}")

if __name__ == "__main__":
    generate_2d_circuit_diagram("commercial_circuit_2d.png")
