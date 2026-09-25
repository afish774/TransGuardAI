"""
TransGuard AI — Publication-Grade Fritzing-Style Hardware Wiring Diagram
Matches exact aesthetic of maker electronics tutorials and user reference image:
- Pure white background (#FFFFFF)
- Authentic Fritzing component illustrations:
    * Arduino Nano (CH340) with signature teal PCB, ATmega328P, crystal, pins
    * Mini Breadboard (400 tie-points) with power rails, grid markings, and center trough
    * u-blox NEO-6M GPS module with tan ceramic patch antenna & RF shield
    * 5V Active buzzer module with cylindrical black housing & transistor
    * Red 5mm LED + 220 ohm 1/4W resistor (color banded)
    * TP-Link Tapo C100 FHD RTSP Camera with stand and 8GB microSD
- Realistic curved colored jumper wires (Cubic Beziers with PVC gloss & drop shadows)
- Clean, uncluttered perimeter callout labels with leader lines
- Zero overlapping labels or crossing through components
"""

import matplotlib.pyplot as plt
import matplotlib.patches as patches
from matplotlib.patches import FancyBboxPatch, Circle, Rectangle, PathPatch, Polygon
from matplotlib.path import Path
import numpy as np
import os

def generate_circuit_diagram(output_path="circuit_diagram.png"):
    # Canvas: 28 x 17 inches @ 220 DPI = 6160 x 3740 px (Ultra High Resolution)
    fig = plt.figure(figsize=(28, 17), dpi=220)
    ax = fig.add_axes([0, 0, 1, 1])
    ax.set_xlim(0, 126)
    ax.set_ylim(0, 72)
    ax.axis('off')

    bg_color = "#FFFFFF"
    fig.patch.set_facecolor(bg_color)
    ax.set_facecolor(bg_color)

    # =========================================================================
    # 1. HELPER: REALISTIC FRITZING CUBIC BEZIER JUMPER WIRE
    # =========================================================================
    def draw_wire(p1, p2, color, sag=0.0, curve_type="sag", wire_width=4.4, zorder=20):
        x1, y1 = p1
        x2, y2 = p2
        dx = x2 - x1
        dy = y2 - y1

        if curve_type == "sag":
            cx1 = x1 + dx * 0.25
            cy1 = y1 + dy * 0.1 - sag
            cx2 = x1 + dx * 0.75
            cy2 = y1 + dy * 0.9 - sag
        elif curve_type == "arch":
            cx1 = x1 + dx * 0.25
            cy1 = y1 + dy * 0.1 + sag
            cx2 = x1 + dx * 0.75
            cy2 = y1 + dy * 0.9 + sag
        elif curve_type == "over_top":
            cx1 = x1 - 3.5
            cy1 = y1 + sag
            cx2 = x2 - dx * 0.35
            cy2 = y2 + sag * 0.65
        elif curve_type == "s_curve":
            cx1 = x1 + dx * 0.45
            cy1 = y1 - sag
            cx2 = x1 + dx * 0.55
            cy2 = y2 + sag
        elif curve_type == "loop_down":
            min_y = min(y1, y2)
            cx1 = x1 + dx * 0.2
            cy1 = min_y - sag
            cx2 = x1 + dx * 0.8
            cy2 = min_y - sag
        else:
            cx1 = x1 + dx * 0.33
            cy1 = y1 + dy * 0.33
            cx2 = x1 + dx * 0.66
            cy2 = y1 + dy * 0.66

        verts = [(x1, y1), (cx1, cy1), (cx2, cy2), (x2, y2)]
        codes = [Path.MOVETO, Path.CURVE4, Path.CURVE4, Path.CURVE4]
        path = Path(verts, codes)

        # 1. Soft Ambient Drop Shadow
        shadow_verts = [(x1, y1 - 0.45), (cx1, cy1 - 0.6), (cx2, cy2 - 0.6), (x2, y2 - 0.45)]
        shadow_path = Path(shadow_verts, codes)
        ax.add_patch(PathPatch(shadow_path, facecolor='none', edgecolor='#94A3B8', 
                               linewidth=wire_width + 2.4, alpha=0.35, capstyle='round', zorder=zorder))

        # 2. Main PVC Insulation Body
        ax.add_patch(PathPatch(path, facecolor='none', edgecolor=color, 
                               linewidth=wire_width, capstyle='round', zorder=zorder + 1))

        # 3. Specular Glossy Reflection
        hi_verts = [(x1, y1 + 0.18), (cx1, cy1 + 0.25), (cx2, cy2 + 0.25), (x2, y2 + 0.18)]
        hi_path = Path(hi_verts, codes)
        ax.add_patch(PathPatch(hi_path, facecolor='none', edgecolor='#FFFFFF', 
                               linewidth=wire_width * 0.30, alpha=0.60, capstyle='round', zorder=zorder + 2))

        # 4. Dupont Connector Boot at both ends
        for (px, py) in [(x1, y1), (x2, y2)]:
            ax.add_patch(FancyBboxPatch((px - 0.55, py - 0.55), 1.1, 1.1, boxstyle="square,pad=0",
                                        facecolor='#1E293B', edgecolor='#0F172A', linewidth=0.8, zorder=zorder + 3))
            ax.add_patch(Circle((px, py), 0.24, facecolor='#CBD5E1', edgecolor='#334155', linewidth=0.4, zorder=zorder + 4))

    # =========================================================================
    # 2. HELPER: CLEAN MINIMAL CALLOUT LABELS (MATCHING REFERENCE IMAGE)
    # =========================================================================
    def draw_label(target_p, label_p, text, align="left", line_color="#475569"):
        tx, ty = target_p
        lx, ly = label_p
        
        # Leader line ending with anchor dot at target
        ax.plot([tx, lx], [ty, ly], color=line_color, linewidth=1.3, linestyle='-', zorder=35)
        ax.scatter([tx], [ty], color='#0F172A', s=28, zorder=36)

        # Crisp clean sans-serif text
        ax.text(lx, ly, text, fontsize=12.5, fontweight='bold', color='#0F172A',
                ha=align, va='center', family='sans-serif', zorder=37)

    # =========================================================================
    # COMPONENT 1: ARDUINO NANO (CH340)
    # Located at Left: nx=11.0, ny=17.0, nw=17.5, nh=36.0
    # =========================================================================
    nx, ny, nw, nh = 11.0, 17.0, 17.5, 36.0

    # Soft PCB Shadow
    ax.add_patch(FancyBboxPatch((nx + 0.6, ny - 0.6), nw, nh, boxstyle="round,pad=0.2,rounding_size=1.2",
                                facecolor='#CBD5E1', edgecolor='none', alpha=0.6, zorder=1))
    # Signature Teal Blue PCB
    ax.add_patch(FancyBboxPatch((nx, ny), nw, nh, boxstyle="round,pad=0.2,rounding_size=1.2",
                                facecolor='#00878F', edgecolor='#005F65', linewidth=1.6, zorder=2))

    # 4 Corner Mounting Holes
    for mx, my in [(nx + 1.2, ny + 1.2), (nx + nw - 1.2, ny + 1.2), (nx + 1.2, ny + nh - 1.2), (nx + nw - 1.2, ny + nh - 1.2)]:
        ax.add_patch(Circle((mx, my), 0.85, facecolor='#E2E8F0', edgecolor='#94A3B8', linewidth=0.8, zorder=3))
        ax.add_patch(Circle((mx, my), 0.50, facecolor='#FFFFFF', edgecolor='none', zorder=4))

    # Mini-B USB Port (Top center)
    usb_w, usb_h = 5.8, 4.4
    ax.add_patch(FancyBboxPatch((nx + nw/2 - usb_w/2, ny + nh - 2.0), usb_w, usb_h, boxstyle="round,pad=0.1,rounding_size=0.4",
                                facecolor='#E2E8F0', edgecolor='#64748B', linewidth=1.2, zorder=5))
    ax.add_patch(Rectangle((nx + nw/2 - 2.0, ny + nh + 0.6), 4.0, 1.4, facecolor='#0F172A', edgecolor='#334155', linewidth=0.6, zorder=6))

    # USB Cable extending out to upper-left
    usb_out_x = nx + nw/2
    usb_out_y = ny + nh + 2.0
    ax.add_patch(FancyBboxPatch((usb_out_x - 1.6, usb_out_y), 3.2, 3.0, boxstyle="round,pad=0.1,rounding_size=0.3",
                                facecolor='#334155', edgecolor='#0F172A', linewidth=1.0, zorder=7))
    # Cable path
    cable_v = [(usb_out_x, usb_out_y + 3.0), (usb_out_x, usb_out_y + 7.5), (usb_out_x - 8.0, 64.0), (3.0, 64.0)]
    cable_c = [Path.MOVETO, Path.CURVE4, Path.CURVE4, Path.CURVE4]
    ax.add_patch(PathPatch(Path(cable_v, cable_c), facecolor='none', edgecolor='#94A3B8', linewidth=7.0, alpha=0.3, zorder=4))
    ax.add_patch(PathPatch(Path(cable_v, cable_c), facecolor='none', edgecolor='#0284C7', linewidth=5.2, zorder=5))
    ax.add_patch(PathPatch(Path(cable_v, cable_c), facecolor='none', edgecolor='#38BDF8', linewidth=1.6, alpha=0.8, zorder=6))

    # ATmega328P Microcontroller (Rotated diamond classic Nano style)
    mc_x, mc_y = nx + nw/2, ny + nh/2 + 2.0
    mc_size = 4.2
    diamond_pts = np.array([
        [mc_x, mc_y + mc_size],
        [mc_x + mc_size, mc_y],
        [mc_x, mc_y - mc_size],
        [mc_x - mc_size, mc_y]
    ])
    ax.add_patch(Polygon(diamond_pts, facecolor='#1E293B', edgecolor='#0F172A', linewidth=1.0, zorder=5))
    ax.add_patch(Circle((mc_x, mc_y + mc_size - 0.9), 0.35, facecolor='#94A3B8', zorder=6))
    ax.text(mc_x, mc_y, "MEGA\n328P", fontsize=6.0, fontweight='bold', color='#F1F5F9', ha='center', va='center', zorder=6)

    # Pins around ATmega328P
    for offset in [-2.4, -0.8, 0.8, 2.4]:
        ax.plot([mc_x + offset - 0.6, mc_x + offset], [mc_y + mc_size - abs(offset) + 0.6, mc_y + mc_size - abs(offset)], color='#CBD5E1', lw=1.0, zorder=4)

    # 16 MHz Crystal Oscillator
    ax.add_patch(FancyBboxPatch((mc_x - 1.8, mc_y - 6.2), 3.6, 1.6, boxstyle="round,pad=0.1,rounding_size=0.6",
                                facecolor='#CBD5E1', edgecolor='#64748B', linewidth=0.8, zorder=4))
    ax.text(mc_x, mc_y - 5.4, "16.000", fontsize=4.6, fontweight='bold', color='#475569', ha='center', va='center', zorder=5)

    # Reset Button
    ax.add_patch(FancyBboxPatch((mc_x - 1.4, mc_y - 10.0), 2.8, 2.2, boxstyle="round,pad=0.1,rounding_size=0.3",
                                facecolor='#94A3B8', edgecolor='#475569', linewidth=0.8, zorder=4))
    ax.add_patch(Circle((mc_x, mc_y - 8.9), 0.75, facecolor='#DC2626', edgecolor='#991B1B', linewidth=0.6, zorder=5))

    # Silkscreen Branding
    ax.text(nx + nw/2, ny + nh - 4.4, "ARDUINO", fontsize=8.2, fontweight='bold', color='#FFFFFF', ha='center', va='center', zorder=4)
    ax.text(nx + nw/2, ny + nh - 6.2, "NANO", fontsize=6.5, fontweight='bold', color='#E2E8F0', ha='center', va='center', zorder=4)

    # Status LEDs (PWR, L, TX, RX)
    for idx, (lx, ly, col, lbl) in enumerate([(nx + 4.0, ny + nh - 9.2, '#22C55E', 'ON'),
                                              (nx + nw - 4.0, ny + nh - 9.2, '#EAB308', 'L'),
                                              (nx + 4.0, ny + nh - 11.8, '#EAB308', 'TX'),
                                              (nx + nw - 4.0, ny + nh - 11.8, '#EAB308', 'RX')]):
        ax.add_patch(Rectangle((lx - 0.45, ly - 0.35), 0.9, 0.7, facecolor=col, edgecolor='#1E293B', linewidth=0.4, zorder=4))
        ax.text(lx + (1.0 if idx % 2 == 0 else -1.0), ly, lbl, fontsize=4.6, fontweight='bold', color='#FFFFFF', ha='center', va='center', zorder=4)

    # Standard Nano Pinout
    left_pin_labels = ["D13", "3V3", "REF", "A0", "A1", "A2", "A3", "A4", "A5", "A6", "A7", "5V", "RST", "GND", "VIN"]
    right_pin_labels = ["D12", "D11", "D10", "D9", "D8", "D7", "D6", "D5", "D4", "D3", "D2", "GND", "RST", "RX", "TX"]

    nano_pins = {}
    pin_spacing = (nh - 6.5) / 14.0
    for i in range(15):
        py = ny + 3.2 + i * pin_spacing
        
        # Left Pin
        px_l = nx + 1.1
        ax.add_patch(Circle((px_l, py), 0.78, facecolor='#E2E8F0', edgecolor='#64748B', linewidth=0.8, zorder=4))
        ax.add_patch(Circle((px_l, py), 0.35, facecolor='#0F172A', zorder=5))
        ax.text(px_l + 1.5, py, left_pin_labels[i], fontsize=5.6, fontweight='bold', color='#FFFFFF', ha='left', va='center', zorder=6)
        nano_pins[left_pin_labels[i]] = (px_l, py)

        # Right Pin
        px_r = nx + nw - 1.1
        ax.add_patch(Circle((px_r, py), 0.78, facecolor='#E2E8F0', edgecolor='#64748B', linewidth=0.8, zorder=4))
        ax.add_patch(Circle((px_r, py), 0.35, facecolor='#0F172A', zorder=5))
        ax.text(px_r - 1.5, py, right_pin_labels[i], fontsize=5.6, fontweight='bold', color='#FFFFFF', ha='right', va='center', zorder=6)
        nano_pins[right_pin_labels[i]] = (px_r, py)

    # =========================================================================
    # COMPONENT 2: MINI BREADBOARD (400 TIE-POINTS)
    # Located at Center: bx=38.0, by=17.0, bw=50.0, bh=33.0
    # =========================================================================
    bx, by, bw, bh = 38.0, 17.0, 50.0, 33.0

    # Soft Shadow
    ax.add_patch(FancyBboxPatch((bx + 0.8, by - 0.8), bw, bh, boxstyle="round,pad=0.2,rounding_size=1.0",
                                facecolor='#CBD5E1', edgecolor='none', alpha=0.5, zorder=1))
    # Breadboard Ivory Body
    ax.add_patch(FancyBboxPatch((bx, by), bw, bh, boxstyle="round,pad=0.2,rounding_size=1.0",
                                facecolor='#F8FAFC', edgecolor='#CBD5E1', linewidth=1.5, zorder=2))

    # Center Divider Trough
    trough_y = by + bh/2
    ax.add_patch(Rectangle((bx + 3.0, trough_y - 0.8), bw - 6.0, 1.6, facecolor='#E2E8F0', edgecolor='none', zorder=3))

    # Top Power Rails (+ and -)
    ax.plot([bx + 4.0, bx + bw - 4.0], [by + bh - 2.2, by + bh - 2.2], color='#EF4444', linewidth=1.5, zorder=3)
    ax.plot([bx + 4.0, bx + bw - 4.0], [by + bh - 4.4, by + bh - 4.4], color='#3B82F6', linewidth=1.5, zorder=3)
    ax.text(bx + 2.2, by + bh - 2.2, "+", fontsize=11.0, fontweight='bold', color='#EF4444', ha='center', va='center', zorder=4)
    ax.text(bx + 2.2, by + bh - 4.4, "-", fontsize=13.0, fontweight='bold', color='#3B82F6', ha='center', va='center', zorder=4)

    # Bottom Power Rails (+ and -)
    ax.plot([bx + 4.0, bx + bw - 4.0], [by + 4.4, by + 4.4], color='#EF4444', linewidth=1.5, zorder=3)
    ax.plot([bx + 4.0, bx + bw - 4.0], [by + 2.2, by + 2.2], color='#3B82F6', linewidth=1.5, zorder=3)
    ax.text(bx + 2.2, by + 4.4, "+", fontsize=11.0, fontweight='bold', color='#EF4444', ha='center', va='center', zorder=4)
    ax.text(bx + 2.2, by + 2.2, "-", fontsize=13.0, fontweight='bold', color='#3B82F6', ha='center', va='center', zorder=4)

    # 30 Columns of tie points
    cols = 30
    col_x = np.linspace(bx + 5.0, bx + bw - 5.0, cols)
    
    # Power rail socket holes
    for cx_pt in col_x:
        ax.add_patch(Circle((cx_pt, by + bh - 2.2), 0.23, facecolor='#334155', edgecolor='none', zorder=4))
        ax.add_patch(Circle((cx_pt, by + bh - 4.4), 0.23, facecolor='#334155', edgecolor='none', zorder=4))
        ax.add_patch(Circle((cx_pt, by + 4.4), 0.23, facecolor='#334155', edgecolor='none', zorder=4))
        ax.add_patch(Circle((cx_pt, by + 2.2), 0.23, facecolor='#334155', edgecolor='none', zorder=4))

    # Grid tie-point holes (5 rows top, 5 rows bottom)
    row_y_top = np.linspace(trough_y + 1.6, by + bh - 6.6, 5)
    row_y_bot = np.linspace(by + 6.6, trough_y - 1.6, 5)

    for cx_pt in col_x:
        for ry in row_y_top:
            ax.add_patch(Circle((cx_pt, ry), 0.20, facecolor='#94A3B8', edgecolor='none', zorder=4))
        for ry in row_y_bot:
            ax.add_patch(Circle((cx_pt, ry), 0.20, facecolor='#94A3B8', edgecolor='none', zorder=4))

    # Breadboard column numbers
    for idx in [0, 4, 9, 14, 19, 24, 29]:
        ax.text(col_x[idx], by + bh - 5.5, str(idx + 1), fontsize=4.8, fontweight='bold', color='#64748B', ha='center', va='center', zorder=5)
        ax.text(col_x[idx], by + 5.5, str(idx + 1), fontsize=4.8, fontweight='bold', color='#64748B', ha='center', va='center', zorder=5)

    # =========================================================================
    # COMPONENT 3: u-blox NEO-6M GPS MODULE
    # Mounted on Breadboard (gx=41.5, gy=21.0)
    # =========================================================================
    gx, gy, gw, gh = 41.5, 21.0, 12.5, 15.5
    # Shadow
    ax.add_patch(FancyBboxPatch((gx + 0.4, gy - 0.4), gw, gh, boxstyle="round,pad=0.1,rounding_size=0.5",
                                facecolor='#CBD5E1', edgecolor='none', alpha=0.6, zorder=5))
    # Blue PCB
    ax.add_patch(FancyBboxPatch((gx, gy), gw, gh, boxstyle="round,pad=0.1,rounding_size=0.5",
                                facecolor='#1D4ED8', edgecolor='#1E3A8A', linewidth=1.2, zorder=6))

    # Ceramic Patch Antenna (Square tan block with silver center electrode)
    ax.add_patch(FancyBboxPatch((gx + 1.2, gy + 4.2), 10.1, 10.1, boxstyle="round,pad=0.1,rounding_size=0.4",
                                facecolor='#E2CBAF', edgecolor='#B59975', linewidth=1.0, zorder=7))
    ax.add_patch(Circle((gx + 6.25, gy + 9.25), 1.8, facecolor='#CBD5E1', edgecolor='#94A3B8', linewidth=0.8, zorder=8))
    ax.text(gx + 6.25, gy + 9.25, "1575", fontsize=4.8, fontweight='bold', color='#475569', ha='center', va='center', zorder=9)

    # Metal RF Shield (u-blox NEO-6M)
    ax.add_patch(FancyBboxPatch((gx + 1.3, gy + 1.3), 9.9, 2.3, boxstyle="round,pad=0.05,rounding_size=0.2",
                                facecolor='#CBD5E1', edgecolor='#64748B', linewidth=0.6, zorder=7))
    ax.text(gx + 6.25, gy + 2.45, "u-blox NEO-6M", fontsize=5.0, fontweight='bold', color='#1E293B', ha='center', va='center', zorder=8)

    # 4-pin header at bottom: VCC, GND, TX, RX
    gps_pins = {}
    gps_labels = ["VCC", "GND", "TX", "RX"]
    for i, lbl in enumerate(gps_labels):
        px = gx + 2.1 + i * 2.7
        py = gy - 1.1
        ax.add_patch(Rectangle((px - 0.65, gy - 0.4), 1.3, 1.1, facecolor='#0F172A', edgecolor='#334155', linewidth=0.5, zorder=8))
        ax.add_patch(Circle((px, py), 0.35, facecolor='#E2E8F0', edgecolor='#64748B', linewidth=0.5, zorder=9))
        ax.text(px, gy + 0.45, lbl, fontsize=4.4, fontweight='bold', color='#FFFFFF', ha='center', va='bottom', zorder=8)
        gps_pins[lbl] = (px, py)

    # =========================================================================
    # COMPONENT 4: 5V ACTIVE BUZZER MODULE
    # Mounted on Breadboard (zx=58.0, zy=21.0)
    # =========================================================================
    zx, zy, zw, zh = 58.0, 21.0, 11.5, 15.5
    # Shadow
    ax.add_patch(FancyBboxPatch((zx + 0.4, zy - 0.4), zw, zh, boxstyle="round,pad=0.1,rounding_size=0.5",
                                facecolor='#CBD5E1', edgecolor='none', alpha=0.6, zorder=5))
    # Dark PCB
    ax.add_patch(FancyBboxPatch((zx, zy), zw, zh, boxstyle="round,pad=0.1,rounding_size=0.5",
                                facecolor='#1E293B', edgecolor='#0F172A', linewidth=1.2, zorder=6))

    # Black Cylindrical Buzzer
    buzzer_cx, buzzer_cy = zx + zw/2, zy + 9.2
    ax.add_patch(Circle((buzzer_cx, buzzer_cy), 4.5, facecolor='#0F172A', edgecolor='#334155', linewidth=1.5, zorder=7))
    ax.add_patch(Circle((buzzer_cx, buzzer_cy), 3.7, facecolor='#1E293B', edgecolor='#475569', linewidth=0.8, zorder=8))
    # Sound hole
    ax.add_patch(Circle((buzzer_cx, buzzer_cy), 1.2, facecolor='#020617', edgecolor='none', zorder=9))
    ax.text(buzzer_cx - 2.4, buzzer_cy + 2.4, "+", fontsize=8.5, fontweight='bold', color='#FFFFFF', ha='center', va='center', zorder=10)
    ax.text(buzzer_cx, buzzer_cy - 2.4, "ACTIVE", fontsize=4.8, fontweight='bold', color='#94A3B8', ha='center', va='center', zorder=10)

    # Transistor Q1
    ax.add_patch(Rectangle((zx + 2.2, zy + 1.8), 2.4, 1.5, facecolor='#0F172A', edgecolor='#334155', linewidth=0.5, zorder=7))
    ax.text(zx + 3.4, zy + 2.55, "Q1", fontsize=4.0, color='#94A3B8', ha='center', va='center', zorder=8)

    # 3-pin header at bottom: VCC, GND, I/O
    buzzer_pins = {}
    buzzer_labels = ["VCC", "GND", "I/O"]
    for i, lbl in enumerate(buzzer_labels):
        px = zx + 2.6 + i * 3.1
        py = zy - 1.1
        ax.add_patch(Rectangle((px - 0.65, zy - 0.4), 1.3, 1.1, facecolor='#0F172A', edgecolor='#334155', linewidth=0.5, zorder=8))
        ax.add_patch(Circle((px, py), 0.35, facecolor='#E2E8F0', edgecolor='#64748B', linewidth=0.5, zorder=9))
        ax.text(px, zy + 0.45, lbl, fontsize=4.4, fontweight='bold', color='#FFFFFF', ha='center', va='bottom', zorder=8)
        buzzer_pins[lbl] = (px, py)

    # =========================================================================
    # COMPONENT 5: RED 5mm LED + 220 OHM RESISTOR
    # Mounted on Breadboard (lx=73.5, ly=27.5)
    # =========================================================================
    lx, ly = 73.5, 27.5
    
    # 220 Ohm Resistor
    res_x, res_y = lx, ly
    ax.plot([res_x - 3.2, res_x + 5.2], [res_y, res_y], color='#94A3B8', linewidth=1.6, zorder=6)
    ax.add_patch(FancyBboxPatch((res_x, res_y - 1.0), 3.4, 2.0, boxstyle="round,pad=0.05,rounding_size=0.4",
                                facecolor='#F5E6CC', edgecolor='#D4C3A3', linewidth=0.8, zorder=7))
    # 4 Color Bands: Red, Red, Brown, Gold
    ax.plot([res_x + 0.7, res_x + 0.7], [res_y - 1.0, res_y + 1.0], color='#EF4444', linewidth=1.8, zorder=8)
    ax.plot([res_x + 1.4, res_x + 1.4], [res_y - 1.0, res_y + 1.0], color='#EF4444', linewidth=1.8, zorder=8)
    ax.plot([res_x + 2.1, res_x + 2.1], [res_y - 1.0, res_y + 1.0], color='#78350F', linewidth=1.8, zorder=8)
    ax.plot([res_x + 2.8, res_x + 2.8], [res_y - 1.0, res_y + 1.0], color='#F59E0B', linewidth=1.4, zorder=8)
    ax.text(res_x + 1.7, res_y - 2.0, "220 Ω", fontsize=6.8, fontweight='bold', color='#1E293B', ha='center', va='center', zorder=9)

    # Red 5mm LED
    led_cx, led_cy = lx + 8.2, ly + 5.5
    # LED Flange
    ax.add_patch(FancyBboxPatch((led_cx - 2.4, led_cy - 2.6), 4.8, 1.4, boxstyle="round,pad=0.05,rounding_size=0.3",
                                facecolor='#DC2626', edgecolor='#991B1B', linewidth=0.8, zorder=7))
    # LED Dome
    ax.add_patch(FancyBboxPatch((led_cx - 2.0, led_cy - 1.8), 4.0, 4.6, boxstyle="round,pad=0.1,rounding_size=2.0",
                                facecolor='#EF4444', edgecolor='#B91C1C', linewidth=1.2, zorder=8))
    # Specular shine
    ax.add_patch(Circle((led_cx - 0.8, led_cy + 1.4), 0.6, facecolor='#FCA5A5', edgecolor='none', zorder=9))
    # Internal anvil & post
    ax.plot([led_cx - 0.7, led_cx - 0.7], [led_cy - 1.6, led_cy + 0.6], color='#F87171', linewidth=1.0, zorder=9)
    ax.plot([led_cx + 0.7, led_cx + 0.7], [led_cy - 1.6, led_cy + 0.9], color='#F87171', linewidth=1.0, zorder=9)

    # LED Leads
    ax.plot([led_cx - 1.0, led_cx - 1.0, res_x + 5.2], [led_cy - 2.6, res_y, res_y], color='#94A3B8', linewidth=1.6, zorder=6)
    led_cathode_hole = (led_cx + 1.0, by + 4.4)
    ax.plot([led_cx + 1.0, led_cx + 1.0], [led_cy - 2.6, by + 4.4], color='#334155', linewidth=1.8, zorder=6)
    ax.add_patch(Circle(led_cathode_hole, 0.35, facecolor='#1E293B', zorder=7))

    resistor_in_pin = (res_x - 3.2, res_y)

    # =========================================================================
    # COMPONENT 6: TP-LINK TAPO C100 RTSP CAMERA
    # Located at Right: cam_cx=108.0, cam_cy=33.0
    # =========================================================================
    cam_cx, cam_cy = 108.0, 33.0
    cw, ch = 14.0, 14.0

    # Stand Base
    ax.add_patch(FancyBboxPatch((cam_cx - 5.5, cam_cy - 9.8), 11.0, 2.0, boxstyle="round,pad=0.1,rounding_size=0.9",
                                facecolor='#F8FAFC', edgecolor='#CBD5E1', linewidth=1.4, zorder=3))
    # Stand Stem & Swivel Ball
    ax.add_patch(Rectangle((cam_cx - 1.2, cam_cy - 8.0), 2.4, 4.4, facecolor='#E2E8F0', edgecolor='#94A3B8', linewidth=0.8, zorder=3))
    ax.add_patch(Circle((cam_cx, cam_cy - 3.6), 1.8, facecolor='#CBD5E1', edgecolor='#64748B', linewidth=0.8, zorder=4))

    # Camera Body Drop Shadow
    ax.add_patch(FancyBboxPatch((cam_cx - cw/2 + 0.4, cam_cy - ch/2 - 0.4), cw, ch, boxstyle="round,pad=0.2,rounding_size=2.4",
                                facecolor='#CBD5E1', edgecolor='none', alpha=0.5, zorder=4))
    # Camera Body (Glossy pure white rounded square)
    ax.add_patch(FancyBboxPatch((cam_cx - cw/2, cam_cy - ch/2), cw, ch, boxstyle="round,pad=0.2,rounding_size=2.4",
                                facecolor='#FFFFFF', edgecolor='#CBD5E1', linewidth=1.6, zorder=5))

    # Front Circular Lens Face (Jet black)
    ax.add_patch(Circle((cam_cx, cam_cy + 0.6), 4.8, facecolor='#0F172A', edgecolor='#1E293B', linewidth=1.5, zorder=6))
    ax.add_patch(Circle((cam_cx, cam_cy + 0.6), 4.0, facecolor='#020617', edgecolor='#334155', linewidth=0.8, zorder=7))
    
    # Camera Glass Optical Lens (Sapphire / AR Blue)
    ax.add_patch(Circle((cam_cx, cam_cy + 0.6), 2.5, facecolor='#0369A1', edgecolor='#0284C7', linewidth=1.0, zorder=8))
    ax.add_patch(Circle((cam_cx, cam_cy + 0.6), 1.6, facecolor='#0F172A', edgecolor='#38BDF8', linewidth=0.6, zorder=9))
    ax.add_patch(Circle((cam_cx - 0.6, cam_cy + 1.2), 0.55, facecolor='#38BDF8', alpha=0.85, zorder=10))

    # Status LED (Green) & Mic Pinhole
    ax.add_patch(Circle((cam_cx, cam_cy + 5.0), 0.42, facecolor='#22C55E', edgecolor='#15803D', linewidth=0.4, zorder=7))
    ax.add_patch(Circle((cam_cx, cam_cy - 3.4), 0.30, facecolor='#334155', zorder=7))

    # Tapo Branding
    ax.text(cam_cx, cam_cy - 4.8, "tapo", fontsize=9.0, fontweight='bold', color='#0284C7', ha='center', va='center', zorder=7)
    ax.text(cam_cx, cam_cy - 5.8, "1080p FHD", fontsize=5.0, fontweight='bold', color='#94A3B8', ha='center', va='center', zorder=7)

    # 8GB MicroSD Card inserted into camera side slot
    sd_x = cam_cx + cw/2 - 0.6
    sd_y = cam_cy
    ax.add_patch(FancyBboxPatch((sd_x, sd_y - 2.0), 2.6, 4.0, boxstyle="round,pad=0.05,rounding_size=0.3",
                                facecolor='#DC2626', edgecolor='#991B1B', linewidth=0.8, zorder=8))
    ax.text(sd_x + 1.3, sd_y + 0.5, "8GB", fontsize=4.8, fontweight='bold', color='#FFFFFF', ha='center', va='center', zorder=9)
    ax.text(sd_x + 1.3, sd_y - 0.7, "SD", fontsize=4.2, fontweight='bold', color='#FFFFFF', ha='center', va='center', zorder=9)

    # 9V DC Power Cable & Wall Adapter Brick (Matching Battery Pack in Reference)
    pwr_x = cam_cx - cw/2 + 0.8
    pwr_y = cam_cy - 4.6
    ax.add_patch(Rectangle((pwr_x - 1.8, pwr_y - 0.6), 1.8, 1.2, facecolor='#1E293B', edgecolor='#0F172A', linewidth=0.6, zorder=8))
    # Curved power cable down to power adapter
    pwr_v = [(pwr_x - 1.8, pwr_y), (pwr_x - 5.0, pwr_y), (95.0, 24.0), (95.0, 18.0)]
    pwr_c = [Path.MOVETO, Path.CURVE4, Path.CURVE4, Path.CURVE4]
    ax.add_patch(PathPatch(Path(pwr_v, pwr_c), facecolor='none', edgecolor='#334155', linewidth=3.4, zorder=6))

    # Realistic 9V DC Wall Power Adapter Brick
    brick_x, brick_y = 92.0, 12.0
    ax.add_patch(FancyBboxPatch((brick_x, brick_y), 6.0, 5.0, boxstyle="round,pad=0.1,rounding_size=0.4",
                                facecolor='#1E293B', edgecolor='#0F172A', linewidth=1.2, zorder=7))
    ax.text(brick_x + 3.0, brick_y + 2.5, "9V DC\n0.6A", fontsize=5.5, fontweight='bold', color='#F1F5F9', ha='center', va='center', zorder=8)

    # =========================================================================
    # JUMPER WIRE ROUTING (CLEAN FRITZING STYLE, ZERO CROSSINGS OVER PARTS)
    # ALL SIGNAL WIRES STAY STRICTLY ABOVE Y=16.5 TO PREVENT CROSSING LABELS!
    # =========================================================================

    # 1. 5V POWER (RED WIRE): Arduino 5V -> Breadboard Top Red (+) Rail
    # Leaves left pin, arches high over top of Nano at y=60 to stay clear of all labels and parts!
    p_nano_5v = nano_pins["5V"]
    p_bb_top_red = (bx + 6.0, by + bh - 2.2)
    draw_wire(p_nano_5v, p_bb_top_red, color='#EF4444', sag=14.0, curve_type="over_top", wire_width=4.4)

    # 2. GROUND (BLACK WIRE): Arduino GND -> Breadboard Top Blue (-) Rail
    p_nano_gnd = nano_pins["GND"]
    p_bb_top_blue = (bx + 9.5, by + bh - 4.4)
    draw_wire(p_nano_gnd, p_bb_top_blue, color='#1E293B', sag=4.0, curve_type="arch", wire_width=4.4)

    # 3. POWER JUMPERS: Top Rails -> Bottom Rails (Neatly along left breadboard margin)
    draw_wire((bx + 4.0, by + bh - 2.2), (bx + 4.0, by + 4.4), color='#EF4444', sag=1.8, curve_type="s_curve", wire_width=3.6)
    draw_wire((bx + 6.5, by + bh - 4.4), (bx + 6.5, by + 2.2), color='#1E293B', sag=1.8, curve_type="s_curve", wire_width=3.6)

    # 4. GPS VCC (RED WIRE): Bottom Red Rail -> GPS VCC
    p_gps_vcc = gps_pins["VCC"]
    draw_wire((p_gps_vcc[0], by + 4.4), p_gps_vcc, color='#EF4444', sag=0.8, curve_type="arch", wire_width=3.4)

    # 5. GPS GND (BLACK WIRE): Bottom Blue Rail -> GPS GND
    p_gps_gnd = gps_pins["GND"]
    draw_wire((p_gps_gnd[0], by + 2.2), p_gps_gnd, color='#1E293B', sag=0.8, curve_type="arch", wire_width=3.4)

    # 6. GPS TX -> Arduino Nano D2 (GREEN WIRE)
    p_gps_tx = gps_pins["TX"]
    p_nano_d2 = nano_pins["D2"]
    draw_wire(p_gps_tx, p_nano_d2, color='#10B981', sag=3.0, curve_type="sag", wire_width=4.0)

    # 7. GPS RX -> Arduino Nano D3 (YELLOW WIRE)
    p_gps_rx = gps_pins["RX"]
    p_nano_d3 = nano_pins["D3"]
    draw_wire(p_gps_rx, p_nano_d3, color='#F59E0B', sag=3.8, curve_type="sag", wire_width=4.0)

    # 8. BUZZER VCC (RED WIRE): Bottom Red Rail -> Buzzer VCC
    p_buzzer_vcc = buzzer_pins["VCC"]
    draw_wire((p_buzzer_vcc[0], by + 4.4), p_buzzer_vcc, color='#EF4444', sag=0.8, curve_type="arch", wire_width=3.4)

    # 9. BUZZER GND (BLACK WIRE): Bottom Blue Rail -> Buzzer GND
    p_buzzer_gnd = buzzer_pins["GND"]
    draw_wire((p_buzzer_gnd[0], by + 2.2), p_buzzer_gnd, color='#1E293B', sag=0.8, curve_type="arch", wire_width=3.4)

    # 10. BUZZER I/O -> Arduino Nano D8 (ORANGE WIRE)
    # Kept tight above y=17.0
    p_buzzer_io = buzzer_pins["I/O"]
    p_nano_d8 = nano_pins["D8"]
    draw_wire(p_buzzer_io, p_nano_d8, color='#EA580C', sag=2.6, curve_type="sag", wire_width=4.0)

    # 11. LED CONTROL -> Arduino Nano D9 (BLUE WIRE)
    # Kept tight above y=17.0
    p_nano_d9 = nano_pins["D9"]
    draw_wire(p_nano_d9, resistor_in_pin, color='#2563EB', sag=3.2, curve_type="sag", wire_width=4.0)

    # 12. LED CATHODE -> Breadboard Blue Rail (BLACK WIRE)
    draw_wire(led_cathode_hole, (led_cathode_hole[0], by + 2.2), color='#1E293B', sag=0.5, curve_type="sag", wire_width=3.2)

    # =========================================================================
    # CALLOUT LABELS (MATCHING EXACT STYLE OF USER'S REFERENCE IMAGE)
    # ELEGANT PERIMETER PLACEMENT, SHORT CLEAN LEADER LINES, ZERO COLLISIONS
    # =========================================================================

    # 1. Arduino Nano (Well above Nano & red wire)
    draw_label((nx + nw/2, ny + nh), (nx + nw/2, 66.0), "Arduino Nano (CH340)", align="center")

    # 2. USB Cable to PC / Host (Upper left)
    draw_label((usb_out_x - 5.0, 63.5), (3.0, 68.0), "USB Cable (To Host PC)", align="left")

    # 3. NEO-6M GPS Module (Above GPS module)
    draw_label((gx + gw/2, gy + gh), (gx + gw/2, 57.5), "NEO-6M GPS Module", align="center")

    # 4. 5V Active Buzzer (Above buzzer)
    draw_label((buzzer_cx, zy + zh), (buzzer_cx, 57.5), "5V Active Buzzer", align="center")

    # 5. Red LED (Above LED)
    draw_label((led_cx, led_cy + 4.8), (led_cx, 57.5), "Red LED", align="center")

    # 6. Mini Breadboard (Top-right of breadboard)
    draw_label((bx + bw - 2.0, by + bh - 1.0), (bx + bw + 4.0, 52.0), "Mini Breadboard (400 Points)", align="left")

    # 7. TP-Link Tapo C100 (Above camera)
    draw_label((cam_cx, cam_cy + ch/2), (cam_cx, 57.5), "TP-Link Tapo C100", align="center")

    # 8. 8GB MicroSD Card (Right of SD card with clean horizontal pointer)
    draw_label((sd_x + 2.6, sd_y), (sd_x + 6.0, sd_y), "8GB MicroSD Card", align="left")

    # 9. 9V DC Power Supply (Below power adapter brick)
    draw_label((brick_x + 3.0, brick_y), (brick_x + 3.0, 6.5), "9V DC Power Adapter", align="center")

    # 10. 220 Ohm Resistor (Below resistor)
    draw_label((res_x + 1.7, res_y - 2.5), (res_x + 1.7, 6.5), "220Ω Resistor", align="center")

    # 11. SoftwareSerial Callout (Pointing directly to Green/Yellow wire bundle, crossing ZERO wires!)
    draw_label(((p_gps_tx[0] + p_nano_d2[0])/2, (p_gps_tx[1] + p_nano_d2[1])/2 - 3.0), (28.0, 6.5), "SoftwareSerial: D2 (RX) - D3 (TX)", align="center")

    # Save diagram
    plt.savefig(output_path, dpi=220, bbox_inches='tight', facecolor=bg_color, pad_inches=0.4)
    plt.close()
    print(f"Fritzing wiring diagram successfully generated at: {output_path}")

if __name__ == "__main__":
    generate_circuit_diagram("circuit_diagram.png")
