"""
TransGuard AI — Industrial Electronic Circuit Schematic & Hardware Architecture Generator
Publication-grade, IEEE Std 315 / IEEE Std 91 / ISO 7637-2 compliant circuit schematic.
Refined coordinate layout with zero collisions, clean orthogonal Manhattan wiring,
proper electronic symbols, and parallel signal flow.
"""

import matplotlib.pyplot as plt
import matplotlib.patches as patches
from matplotlib.patches import FancyBboxPatch, Circle, Polygon, Arc, Rectangle
import os

def create_schematic(output_path="docs/circuit_diagram.png"):
    # High-resolution canvas: 28 x 16 inches @ 300 DPI = 8400 x 4800 pixels
    fig = plt.figure(figsize=(28, 16), dpi=300)
    ax = fig.add_axes([0, 0, 1, 1])
    ax.set_xlim(0, 100)
    ax.set_ylim(0, 100)
    ax.axis('off')

    # Color Palette: Deep Slate Blueprint Dark Mode
    bg_color = "#070b12"
    card_bg = "#0f1624"
    card_header_bg = "#192235"
    card_border = "#26354f"
    
    # Signal & Component Colors
    col_white = "#f8fafc"
    col_slate = "#94a3b8"
    col_slate_light = "#cbd5e1"
    col_red = "#ef4444"
    col_red_bright = "#f87171"
    col_green = "#10b981"
    col_green_bright = "#34d399"
    col_blue = "#38bdf8"
    col_cyan = "#06b6d4"
    col_amber = "#f59e0b"
    col_amber_bright = "#fbbf24"
    col_purple = "#c084fc"
    col_rose = "#f43f5e"
    col_grid = "#111827"

    fig.patch.set_facecolor(bg_color)
    ax.set_facecolor(bg_color)

    # Engineering Grid
    for x in range(0, 101, 2):
        ax.axvline(x, color=col_grid, linewidth=0.5, alpha=0.45)
    for y in range(0, 101, 2):
        ax.axhline(y, color=col_grid, linewidth=0.5, alpha=0.45)

    # Outer Blueprint Double Frame
    ax.add_patch(Rectangle((1.0, 1.0), 98.0, 98.0, linewidth=2.2, edgecolor=col_blue, facecolor="none"))
    ax.add_patch(Rectangle((1.6, 1.6), 96.8, 96.8, linewidth=0.8, edgecolor="#334155", facecolor="none"))

    # =========================================================================
    # TOP BANNER: TITLE & METADATA
    # =========================================================================
    ax.text(3.2, 96.3, "TRANSGUARD AI", fontsize=22, fontweight='bold', color=col_white, family="sans-serif")
    ax.text(3.2, 94.4, "INDUSTRIAL EDGE-AI TRANSIT SURVEILLANCE — HARDWARE CIRCUIT SCHEMATIC", 
            fontsize=11, fontweight='bold', color=col_blue, family="sans-serif")
    ax.text(3.2, 92.8, "STANDARDS: IEEE Std 315 / IEEE Std 91 | ISO 7637-2 (Automotive Transient Immunity) | EN 50155 Transit Compliant", 
            fontsize=8.0, color=col_slate, family="monospace")

    # Status Badges (Top Right)
    badges = [
        ("PRIMARY SENSOR: TP-LINK RTSP (PoE)", col_green_bright),
        ("COMPUTE: NVIDIA JETSON ORIN/NANO", col_blue),
        ("REV: 2.0-PROD | PASS 65/65", col_amber_bright),
    ]
    cur_x = 96.5
    for b_text, b_col in reversed(badges):
        bw = len(b_text) * 0.48 + 2.5
        cur_x -= bw
        badge_box = FancyBboxPatch((cur_x, 93.8), bw, 2.6, boxstyle="round,pad=0.2,rounding_size=0.5",
                                   facecolor="#1e293b", edgecolor=b_col, linewidth=1.2)
        ax.add_patch(badge_box)
        ax.text(cur_x + bw/2, 95.1, b_text, fontsize=7.2, fontweight='bold', color=b_col, ha='center', va='center', family="monospace")
        cur_x -= 1.5

    # Helper: Draw Subsystem Card Container
    def draw_card(x, y, w, h, title, tag, tag_color):
        card = FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.4,rounding_size=1.0",
                              facecolor=card_bg, edgecolor=card_border, linewidth=1.4)
        ax.add_patch(card)
        header = FancyBboxPatch((x, y + h - 3.2), w, 3.2, boxstyle="round,pad=0.15,rounding_size=0.5",
                                facecolor=card_header_bg, edgecolor="none")
        ax.add_patch(header)
        ax.text(x + 1.2, y + h - 1.7, title, fontsize=9.8, fontweight='bold', color=col_white)
        tag_w = len(tag) * 0.42 + 2.0
        tag_box = FancyBboxPatch((x + w - tag_w - 1.0, y + h - 2.5), tag_w, 1.8, boxstyle="round,pad=0.15,rounding_size=0.4",
                                 facecolor=tag_color, edgecolor="none", alpha=0.2)
        ax.add_patch(tag_box)
        ax.text(x + w - tag_w/2 - 1.0, y + h - 1.6, tag, fontsize=7.0, fontweight='bold', color=tag_color, ha='center', va='center')

    # Helper: Draw Resistor (IEC clean rectangle)
    def draw_resistor(x, y, w, h, name, val, orientation='h', label_pos='top', col=col_amber_bright):
        if orientation == 'h':
            ax.plot([x - 1.0, x], [y, y], color=col, linewidth=1.8)
            ax.plot([x + w, x + w + 1.0], [y, y], color=col, linewidth=1.8)
            ax.add_patch(Rectangle((x, y - h/2), w, h, facecolor="#1e293b", edgecolor=col, linewidth=1.2))
            if label_pos == 'top':
                ax.text(x + w/2, y + h/2 + 0.6, f"{name}: {val}", fontsize=6.8, fontweight='bold', color=col, ha='center')
            else:
                ax.text(x + w/2, y - h/2 - 1.4, f"{name}: {val}", fontsize=6.8, fontweight='bold', color=col, ha='center')
        else:
            ax.plot([x, x], [y - 1.0, y], color=col, linewidth=1.8)
            ax.plot([x, x], [y + h, y + h + 1.0], color=col, linewidth=1.8)
            ax.add_patch(Rectangle((x - w/2, y), w, h, facecolor="#1e293b", edgecolor=col, linewidth=1.2))
            if label_pos == 'right':
                ax.text(x + w/2 + 0.8, y + h/2, f"{name}\n{val}", fontsize=6.8, fontweight='bold', color=col, va='center')
            else:
                ax.text(x - w/2 - 0.8, y + h/2, f"{name}\n{val}", fontsize=6.8, fontweight='bold', color=col, ha='right', va='center')

    # Helper: Draw Ground Symbol
    def draw_ground(x, y, label="DIG_GND", col=col_green_bright):
        ax.plot([x, x], [y + 1.0, y], color=col, linewidth=1.8)
        ax.plot([x - 1.2, x + 1.2], [y, y], color=col, linewidth=2.0)
        ax.plot([x - 0.7, x + 0.7], [y - 0.5, y - 0.5], color=col, linewidth=1.5)
        ax.plot([x - 0.3, x + 0.3], [y - 1.0, y - 1.0], color=col, linewidth=1.2)
        ax.text(x, y - 2.0, label, fontsize=6.8, fontweight='bold', color=col, ha='center')

    # =========================================================================
    # 1. POWER CONDITIONING & PROTECTION (Top Left, x: 3.0 to 32.0, y: 52.0 to 90.5)
    # =========================================================================
    draw_card(3.0, 52.0, 29.0, 38.5, "1. POWER CONDITIONING & PROTECTION", "ISO 7637-2 SURGE", col_red_bright)

    # Battery Source Text
    ax.text(4.8, 86.0, "VEHICLE MAIN BUS", fontsize=8.8, fontweight='bold', color=col_white)
    ax.text(4.8, 84.5, "12V / 24V DC Starter Bus\n(Lead-Acid / Alternator Rail)", fontsize=6.8, color=col_slate)

    # Battery Posts
    ax.scatter([10.5], [80.5], s=35, color=col_red_bright, zorder=5)
    ax.text(9.5, 80.5, "BAT (+)", fontsize=7.5, fontweight='bold', color=col_red_bright, ha='right', va='center')
    ax.scatter([10.5], [58.5], s=35, color=col_green_bright, zorder=5)
    ax.text(9.5, 58.5, "BAT (-)", fontsize=7.5, fontweight='bold', color=col_green_bright, ha='right', va='center')

    # Wire to Fuse F1
    ax.plot([10.5, 12.0], [80.5, 80.5], color=col_red_bright, linewidth=2)
    # Fuse F1
    f_box = Rectangle((12.0, 79.7), 2.8, 1.6, facecolor="#1e293b", edgecolor=col_amber_bright, linewidth=1.2)
    ax.add_patch(f_box)
    ax.plot([12.2, 14.6], [80.5, 80.5], color=col_amber_bright, linewidth=1.5, linestyle='--')
    ax.text(13.4, 82.2, "F1: 5A Slow-Blow", fontsize=7.2, fontweight='bold', color=col_amber_bright, ha='center')
    ax.text(13.4, 78.3, "Automotive Blade", fontsize=6.2, color=col_slate, ha='center')

    # Wire past Fuse to TVS Node (x = 17.5)
    ax.plot([14.8, 17.5], [80.5, 80.5], color=col_red_bright, linewidth=2)
    ax.scatter([17.5], [80.5], s=25, color=col_red_bright, zorder=5)

    # D1: SMBJ15CA Bidirectional TVS Diode at x = 17.5
    ax.plot([17.5, 17.5], [80.5, 74.5], color=col_red_bright, linewidth=1.8)
    ax.add_patch(Polygon([[16.8, 74.5], [18.2, 74.5], [17.5, 73.3]], facecolor="#334155", edgecolor=col_white, linewidth=1))
    ax.add_patch(Polygon([[16.8, 72.1], [18.2, 72.1], [17.5, 73.3]], facecolor="#334155", edgecolor=col_white, linewidth=1))
    ax.plot([16.5, 18.5], [73.3, 73.3], color=col_white, linewidth=1.5)
    ax.plot([16.5, 16.8], [73.3, 73.8], color=col_white, linewidth=1.5)
    ax.plot([18.2, 18.5], [72.8, 73.3], color=col_white, linewidth=1.5)
    ax.plot([17.5, 17.5], [72.1, 58.5], color=col_green_bright, linewidth=1.8)
    ax.text(16.2, 73.3, "D1: SMBJ15CA\n600W TVS Clamp\n(ISO 7637-2 Dump)", fontsize=6.3, color=col_amber_bright, ha='right', va='center')

    # Wire to Capacitors Node (x = 22.0)
    ax.plot([17.5, 22.0], [80.5, 80.5], color=col_red_bright, linewidth=2)
    ax.scatter([22.0], [80.5], s=25, color=col_red_bright, zorder=5)

    # C1: 470uF Polarized Electrolytic at x = 22.0
    ax.plot([22.0, 22.0], [80.5, 74.5], color=col_red_bright, linewidth=1.8)
    ax.plot([20.8, 23.2], [74.5, 74.5], color=col_white, linewidth=2.0)
    ax.plot([20.8, 23.2], [73.2, 73.2], color=col_white, linewidth=2.0)
    ax.text(23.6, 74.2, "+", fontsize=8.0, fontweight='bold', color=col_red_bright)
    ax.plot([22.0, 22.0], [73.2, 58.5], color=col_green_bright, linewidth=1.8)
    ax.text(22.0, 68.0, "C1: 470µF/50V\nLow-ESR Filter", fontsize=6.3, color=col_slate_light, ha='center', va='center')

    # Wire to DC-DC Buck Converter
    ax.plot([22.0, 26.0], [80.5, 80.5], color=col_red_bright, linewidth=2)
    
    # DC-DC Buck Module Box (x = 26.0 to 31.0)
    buck_box = FancyBboxPatch((26.0, 62.0), 5.0, 24.0, boxstyle="round,pad=0.3", facecolor="#111c30", edgecolor=col_blue, linewidth=1.4)
    ax.add_patch(buck_box)
    ax.text(28.5, 83.5, "DC-DC BUCK", fontsize=7.8, fontweight='bold', color=col_white, ha='center')
    ax.text(28.5, 81.8, "LM2596HV-ADJ", fontsize=7.0, fontweight='bold', color=col_blue, ha='center')
    ax.text(28.5, 78.8, "VIN: 12V/24V\nVOUT: 19V / 5A\nEff: 92%\nRipple: <30mV", fontsize=6.2, color=col_slate_light, ha='center')
    ax.text(28.5, 64.0, "Thermal Shutoff\nShort-Circuit Prot.", fontsize=5.8, color=col_slate, ha='center')

    # Buck Bottom Ground Bus
    ax.plot([10.5, 26.0], [58.5, 58.5], color=col_green_bright, linewidth=2)
    ax.scatter([17.5, 22.0], [58.5, 58.5], s=25, color=col_green_bright, zorder=5)

    # Power Out to Jetson
    ax.plot([31.0, 34.0], [79.0, 79.0], color=col_red_bright, linewidth=2.5)
    ax.text(32.5, 80.0, "+19V DC", fontsize=7.5, fontweight='bold', color=col_red_bright, ha='center')
    ax.plot([31.0, 34.0], [64.0, 64.0], color=col_green_bright, linewidth=2.5)
    ax.text(32.5, 65.0, "SYS_GND", fontsize=7.5, fontweight='bold', color=col_green_bright, ha='center')

    # =========================================================================
    # 2. CENTRAL COMPUTE: NVIDIA JETSON EDGE AI (Center, x: 34.0 to 66.0, y: 34.0 to 90.5)
    # =========================================================================
    jet_box = FancyBboxPatch((34.0, 34.0), 32.0, 56.5, boxstyle="round,pad=0.5,rounding_size=1.2",
                             facecolor="#0e1726", edgecolor=col_blue, linewidth=2.2)
    ax.add_patch(jet_box)

    # Jetson Header Banner
    ax.add_patch(FancyBboxPatch((34.0, 87.2), 32.0, 3.3, boxstyle="round,pad=0.15,rounding_size=0.5",
                                facecolor="#1e293b", edgecolor="none"))
    ax.text(50.0, 89.2, "2. CENTRAL COMPUTE: NVIDIA JETSON EDGE PLATFORM", fontsize=10.2, fontweight='bold', color=col_white, ha='center')
    ax.text(50.0, 87.8, "Linux Ubuntu 22.04 LTS | JetPack 6.x | CUDA TensorRT AI Hardware Acceleration", fontsize=6.8, color=col_blue, ha='center')

    # DC Power Jack (Left edge)
    dc_jack = patches.Rectangle((33.2, 76.5), 1.6, 5.0, facecolor="#1e293b", edgecolor=col_red_bright, linewidth=1.4)
    ax.add_patch(dc_jack)
    ax.text(36.5, 79.8, "DC Power Jack", fontsize=7.8, fontweight='bold', color=col_white)
    ax.text(36.5, 78.4, "+19V DC / 4.5A Operating Rail", fontsize=6.5, color=col_slate_light)

    # eth0 Gigabit NIC (Right edge)
    eth_jack = patches.Rectangle((65.2, 70.0), 1.6, 5.2, facecolor="#1e293b", edgecolor=col_blue, linewidth=1.4)
    ax.add_patch(eth_jack)
    ax.text(63.5, 73.2, "eth0 NIC", fontsize=8.0, fontweight='bold', color=col_blue, ha='right')
    ax.text(63.5, 71.8, "1000BASE-T RJ45", fontsize=6.5, color=col_slate, ha='right')

    # Jetson Internal Software Architecture Card
    sw_card = FancyBboxPatch((36.0, 56.0), 28.0, 19.5, boxstyle="round,pad=0.3", facecolor="#141e30", edgecolor="#3b82f6", linewidth=1.2)
    ax.add_patch(sw_card)
    ax.text(50.0, 73.8, "EDGE AI SOFTWARE PIPELINE (trans_guard_engine.py)", fontsize=8.2, fontweight='bold', color=col_amber_bright, ha='center')

    sw_stages = [
        ("1. NVMM Hardware Video Decoder", "Zero-copy GStreamer / FFmpeg H.264/H.265 engine", col_blue),
        ("2. Zero-Latency Ring Buffer", "Depth: 2, Drop Oldest Frame (Latency < 25ms guarantee)", col_amber_bright),
        ("3. TensorRT Inference Core", "YOLOv8 Object/Weapon Detection + ByteTrack Multi-Object Tracker", col_green_bright),
        ("4. Kinematic Anomaly Analysis", "33 MediaPipe 3D Keypoints: Fall Detection, Violent Assault, Passenger Panic", col_red_bright),
        ("5. Encrypted Telemetry Dispatch", "HMAC-SHA256 Signed Alert Ingestion to Core Backend (Port 5000)", col_purple),
    ]
    for i, (stitle, sdesc, scol) in enumerate(sw_stages):
        sy = 71.2 - i * 2.8
        ax.add_patch(Rectangle((36.8, sy - 1.0), 26.4, 2.4, facecolor="#09101d", edgecolor=scol, linewidth=0.8))
        ax.text(37.6, sy + 0.2, stitle, fontsize=7.2, fontweight='bold', color=scol)
        ax.text(37.6, sy - 0.7, sdesc, fontsize=5.8, color=col_slate_light)

    # 40-Pin Header Breakout (J41)
    hdr_card = FancyBboxPatch((36.0, 36.5), 28.0, 17.5, boxstyle="round,pad=0.3", facecolor="#131b2c", edgecolor="#475569", linewidth=1.2)
    ax.add_patch(hdr_card)
    ax.text(50.0, 52.3, "40-PIN EXPANSION HEADER (J41) INTERFACE BREAKOUT", fontsize=8.0, fontweight='bold', color=col_white, ha='center')

    # Parallel-ordered J41 Left Pins:
    # Pin 1 (+3.3V), Pin 8 (UART TX), Pin 10 (UART RX), Pin 14 (DIG_GND)
    left_pins = [
        ("Pin 1: +3.3V DC (VCC_SYS)", 48.5, col_amber_bright),
        ("Pin 8: UART1_TXD (Serial Out)", 44.8, col_blue),
        ("Pin 10: UART1_RXD (Serial In)", 41.2, col_blue),
        ("Pin 14: DIG_GND (Logic Ground)", 38.0, col_green_bright),
    ]
    for pname, py, pcol in left_pins:
        ax.scatter([37.5], [py], s=30, color=pcol, zorder=5)
        ax.text(38.5, py - 0.3, pname, fontsize=7.0, color=col_slate_light, fontweight='bold')

    # Right Pins (Actuators & Safety):
    # Pin 12 (GPIO 18 Siren Output) on upper right, Pin 18 (GPIO 24 Panic IRQ) on bottom center
    # Pin 12 Siren Output at x=62.5, y=43.0
    ax.scatter([62.5], [43.0], s=30, color=col_red_bright, zorder=5)
    ax.text(61.5, 42.7, "Pin 12: GPIO 18 (Siren Output)", fontsize=7.0, color=col_slate_light, fontweight='bold', ha='right')

    # Pin 18 Panic Button Input at bottom of J41 header: x=50.0, y=38.0
    ax.scatter([50.0], [38.0], s=35, color=col_amber_bright, zorder=5)
    ax.text(51.2, 38.0, "Pin 18: GPIO 24 (Panic IRQ)", fontsize=7.0, color=col_amber_bright, fontweight='bold', va='center')

    # =========================================================================
    # 3. PRIMARY VIDEO SENSOR & POE INFRASTRUCTURE (Top Right, x: 68.0 to 97.0, y: 52.0 to 90.5)
    # =========================================================================
    draw_card(68.0, 52.0, 29.0, 38.5, "3. PRIMARY VIDEO: TP-LINK RTSP (PoE)", "IEEE 802.3af/at PoE", col_green_bright)

    # TP-Link Professional Camera Box
    cam_box = FancyBboxPatch((69.5, 66.0), 13.0, 21.5, boxstyle="round,pad=0.4", facecolor="#141f33", edgecolor=col_green_bright, linewidth=1.5)
    ax.add_patch(cam_box)
    
    # Camera Lens Drawing
    lens_outer = Circle((76.0, 82.5), 2.5, facecolor="#09101d", edgecolor=col_blue, linewidth=1.5)
    lens_mid = Circle((76.0, 82.5), 1.6, facecolor="#1e1b4b", edgecolor=col_purple, linewidth=1.0)
    lens_core = Circle((76.0, 82.5), 0.7, facecolor="#0369a1", edgecolor="none")
    ax.add_patch(lens_outer)
    ax.add_patch(lens_mid)
    ax.add_patch(lens_core)
    
    ax.text(76.0, 78.8, "TP-LINK VIGI / TAPO", fontsize=8.2, fontweight='bold', color=col_white, ha='center')
    ax.text(76.0, 77.2, "PROFESSIONAL RTSP IP CAMERA", fontsize=6.8, fontweight='bold', color=col_green_bright, ha='center')
    ax.text(76.0, 74.8, "• 1080p / 4K UHD Starlight Sensor", fontsize=6.0, color=col_slate_light, ha='center')
    ax.text(76.0, 73.4, "• H.264 / H.265 Hardware Encoder", fontsize=6.0, color=col_slate_light, ha='center')
    ax.text(76.0, 72.0, "• Low-Latency Unicast RTSP Stream", fontsize=6.0, color=col_slate_light, ha='center')
    ax.text(76.0, 70.6, "• IEEE 802.3af Class 2 PoE (48V)", fontsize=6.0, color=col_amber_bright, ha='center')
    ax.text(76.0, 69.2, "• IP67 Weatherproof Transit Housing", fontsize=6.0, color=col_slate_light, ha='center')

    # Camera RJ45 Jack
    cam_jack = patches.Rectangle((82.5, 75.0), 1.2, 3.0, facecolor="#334155", edgecolor=col_green_bright, linewidth=1.2)
    ax.add_patch(cam_jack)
    ax.text(82.0, 76.5, "RJ45", fontsize=6.2, color=col_white, ha='right', va='center')

    # Industrial PoE Switch Box
    poe_box = FancyBboxPatch((87.5, 58.0), 8.5, 29.5, boxstyle="round,pad=0.4", facecolor="#0e1726", edgecolor=col_blue, linewidth=1.5)
    ax.add_patch(poe_box)
    ax.text(91.75, 85.5, "INDUSTRIAL 48V", fontsize=8.0, fontweight='bold', color=col_white, ha='center')
    ax.text(91.75, 84.0, "PoE SWITCH", fontsize=7.2, fontweight='bold', color=col_blue, ha='center')
    ax.text(91.75, 82.5, "802.3af/at PSE", fontsize=6.0, color=col_slate, ha='center')

    # PoE Ports
    poe_ports = [
        (76.5, "P1: Cam In", "(48V PoE)", col_green_bright),
        (69.5, "P2: Aux In", "(Reserved)", col_slate),
        (62.5, "P3: Uplink", "(Data Only)", col_amber_bright)
    ]
    for py, ptitle, psub, pcol in poe_ports:
        p_rect = Rectangle((88.5, py - 1.2), 2.2, 2.4, facecolor="#1e293b", edgecolor=pcol, linewidth=1.0)
        ax.add_patch(p_rect)
        ax.scatter([88.0], [py], s=10, color=pcol)
        ax.text(89.6, py, "RJ45", fontsize=5.8, color=col_white, ha='center', va='center')
        ax.text(91.2, py + 0.3, ptitle, fontsize=6.6, fontweight='bold', color=col_white)
        ax.text(91.2, py - 0.7, psub, fontsize=5.6, color=pcol)

    # Cat6 STP Line: Camera to PoE Switch Port 1 (Clean Horizontal Line)
    ax.plot([83.7, 88.5], [76.5, 76.5], color=col_green_bright, linewidth=3.0)
    ax.text(86.1, 78.0, "Cat6 STP Cable (PoE)", fontsize=6.8, fontweight='bold', color=col_green_bright, ha='center')
    ax.text(86.1, 75.0, "48V DC + RTSP Video", fontsize=5.8, color=col_slate_light, ha='center')

    # Cat6 Data Uplink: PoE Switch Port 3 to NVIDIA Jetson eth0 (Orthogonal Routing)
    ax.plot([88.5, 85.0, 85.0, 66.8], [62.5, 62.5, 55.0, 55.0], color=col_blue, linewidth=2.5)
    ax.plot([66.8, 66.8], [55.0, 72.6], color=col_blue, linewidth=2.5)
    ax.text(76.0, 56.2, "Gigabit RJ45 Cat6 Cable (Data Only: 1000BASE-T)", fontsize=7.2, fontweight='bold', color=col_blue, ha='center')
    ax.text(76.0, 53.6, "rtsp://192.168.1.100:554/stream1 | TCP Low-Latency Unicast", fontsize=6.0, color=col_slate_light, ha='center')

    # =========================================================================
    # 4. SATELLITE TELEMETRY SENSOR (Bottom Left, x: 3.0 to 32.0, y: 10.0 to 50.0)
    # =========================================================================
    draw_card(3.0, 10.0, 29.0, 40.0, "4. SATELLITE POSITIONING: u-blox NEO-6M", "UART SERIAL NMEA", col_blue)

    # GPS Board Module
    gps_board = FancyBboxPatch((4.8, 14.5), 22.0, 31.5, boxstyle="round,pad=0.3", facecolor="#10192a", edgecolor=col_blue, linewidth=1.4)
    ax.add_patch(gps_board)
    ax.text(15.8, 44.2, "u-blox NEO-6M GNSS GPS RECEIVER", fontsize=8.0, fontweight='bold', color=col_white, ha='center')
    ax.text(15.8, 42.6, "50-Channel High Sensitivity Engine | Fix < 1s", fontsize=6.2, color=col_slate, ha='center')
    ax.text(15.8, 41.2, "NMEA 0183 ($GPRMC, $GPGGA) @ 9600 Baud", fontsize=6.5, color=col_amber_bright, ha='center')

    # Ceramic Patch Antenna
    ant_box = patches.Rectangle((6.2, 20.0), 6.0, 18.0, facecolor="#09101d", edgecolor="#64748b", linewidth=1.2)
    ax.add_patch(ant_box)
    ax.text(9.2, 29.0, "ACTIVE\nCERAMIC\nPATCH\nANTENNA\n\n1575.42 MHz\nL1 Band", 
            fontsize=6.8, fontweight='bold', color=col_slate_light, ha='center', va='center')

    # u-blox IC Chip in center of module
    chip_box = patches.Rectangle((13.5, 24.5), 5.5, 8.5, facecolor="#1e293b", edgecolor=col_blue, linewidth=1.0)
    ax.add_patch(chip_box)
    ax.text(16.25, 29.5, "u-blox", fontsize=7.2, fontweight='bold', color=col_white, ha='center')
    ax.text(16.25, 28.0, "NEO-6M", fontsize=6.8, fontweight='bold', color=col_blue, ha='center')
    ax.text(16.25, 26.2, "GNSS CORE", fontsize=5.5, color=col_slate, ha='center')

    # GPS Pin Header (ordered to match J41 header for clean parallel routing)
    gps_pins = [
        ("VCC (+3.3V)", 38.0, col_amber_bright),
        ("RXD (Input)", 33.5, col_blue),
        ("TXD (Output)", 29.0, col_blue),
        ("GND (Ground)", 24.5, col_green_bright),
    ]
    for gpname, gpy, gpcol in gps_pins:
        ax.scatter([25.0], [gpy], s=30, color=gpcol, zorder=5)
        ax.text(24.0, gpy - 0.3, gpname, fontsize=7.0, fontweight='bold', color=col_white, ha='right')

    # Parallel Wires from GPS to Jetson J41 Header (Zero cross!)
    # 1. VCC to Jetson Pin 1 (+3.3V at y=48.5)
    ax.plot([25.0, 28.5, 28.5, 37.5], [38.0, 38.0, 48.5, 48.5], color=col_amber_bright, linewidth=1.8)
    ax.text(27.8, 43.5, "+3.3V DC", fontsize=6.2, fontweight='bold', color=col_amber_bright, rotation=90)

    # 2. RXD through 1k resistor R4 to Jetson Pin 8 (TXD at y=44.8)
    draw_resistor(28.0, 33.5, 2.0, 1.0, "R4", "1kΩ", orientation='h', label_pos='top', col=col_amber_bright)
    ax.plot([25.0, 27.0], [33.5, 33.5], color=col_blue, linewidth=1.8)
    ax.plot([31.0, 31.0, 37.5], [33.5, 44.8, 44.8], color=col_blue, linewidth=1.8)

    # 3. TXD to Jetson Pin 10 (RXD at y=41.2)
    ax.plot([25.0, 33.5, 33.5, 37.5], [29.0, 29.0, 41.2, 41.2], color=col_blue, linewidth=1.8)
    ax.text(32.7, 34.0, "NMEA Serial Strings", fontsize=6.0, color=col_blue, rotation=90)

    # 4. GND to Jetson Pin 14 (DIG_GND at y=38.0)
    ax.plot([25.0, 35.5, 35.5, 37.5], [24.5, 24.5, 38.0, 38.0], color=col_green_bright, linewidth=1.8)

    # =========================================================================
    # 5. DRIVER EMERGENCY PANIC INPUT & DEBOUNCE (Bottom Center, x: 34.0 to 66.0, y: 10.0 to 32.5)
    # =========================================================================
    draw_card(34.0, 10.0, 32.0, 22.5, "5. DRIVER SAFETY PANIC INPUT & DEBOUNCE", "ACTIVE-LOW IRQ", col_amber_bright)

    ax.text(36.0, 28.8, "DRIVER EMERGENCY BUTTON (SW1)", fontsize=8.2, fontweight='bold', color=col_white)
    ax.text(36.0, 27.5, "Heavy-Duty SPST Normally-Open Tactile Mushroom Switch", fontsize=6.5, color=col_slate_light)

    # Pushbutton Symbol
    sw_x, sw_y = 38.5, 21.5
    ax.plot([sw_x - 2.5, sw_x - 1.0], [sw_y, sw_y], color=col_amber_bright, linewidth=2.0)
    ax.scatter([sw_x - 1.0], [sw_y], s=25, facecolor="#09101d", edgecolor=col_amber_bright, linewidth=1.5, zorder=5)
    ax.scatter([sw_x + 1.5], [sw_y], s=25, facecolor="#09101d", edgecolor=col_amber_bright, linewidth=1.5, zorder=5)
    # Contact arm
    ax.plot([sw_x - 0.8, sw_x + 1.2], [sw_y + 1.5, sw_y + 0.3], color=col_red_bright, linewidth=2.2)
    # Plunger
    ax.plot([sw_x + 0.2, sw_x + 0.2], [sw_y + 0.9, sw_y + 2.3], color=col_slate_light, linewidth=1.5)
    ax.plot([sw_x - 0.6, sw_x + 1.0], [sw_y + 2.3, sw_y + 2.3], color=col_red_bright, linewidth=2.5)
    ax.text(sw_x + 0.2, sw_y + 3.2, "SW1 (N.O.)", fontsize=7.2, fontweight='bold', color=col_red_bright, ha='center')

    # Switch left terminal to DIG_GND
    ax.plot([sw_x - 2.5, sw_x - 2.5], [sw_y, 14.5], color=col_green_bright, linewidth=1.8)
    draw_ground(sw_x - 2.5, 14.5, "DIG_GND", col_green_bright)

    # Switch right terminal to Debounce Node (node_x = 45.0)
    node_x = 45.0
    ax.plot([sw_x + 1.5, node_x], [sw_y, sw_y], color=col_amber_bright, linewidth=2.0)
    ax.scatter([node_x], [sw_y], s=30, color=col_amber_bright, zorder=5)

    # Pull-up Resistor R1 (10k) to +3.3V Logic Rail
    draw_resistor(node_x, 23.0, 1.0, 2.0, "R1", "10 kΩ", orientation='v', label_pos='left', col=col_amber_bright)
    ax.plot([node_x, node_x], [sw_y, 23.0], color=col_amber_bright, linewidth=1.8)
    ax.plot([node_x, node_x], [26.0, 27.5], color=col_amber_bright, linewidth=1.8)
    ax.text(node_x, 28.3, "+3.3V Rail", fontsize=6.8, fontweight='bold', color=col_amber_bright, ha='center')

    # Debounce Capacitor C2 (100nF) to Ground (cap_x = 50.0)
    cap_x = 50.0
    ax.plot([node_x, cap_x], [sw_y, sw_y], color=col_amber_bright, linewidth=2.0)
    ax.scatter([cap_x], [sw_y], s=25, color=col_amber_bright, zorder=5)
    ax.plot([cap_x, cap_x], [sw_y, 18.0], color=col_amber_bright, linewidth=1.8)
    ax.plot([cap_x - 1.2, cap_x + 1.2], [18.0, 18.0], color=col_white, linewidth=2.0)
    ax.plot([cap_x - 1.2, cap_x + 1.2], [16.8, 16.8], color=col_white, linewidth=2.0)
    ax.text(cap_x + 1.6, 17.4, "C2: 100 nF\nCeramic", fontsize=6.5, color=col_slate_light, va='center')
    ax.plot([cap_x, cap_x], [16.8, 14.5], color=col_green_bright, linewidth=1.8)
    draw_ground(cap_x, 14.5, "DIG_GND", col_green_bright)

    # Clean Direct Vertical Trace from Debounce Node straight up to Jetson Pin 18 (GPIO 24)!
    ax.plot([cap_x, cap_x], [sw_y, 38.0], color=col_amber_bright, linewidth=2.2)
    ax.text(cap_x - 0.6, 31.0, "Monotonic Debounced Edge (τ = 1.0 ms)", fontsize=6.0, fontweight='bold', color=col_amber_bright, rotation=90, ha='right')

    # Debounce Formula Card
    calc_box = patches.Rectangle((55.0, 13.5), 9.5, 8.5, facecolor="#10192a", edgecolor="#334155", linewidth=1.0)
    ax.add_patch(calc_box)
    ax.text(59.75, 20.5, "RC TIME CONSTANT", fontsize=6.8, fontweight='bold', color=col_amber_bright, ha='center')
    ax.text(59.75, 18.8, "τ = R1 × C2", fontsize=7.2, fontweight='bold', color=col_white, ha='center')
    ax.text(59.75, 17.2, "= 10 kΩ × 100 nF", fontsize=6.2, color=col_slate_light, ha='center')
    ax.text(59.75, 15.6, "= 1.0 ms Filter Delay", fontsize=6.8, fontweight='bold', color=col_green_bright, ha='center')
    ax.text(59.75, 14.2, "Bounce-Free Transition", fontsize=5.8, color=col_slate, ha='center')

    # =========================================================================
    # 6. OPTO-ISOLATED PHYSICAL ALARM ACTUATOR (Bottom Right, x: 68.0 to 97.0, y: 10.0 to 50.0)
    # =========================================================================
    draw_card(68.0, 10.0, 29.0, 40.0, "6. OPTO-ISOLATED PHYSICAL ALARM ACTUATOR", "5,000 VRMS ISOLATION", col_rose)

    ax.text(70.0, 46.5, "12V ALARM SIREN & STROBE DRIVER", fontsize=8.2, fontweight='bold', color=col_white)
    ax.text(70.0, 45.0, "Complete Decoupling of Compute Domain from High-Noise Inductive Loads", fontsize=6.2, color=col_slate_light)

    # Wire from Jetson Pin 12 (GPIO 18 at x=62.5, y=43.0) to Resistor R2
    ax.plot([62.5, 69.5], [43.0, 43.0], color=col_red_bright, linewidth=2.0)
    ax.text(66.0, 43.8, "GPIO 18 Trigger", fontsize=5.8, fontweight='bold', color=col_red_bright, ha='center')
    
    # R2: 330 ohm current limiting resistor at x=69.5
    draw_resistor(69.5, 43.0, 2.0, 1.0, "R2", "330 Ω", orientation='h', label_pos='top', col=col_amber_bright)
    ax.text(70.5, 41.3, "IF = 6.4 mA", fontsize=5.8, color=col_slate, ha='center')

    # PC817 Optocoupler IC Package Box
    opto_box = FancyBboxPatch((73.0, 29.5), 8.5, 15.0, boxstyle="round,pad=0.3", facecolor="#09101d", edgecolor=col_purple, linewidth=1.5)
    ax.add_patch(opto_box)
    ax.text(77.25, 43.0, "U3: PC817", fontsize=7.5, fontweight='bold', color=col_purple, ha='center')
    ax.text(77.25, 41.7, "DIP-4 OPTOCOUPLER", fontsize=5.8, color=col_slate, ha='center')

    # Galvanic Barrier (Prominent dashed line through the optocoupler and module)
    ax.plot([77.25, 77.25], [11.5, 44.5], color=col_rose, linewidth=1.8, linestyle='--')
    ax.text(76.95, 12.5, "GALVANIC ISOLATION BARRIER (5,000 VRMS)", fontsize=6.0, fontweight='bold', color=col_rose, rotation=90, va='bottom', ha='right')

    # Optocoupler Pin 1 (Anode): Connects from R2
    ax.plot([72.5, 74.5], [43.0, 43.0], color=col_red_bright, linewidth=1.8)
    ax.scatter([74.5], [43.0], s=20, color=col_red_bright)
    # Internal IR LED
    ax.plot([74.5, 74.5], [43.0, 39.5], color=col_red_bright, linewidth=1.5)
    ax.add_patch(Polygon([[73.7, 39.5], [75.3, 39.5], [74.5, 37.9]], facecolor=col_red_bright, edgecolor=col_white, linewidth=0.8))
    ax.plot([73.7, 75.3], [37.9, 37.9], color=col_white, linewidth=1.2) # Cathode bar
    ax.plot([74.5, 74.5], [37.9, 34.0], color=col_green_bright, linewidth=1.5)
    ax.scatter([74.5], [34.0], s=20, color=col_green_bright)
    
    # Optocoupler Pin 2 (Cathode): Return to DIG_GND
    ax.plot([74.5, 71.5, 71.5], [34.0, 34.0, 26.5], color=col_green_bright, linewidth=1.8)
    draw_ground(71.5, 26.5, "DIG_GND", col_green_bright)

    # Opto Optical Arrows
    ax.annotate("", xy=(76.1, 39.0), xytext=(75.0, 39.0), arrowprops=dict(arrowstyle="->", color=col_purple, lw=1.2))
    ax.annotate("", xy=(76.1, 37.8), xytext=(75.0, 37.8), arrowprops=dict(arrowstyle="->", color=col_purple, lw=1.2))

    # Optocoupler Output Side: Phototransistor
    ax.scatter([80.0], [40.5], s=20, color=col_amber_bright) # Collector
    ax.scatter([80.0], [34.5], s=20, color=col_blue) # Emitter
    ax.plot([80.0, 79.0], [40.5, 38.5], color=col_amber_bright, linewidth=1.5)
    ax.plot([80.0, 79.0], [34.5, 36.5], color=col_blue, linewidth=1.5)
    ax.plot([79.0, 79.0], [39.0, 36.0], color=col_white, linewidth=2.0) # Base bar

    # Pull-up Resistor R3 (4.7k) to +12V AUX
    ax.plot([80.0, 82.5], [40.5, 40.5], color=col_amber_bright, linewidth=1.8)
    draw_resistor(82.5, 42.5, 1.0, 2.0, "R3", "4.7 kΩ", orientation='v', label_pos='right', col=col_amber_bright)
    ax.plot([82.5, 82.5], [40.5, 42.5], color=col_amber_bright, linewidth=1.8)
    ax.plot([82.5, 82.5], [45.5, 47.5], color=col_red_bright, linewidth=2.0)
    ax.text(82.5, 48.3, "+12V AUX RAIL", fontsize=7.0, fontweight='bold', color=col_red_bright, ha='center')

    # NPN Transistor Q1 (2N2222)
    q_x, q_y = 86.0, 34.5
    ax.plot([80.0, q_x - 1.2], [34.5, q_y], color=col_blue, linewidth=1.8) # Base lead
    
    # Transistor symbol
    ax.plot([q_x - 1.2, q_x - 1.2], [q_y - 2.0, q_y + 2.0], color=col_white, linewidth=2.2) # Base bar
    ax.plot([q_x - 1.2, q_x + 0.3], [q_y + 0.8, q_y + 2.5], color=col_white, linewidth=1.8) # Collector
    ax.plot([q_x - 1.2, q_x + 0.3], [q_y - 0.8, q_y - 2.5], color=col_white, linewidth=1.8) # Emitter
    ax.add_patch(Polygon([[q_x - 0.3, q_y - 1.9], [q_x + 0.1, q_y - 2.7], [q_x - 0.7, q_y - 2.4]], facecolor=col_white))
    ax.text(q_x - 0.5, q_y - 3.8, "Q1: 2N2222\nNPN Driver", fontsize=6.6, fontweight='bold', color=col_white, ha='center')

    # Q1 Emitter to Isolated Vehicle Ground (AUX_GND)
    ax.plot([q_x + 0.3, q_x + 0.3], [q_y - 2.5, 26.5], color="#64748b", linewidth=1.8)
    draw_ground(q_x + 0.3, 26.5, "AUX_GND", "#64748b")

    # Q1 Collector to Relay Coil K1
    ax.plot([q_x + 0.3, q_x + 0.3, 90.5], [q_y + 2.5, 38.0, 38.0], color=col_red_bright, linewidth=1.8)

    # Relay Module K1 Box (widened to 6.5 units for maximum spacing)
    relay_box = FancyBboxPatch((89.5, 33.0), 6.5, 11.5, boxstyle="round,pad=0.2", facecolor="#131e33", edgecolor=col_amber_bright, linewidth=1.2)
    ax.add_patch(relay_box)
    ax.text(92.75, 43.5, "K1: 12V RELAY", fontsize=7.2, fontweight='bold', color=col_amber_bright, ha='center')

    # Coil Symbol Arcs
    for cy in [36.0, 37.5, 39.0]:
        ax.add_patch(Arc((91.5, cy), 1.2, 1.2, angle=0, theta1=270, theta2=90, color=col_amber_bright, linewidth=1.5))

    # Flyback Diode D2 (1N4007) in reverse-parallel
    ax.plot([93.5, 93.5], [35.5, 40.5], color=col_red_bright, linewidth=1.5)
    ax.add_patch(Polygon([[92.9, 38.0], [94.1, 38.0], [93.5, 39.5]], facecolor=col_red_bright, edgecolor=col_white, linewidth=0.8))
    ax.plot([92.9, 94.1], [39.5, 39.5], color=col_white, linewidth=1.2)
    ax.text(94.2, 38.5, "D2: 1N4007\n(Flyback)", fontsize=5.8, color=col_red_bright)

    # Relay Coil Power Line from +12V AUX
    ax.plot([91.5, 91.5, 82.5], [40.5, 47.5, 47.5], color=col_red_bright, linewidth=2.0)

    # Relay Switch Contact trace leading down into Siren Box
    ax.plot([92.75, 92.75], [33.0, 27.0], color=col_red_bright, linewidth=2.2)
    
    # 12V Siren / Strobe Module Box
    siren_box = FancyBboxPatch((90.5, 14.5), 5.5, 12.5, boxstyle="round,pad=0.2", facecolor="#1c1017", edgecolor=col_red_bright, linewidth=1.2)
    ax.add_patch(siren_box)
    ax.text(93.25, 25.2, "12V 110dB", fontsize=7.5, fontweight='bold', color=col_red_bright, ha='center')
    ax.text(93.25, 23.8, "SIREN & STROBE", fontsize=6.8, fontweight='bold', color=col_white, ha='center')
    ax.text(93.25, 21.5, "Physical Alarm\nAutomotive Load\n12V DC / 1.2A", fontsize=5.8, color=col_slate_light, ha='center')
    # Ground return for siren
    ax.plot([93.25, 93.25], [14.5, 13.0], color="#64748b", linewidth=1.8)
    draw_ground(93.25, 13.0, "AUX_GND", "#64748b")

    # =========================================================================
    # BOTTOM BANNER: ENGINEERING SPECIFICATIONS & TITLE BLOCK
    # =========================================================================
    # Specs Box (Left & Center, x: 3.0 to 66.0, y: 2.2 to 8.5)
    specs_box = patches.Rectangle((3.0, 2.2), 63.0, 6.6, facecolor="#09101d", edgecolor="#26354f", linewidth=1.2)
    ax.add_patch(specs_box)
    ax.text(4.2, 7.5, "CRITICAL HARDWARE ENGINEERING & SAFETY DESIGN SPECIFICATIONS", fontsize=8.2, fontweight='bold', color=col_amber_bright)
    
    specs = [
        "1. GALVANIC ISOLATION: PC817 optocoupler guarantees 5,000 VRMS dielectric isolation between 3.3V logic (DIG_GND) and vehicle 12V auxiliary (AUX_GND).",
        "2. LOAD DUMP SUPPRESSION: SMBJ15CA bidirectional TVS diode absorbs ISO 7637-2 alternator transients (<24V clamp) before the LM2596HV buck regulator.",
        "3. HARDWARE DEBOUNCING: Monostable RC filter (R1=10 kΩ, C2=100 nF, τ=1.0 ms) ensures 100% bounce-free falling-edge interrupt signals on Jetson GPIO 24.",
        "4. VIDEO STREAMING: TP-Link VIGI/Tapo RTSP IP camera interfaces over 1000BASE-T via 48V PoE Switch (IEEE 802.3af Class 2) using shielded Cat6 STP."
    ]
    for idx, spec in enumerate(specs):
        ax.text(4.2, 6.0 - idx * 1.15, spec, fontsize=6.5, color=col_slate_light, family="sans-serif")

    # Title Block (Right, x: 68.0 to 97.0, y: 2.2 to 8.5)
    tb_box = patches.Rectangle((68.0, 2.2), 29.0, 6.6, facecolor="#09101d", edgecolor=col_blue, linewidth=1.4)
    ax.add_patch(tb_box)
    ax.plot([68.0, 97.0], [6.4, 6.4], color="#26354f", linewidth=0.8)
    ax.plot([68.0, 97.0], [4.3, 4.3], color="#26354f", linewidth=0.8)
    ax.plot([82.5, 82.5], [2.2, 6.4], color="#26354f", linewidth=0.8)

    ax.text(69.0, 7.2, "PROJECT: TRANSGUARD AI PRODUCTION HARDWARE", fontsize=8.2, fontweight='bold', color=col_white)
    ax.text(69.0, 5.2, "DRAWING: FULL SCHEMATIC & BOM", fontsize=6.8, color=col_slate)
    ax.text(69.0, 3.1, "PRIMARY SENSOR: TP-LINK RTSP (PoE)", fontsize=6.8, fontweight='bold', color=col_green_bright)
    
    ax.text(83.5, 5.2, "DWG NO: TG-HW-2026-REV2", fontsize=7.2, fontweight='bold', color=col_amber_bright)
    ax.text(83.5, 3.1, "STATUS: PRODUCTION CERTIFIED", fontsize=6.8, fontweight='bold', color=col_blue)

    # Save output
    abs_path = os.path.abspath(output_path)
    if os.path.exists(abs_path):
        try:
            os.remove(abs_path)
        except Exception:
            pass
    plt.savefig(abs_path, dpi=300, facecolor=bg_color, edgecolor='none', bbox_inches='tight')
    plt.close()
    print(f"Refined schematic successfully saved to: {abs_path}")

if __name__ == "__main__":
    create_schematic("docs/circuit_diagram.png")
