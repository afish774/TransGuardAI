import os
import re
import subprocess
import shutil

def load_svg_body(path):
    with open(path, 'r', encoding='utf-8') as f:
        c = f.read()
    c = re.sub(r'<\?xml[^>]*\?>', '', c)
    c = re.sub(r'<!DOCTYPE[^>]*>', '', c)
    vb_match = re.search(r'viewBox="([^"]+)"', c)
    vb = vb_match.group(1) if vb_match else "0 0 100 100"
    inner = re.sub(r'^<svg[^>]*>', '', c.strip())
    inner = re.sub(r'</svg>$', '', inner.strip())
    return vb, inner

nano_vb, nano_inner = load_svg_body('fritzing_assets/nano.svg')
bb_vb, bb_inner = load_svg_body('fritzing_assets/breadboard_half.svg')
led_vb, led_inner = load_svg_body('fritzing_assets/led_red.svg')
resistor_vb, resistor_inner = load_svg_body('fritzing_assets/resistor_220.svg')

html_content = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>TransGuard AI - Hardware Connection & Circuit Diagram</title>
<style>
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{
    background: #ffffff;
    width: 2800px;
    height: 1600px;
    overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
  }}
  svg.main-canvas {{
    width: 2800px;
    height: 1600px;
    background: #ffffff;
  }}
  .label-title {{
    font-size: 22px;
    font-weight: 700;
    fill: #0f172a;
    letter-spacing: -0.2px;
  }}
  .label-accent {{
    font-size: 21px;
    font-weight: 700;
    fill: #0284c7;
    letter-spacing: -0.2px;
  }}
  .wire-shadow {{
    fill: none;
    stroke: rgba(15, 23, 42, 0.16);
    stroke-linecap: round;
    stroke-linejoin: round;
    filter: blur(2.5px);
  }}
  .wire-core {{
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
  }}
  .wire-highlight {{
    fill: none;
    stroke: rgba(255, 255, 255, 0.55);
    stroke-linecap: round;
    stroke-linejoin: round;
  }}
  .leader-line {{
    fill: none;
    stroke: #334155;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }}
  .anchor-dot {{
    fill: #0f172a;
    stroke: #ffffff;
    stroke-width: 2.2;
  }}
</style>
</head>
<body>

<svg class="main-canvas" viewBox="0 0 2800 1600" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <!-- Ceramic Antenna Gradients -->
    <linearGradient id="ceramicGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#e2d4c5" />
      <stop offset="50%" stop-color="#cfbe9f" />
      <stop offset="100%" stop-color="#bcab8d" />
    </linearGradient>
    <linearGradient id="silverGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ffffff" />
      <stop offset="40%" stop-color="#e2e8f0" />
      <stop offset="100%" stop-color="#cbd5e1" />
    </linearGradient>
    <linearGradient id="rfShieldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#f8fafc" />
      <stop offset="50%" stop-color="#cbd5e1" />
      <stop offset="100%" stop-color="#94a3b8" />
    </linearGradient>

    <!-- Active Buzzer Gradients -->
    <radialGradient id="buzzerBodyGrad" cx="38%" cy="38%" r="62%">
      <stop offset="0%" stop-color="#334155" />
      <stop offset="55%" stop-color="#1e293b" />
      <stop offset="100%" stop-color="#090d16" />
    </radialGradient>

    <!-- Tapo Camera Gradients -->
    <linearGradient id="cameraBodyGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ffffff" />
      <stop offset="70%" stop-color="#f8fafc" />
      <stop offset="100%" stop-color="#e2e8f0" />
    </linearGradient>
    <linearGradient id="standGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ffffff" />
      <stop offset="70%" stop-color="#f1f5f9" />
      <stop offset="100%" stop-color="#cbd5e1" />
    </linearGradient>
    <linearGradient id="stemGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#cbd5e1" />
      <stop offset="50%" stop-color="#ffffff" />
      <stop offset="100%" stop-color="#94a3b8" />
    </linearGradient>
    <radialGradient id="ballGrad" cx="35%" cy="35%" r="65%">
      <stop offset="0%" stop-color="#ffffff" />
      <stop offset="60%" stop-color="#cbd5e1" />
      <stop offset="100%" stop-color="#64748b" />
    </radialGradient>
    <radialGradient id="lensBezelGrad" cx="40%" cy="40%" r="60%">
      <stop offset="0%" stop-color="#1e293b" />
      <stop offset="70%" stop-color="#0f172a" />
      <stop offset="100%" stop-color="#020617" />
    </radialGradient>
    <radialGradient id="lensOpticGrad" cx="35%" cy="35%" r="65%">
      <stop offset="0%" stop-color="#0284c7" />
      <stop offset="40%" stop-color="#0369a1" />
      <stop offset="80%" stop-color="#0c4a6e" />
      <stop offset="100%" stop-color="#082f49" />
    </radialGradient>
  </defs>

  <!-- ================================================================= -->
  <!-- 1. ARDUINO NANO (CH340) -->
  <!-- ================================================================= -->
  <!-- Placed at x=520, y=460, width=250, height=633 -->
  <g id="arduino_nano_group" transform="translate(520, 460)">
    <rect x="0" y="0" width="250" height="633" rx="14" fill="rgba(0,0,0,0.14)" transform="translate(5, 7)" />
    <svg width="250" height="633" viewBox="{nano_vb}" style="overflow: visible;">
      {nano_inner}
    </svg>
  </g>

  <!-- ================================================================= -->
  <!-- 2. MINI BREADBOARD (400 POINTS) -->
  <!-- ================================================================= -->
  <!-- Placed at x=960, y=620, width=800, height=517 -->
  <g id="breadboard_group" transform="translate(960, 620)">
    <rect x="0" y="0" width="800" height="517" rx="10" fill="rgba(0,0,0,0.12)" transform="translate(6, 8)" />
    <svg width="800" height="517" viewBox="{bb_vb}" style="overflow: visible;">
      {bb_inner}
    </svg>
  </g>

  <!-- ================================================================= -->
  <!-- 3. COMPONENTS ON BREADBOARD (RESISTOR & LED) -->
  <!-- ================================================================= -->
  <!-- 220Ω Resistor across columns 24 and 27 row D (X=1541 to 1615, Y=817) -->
  <g id="resistor_group" transform="translate(1524, 786) scale(2.5)">
    <svg width="43" height="10" viewBox="{resistor_vb}" style="overflow: visible;">
      {resistor_inner}
    </svg>
  </g>

  <!-- Red 5mm LED: Anode at Col 27 row C (1615, 792), Cathode at Col 28 row C (1640, 792) -->
  <g id="led_group" transform="translate(1592, 706) scale(2.4)">
    <svg width="22" height="41" viewBox="{led_vb}" style="overflow: visible;">
      {led_inner}
    </svg>
  </g>
  <!-- Cathode grounding jumper from Col 28 Row B (1640, 768) to Top Blue Ground Rail (1640, 645) -->
  <path class="wire-shadow" stroke-width="6" d="M 1640 768 L 1640 645" />
  <path class="wire-core" stroke="#1e293b" stroke-width="4.5" d="M 1640 768 L 1640 645" />
  <path class="wire-highlight" stroke-width="1.2" d="M 1640 768 L 1640 645" />
  <rect x="1635" y="763" width="10" height="10" rx="2" fill="#0f172a" />
  <rect x="1635" y="640" width="10" height="10" rx="2" fill="#0f172a" />

  <!-- ================================================================= -->
  <!-- 4. NEO-6M GPS MODULE (GY-NEO6MV2) -->
  <!-- ================================================================= -->
  <g id="gps_module" transform="translate(1080, 130)">
    <rect x="0" y="0" width="280" height="340" rx="14" fill="rgba(0,0,0,0.12)" transform="translate(4, 6)" />
    <rect x="0" y="0" width="280" height="340" rx="12" fill="#1d4ed8" stroke="#1e40af" stroke-width="2.5" />
    <circle cx="18" cy="18" r="8.5" fill="#f8fafc" stroke="#ca8a04" stroke-width="2.5" />
    <circle cx="262" cy="18" r="8.5" fill="#f8fafc" stroke="#ca8a04" stroke-width="2.5" />
    <circle cx="18" cy="322" r="8.5" fill="#f8fafc" stroke="#ca8a04" stroke-width="2.5" />
    <circle cx="262" cy="322" r="8.5" fill="#f8fafc" stroke="#ca8a04" stroke-width="2.5" />

    <!-- Ceramic Patch Antenna (25mm x 25mm) -->
    <g transform="translate(35, 25)">
      <rect x="0" y="0" width="210" height="190" rx="10" fill="rgba(0,0,0,0.2)" transform="translate(3, 4)" />
      <rect x="0" y="0" width="210" height="190" rx="8" fill="url(#ceramicGrad)" stroke="#bfa07a" stroke-width="1.5" />
      <rect x="25" y="20" width="160" height="145" rx="4" fill="url(#silverGrad)" stroke="#94a3b8" stroke-width="1" />
      <circle cx="105" cy="92" r="7" fill="#64748b" stroke="#334155" stroke-width="1.5" />
      <circle cx="105" cy="92" r="3" fill="#cbd5e1" />
      <text x="105" y="145" font-family="'Segoe UI', Roboto, sans-serif" font-size="13" font-weight="700" fill="#475569" text-anchor="middle" letter-spacing="1">1575.42 MHz</text>
    </g>

    <!-- Metal RF Shield -->
    <g transform="translate(35, 225)">
      <rect x="0" y="0" width="130" height="60" rx="4" fill="url(#rfShieldGrad)" stroke="#64748b" stroke-width="1.2" />
      <circle cx="12" cy="12" r="1.5" fill="#475569" />
      <circle cx="118" cy="12" r="1.5" fill="#475569" />
      <circle cx="12" cy="48" r="1.5" fill="#475569" />
      <circle cx="118" cy="48" r="1.5" fill="#475569" />
      <text x="65" y="26" font-family="'Segoe UI', Roboto, sans-serif" font-size="11" font-weight="800" fill="#0f172a" text-anchor="middle">u-blox</text>
      <text x="65" y="42" font-family="'Segoe UI', Roboto, sans-serif" font-size="9.5" font-weight="700" fill="#334155" text-anchor="middle">NEO-6M-0-001</text>
    </g>

    <!-- Status LEDs -->
    <circle cx="195" cy="245" r="5" fill="#ef4444" stroke="#991b1b" stroke-width="1" />
    <text x="195" y="260" font-family="'Segoe UI', Roboto, sans-serif" font-size="8" font-weight="700" fill="#ffffff" text-anchor="middle">PWR</text>
    <circle cx="230" cy="245" r="5" fill="#22c55e" stroke="#15803d" stroke-width="1" />
    <text x="230" y="260" font-family="'Segoe UI', Roboto, sans-serif" font-size="8" font-weight="700" fill="#ffffff" text-anchor="middle">PPS</text>

    <text x="140" y="215" font-family="'Segoe UI', Roboto, sans-serif" font-size="12" font-weight="700" fill="#ffffff" text-anchor="middle" letter-spacing="0.5">GY-NEO6MV2 GPS</text>

    <!-- 4-Pin Header (Left to right: TX, RX, VCC, GND) -->
    <g transform="translate(50, 290)">
      <rect x="0" y="0" width="180" height="24" rx="2" fill="#0f172a" stroke="#334155" stroke-width="1" />
      <!-- Pin 1: TX -->
      <rect x="18" y="5" width="14" height="14" rx="2" fill="#e2e8f0" stroke="#ca8a04" stroke-width="1" />
      <circle cx="25" cy="12" r="3.5" fill="#0f172a" />
      <text x="25" y="-5" font-family="'Segoe UI', Roboto, sans-serif" font-size="10" font-weight="700" fill="#ffffff" text-anchor="middle">TX</text>
      <!-- Pin 2: RX -->
      <rect x="63" y="5" width="14" height="14" rx="2" fill="#e2e8f0" stroke="#ca8a04" stroke-width="1" />
      <circle cx="70" cy="12" r="3.5" fill="#0f172a" />
      <text x="70" y="-5" font-family="'Segoe UI', Roboto, sans-serif" font-size="10" font-weight="700" fill="#ffffff" text-anchor="middle">RX</text>
      <!-- Pin 3: VCC -->
      <rect x="108" y="5" width="14" height="14" rx="2" fill="#e2e8f0" stroke="#ca8a04" stroke-width="1" />
      <circle cx="115" cy="12" r="3.5" fill="#0f172a" />
      <text x="115" y="-5" font-family="'Segoe UI', Roboto, sans-serif" font-size="10" font-weight="700" fill="#ffffff" text-anchor="middle">VCC</text>
      <!-- Pin 4: GND -->
      <rect x="153" y="5" width="14" height="14" rx="2" fill="#e2e8f0" stroke="#ca8a04" stroke-width="1" />
      <circle cx="160" cy="12" r="3.5" fill="#0f172a" />
      <text x="160" y="-5" font-family="'Segoe UI', Roboto, sans-serif" font-size="10" font-weight="700" fill="#ffffff" text-anchor="middle">GND</text>
    </g>
  </g>

  <!-- ================================================================= -->
  <!-- 5. 5V ACTIVE BUZZER MODULE -->
  <!-- ================================================================= -->
  <g id="buzzer_module" transform="translate(1460, 160)">
    <rect x="0" y="0" width="220" height="290" rx="12" fill="rgba(0,0,0,0.12)" transform="translate(4, 5)" />
    <rect x="0" y="0" width="220" height="290" rx="10" fill="#0f172a" stroke="#334155" stroke-width="2" />
    <circle cx="18" cy="18" r="7" fill="#f8fafc" stroke="#64748b" stroke-width="2" />
    <circle cx="202" cy="18" r="7" fill="#f8fafc" stroke="#64748b" stroke-width="2" />

    <!-- 12mm Buzzer -->
    <g transform="translate(110, 115)">
      <circle cx="0" cy="0" r="72" fill="rgba(0,0,0,0.3)" transform="translate(2, 4)" />
      <circle cx="0" cy="0" r="70" fill="url(#buzzerBodyGrad)" stroke="#090d16" stroke-width="2" />
      <circle cx="0" cy="0" r="58" fill="none" stroke="#334155" stroke-width="1.5" />
      <circle cx="0" cy="0" r="50" fill="#1e293b" />
      <circle cx="0" cy="0" r="16" fill="#090d16" stroke="#000000" stroke-width="2" />
      <text x="-35" y="-35" font-family="'Segoe UI', Roboto, sans-serif" font-size="20" font-weight="900" fill="#ef4444" text-anchor="middle">+</text>
    </g>

    <rect x="40" y="195" width="22" height="15" rx="2" fill="#1e293b" stroke="#475569" stroke-width="1" />
    <text x="51" y="206" font-family="'Segoe UI', Roboto, sans-serif" font-size="7" font-weight="700" fill="#94a3b8" text-anchor="middle">Q1</text>
    <rect x="160" y="195" width="20" height="10" rx="1" fill="#334155" />
    <text x="110" y="222" font-family="'Segoe UI', Roboto, sans-serif" font-size="11" font-weight="700" fill="#e2e8f0" text-anchor="middle">5V ACTIVE BUZZER</text>

    <!-- 3-Pin Header (Left to right: I/O, VCC, GND) -->
    <g transform="translate(35, 240)">
      <rect x="0" y="0" width="150" height="24" rx="2" fill="#1e293b" stroke="#475569" stroke-width="1" />
      <!-- Pin 1: I/O (Signal) -->
      <rect x="18" y="5" width="14" height="14" rx="2" fill="#e2e8f0" stroke="#ca8a04" stroke-width="1" />
      <circle cx="25" cy="12" r="3.5" fill="#0f172a" />
      <text x="25" y="-5" font-family="'Segoe UI', Roboto, sans-serif" font-size="10" font-weight="700" fill="#ffffff" text-anchor="middle">I/O</text>
      <!-- Pin 2: VCC -->
      <rect x="68" y="5" width="14" height="14" rx="2" fill="#e2e8f0" stroke="#ca8a04" stroke-width="1" />
      <circle cx="75" cy="12" r="3.5" fill="#0f172a" />
      <text x="75" y="-5" font-family="'Segoe UI', Roboto, sans-serif" font-size="10" font-weight="700" fill="#ffffff" text-anchor="middle">VCC</text>
      <!-- Pin 3: GND -->
      <rect x="118" y="5" width="14" height="14" rx="2" fill="#e2e8f0" stroke="#ca8a04" stroke-width="1" />
      <circle cx="125" cy="12" r="3.5" fill="#0f172a" />
      <text x="125" y="-5" font-family="'Segoe UI', Roboto, sans-serif" font-size="10" font-weight="700" fill="#ffffff" text-anchor="middle">GND</text>
    </g>
  </g>

  <!-- ================================================================= -->
  <!-- 6. TP-LINK TAPO C100 CAMERA -->
  <!-- ================================================================= -->
  <g id="tapo_camera" transform="translate(2040, 260)">
    <ellipse cx="180" cy="560" rx="140" ry="22" fill="rgba(0,0,0,0.12)" />
    <!-- Base -->
    <path d="M 80 540 C 80 510, 280 510, 280 540 C 280 555, 80 555, 80 540 Z" fill="url(#standGrad)" stroke="#cbd5e1" stroke-width="2" />
    <ellipse cx="180" cy="530" rx="80" ry="16" fill="#f1f5f9" stroke="#cbd5e1" stroke-width="1" />
    <!-- Stem -->
    <path d="M 168 430 L 168 530 L 192 530 L 192 430 Z" fill="url(#stemGrad)" stroke="#cbd5e1" stroke-width="1" />
    <circle cx="180" cy="425" r="22" fill="url(#ballGrad)" stroke="#94a3b8" stroke-width="1.5" />

    <!-- Camera Body -->
    <rect x="40" y="40" width="280" height="320" rx="55" fill="rgba(0,0,0,0.14)" transform="translate(6, 8)" />
    <rect x="40" y="40" width="280" height="320" rx="50" fill="url(#cameraBodyGrad)" stroke="#cbd5e1" stroke-width="2" />
    
    <!-- MicroSD Card Slot & Card -->
    <g transform="translate(315, 170)">
      <rect x="0" y="0" width="8" height="50" rx="2" fill="#334155" />
      <path d="M 4 5 L 32 5 C 34 5, 36 7, 36 9 L 36 41 C 36 43, 34 45, 32 45 L 4 45 Z" fill="#b91c1c" stroke="#991b1b" stroke-width="1" />
      <rect x="8" y="20" width="24" height="20" fill="#f8fafc" />
      <text x="20" y="33" font-family="'Segoe UI', Roboto, sans-serif" font-size="8" font-weight="900" fill="#0f172a" text-anchor="middle">8GB</text>
    </g>

    <!-- Glossy Lens Face -->
    <g transform="translate(180, 185)">
      <circle cx="0" cy="0" r="105" fill="#090d16" stroke="#1e293b" stroke-width="3" />
      <circle cx="0" cy="0" r="95" fill="url(#lensBezelGrad)" />
      <circle cx="0" cy="0" r="70" fill="#090d16" stroke="#1e293b" stroke-width="1.5" />
      <circle cx="0" cy="0" r="52" fill="#0f172a" stroke="#0284c7" stroke-width="1" />
      <circle cx="0" cy="0" r="38" fill="url(#lensOpticGrad)" />
      <ellipse cx="-12" cy="-14" rx="14" ry="7" fill="rgba(255,255,255,0.65)" transform="rotate(-30, -12, -14)" />
      <circle cx="10" cy="12" r="3.5" fill="rgba(255,255,255,0.3)" />
      <circle cx="0" cy="-78" r="3.5" fill="#22c55e" stroke="#15803d" stroke-width="0.8" />
      <circle cx="0" cy="-78" r="6" fill="rgba(34,197,94,0.3)" />
      <circle cx="0" cy="78" r="2.5" fill="#000000" />
    </g>

    <text x="180" y="328" font-family="'Segoe UI', Roboto, sans-serif" font-size="18" font-weight="800" fill="#0284c7" text-anchor="middle" letter-spacing="1">tapo</text>
    <text x="180" y="342" font-family="'Segoe UI', Roboto, sans-serif" font-size="9.5" font-weight="700" fill="#64748b" text-anchor="middle">1080p FHD RTSP</text>

    <!-- DC Power Cord leaving rear -->
    <g transform="translate(140, 480)">
      <rect x="0" y="0" width="30" height="16" rx="3" fill="#1e293b" stroke="#0f172a" stroke-width="1.5" />
      <path d="M 15 16 C 15 80, 45 200, 45 395" fill="none" stroke="#1e293b" stroke-width="7" stroke-linecap="round" />
    </g>
  </g>

  <!-- 9V DC Adapter Brick -->
  <g id="power_adapter" transform="translate(2175, 1140)">
    <rect x="0" y="0" width="100" height="130" rx="8" fill="rgba(0,0,0,0.15)" transform="translate(4, 5)" />
    <rect x="0" y="0" width="100" height="130" rx="6" fill="#1e293b" stroke="#0f172a" stroke-width="2" />
    <!-- Top strain relief boot where DC wire connects -->
    <rect x="38" y="-10" width="14" height="12" rx="2" fill="#0f172a" />
    <!-- Bottom AC wall prongs -->
    <rect x="25" y="130" width="12" height="22" rx="2" fill="#94a3b8" stroke="#64748b" stroke-width="1" />
    <rect x="63" y="130" width="12" height="22" rx="2" fill="#94a3b8" stroke="#64748b" stroke-width="1" />
    <text x="50" y="44" font-family="'Segoe UI', Roboto, sans-serif" font-size="13" font-weight="800" fill="#f8fafc" text-anchor="middle">9V DC</text>
    <text x="50" y="64" font-family="'Segoe UI', Roboto, sans-serif" font-size="10" font-weight="600" fill="#94a3b8" text-anchor="middle">0.6A Supply</text>
    <text x="50" y="84" font-family="'Segoe UI', Roboto, sans-serif" font-size="9" font-weight="500" fill="#64748b" text-anchor="middle">TP-Link OEM</text>
    <circle cx="50" cy="106" r="4" fill="#22c55e" />
  </g>

  <!-- ================================================================= -->
  <!-- 7. USB CABLE (To Host PC) -->
  <!-- ================================================================= -->
  <g id="usb_cable">
    <path d="M 645 1093 C 645 1220, 500 1340, 300 1380" fill="none" stroke="rgba(0,0,0,0.15)" stroke-width="12" filter="blur(3px)" />
    <path d="M 645 1093 C 645 1220, 500 1340, 300 1380" fill="none" stroke="#1d4ed8" stroke-width="10" stroke-linecap="round" />
    <path d="M 645 1093 C 645 1220, 500 1340, 300 1380" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="2.5" stroke-linecap="round" />
    <rect x="629" y="1075" width="32" height="30" rx="4" fill="#0f172a" stroke="#334155" stroke-width="1.5" />
    <rect x="633" y="1067" width="24" height="10" fill="#94a3b8" />
  </g>

  <!-- ================================================================= -->
  <!-- 8. HIGH-FIDELITY WIRES (Clean, Non-Crossing Professional Routing) -->
  <!-- ================================================================= -->
  <g id="wires">
    <!-- ------------------------------------------------------------- -->
    <!-- Wire 1: 5V Power (Red) from Nano 5V (Right column, x=752, y=621) to BB Top Red Rail (x=1071, y=669) -->
    <!-- ------------------------------------------------------------- -->
    <path class="wire-shadow" stroke-width="9" d="M 752 621 C 860 621, 940 669, 1071 669" />
    <path class="wire-core" stroke="#dc2626" stroke-width="6.5" d="M 752 621 C 860 621, 940 669, 1071 669" />
    <path class="wire-highlight" stroke-width="1.8" d="M 752 621 C 860 621, 940 669, 1071 669" />
    <rect x="746" y="615" width="12" height="12" rx="2" fill="#0f172a" />
    <rect x="1065" y="663" width="12" height="12" rx="2" fill="#0f172a" />

    <!-- ------------------------------------------------------------- -->
    <!-- Wire 2: GND (Black) from Nano GND (Right column, x=752, y=549) to BB Top Blue Rail (x=1022, y=645) -->
    <!-- ------------------------------------------------------------- -->
    <path class="wire-shadow" stroke-width="9" d="M 752 549 C 860 549, 920 645, 1022 645" />
    <path class="wire-core" stroke="#1e293b" stroke-width="6.5" d="M 752 549 C 860 549, 920 645, 1022 645" />
    <path class="wire-highlight" stroke-width="1.8" d="M 752 549 C 860 549, 920 645, 1022 645" />
    <rect x="746" y="543" width="12" height="12" rx="2" fill="#0f172a" />
    <rect x="1016" y="639" width="12" height="12" rx="2" fill="#0f172a" />

    <!-- ------------------------------------------------------------- -->
    <!-- Wire 3: GPS VCC (Red) from GPS Pin 3 (x=1245, y=432) to BB Top Red Rail (x=1218, y=669) -->
    <!-- ------------------------------------------------------------- -->
    <path class="wire-shadow" stroke-width="8" d="M 1245 432 C 1245 520, 1218 560, 1218 669" />
    <path class="wire-core" stroke="#dc2626" stroke-width="5.5" d="M 1245 432 C 1245 520, 1218 560, 1218 669" />
    <path class="wire-highlight" stroke-width="1.6" d="M 1245 432 C 1245 520, 1218 560, 1218 669" />
    <rect x="1239" y="426" width="12" height="12" rx="2" fill="#0f172a" />
    <rect x="1212" y="663" width="12" height="12" rx="2" fill="#0f172a" />

    <!-- ------------------------------------------------------------- -->
    <!-- Wire 4: GPS GND (Black) from GPS Pin 4 (x=1290, y=432) to BB Top Blue Rail (x=1267, y=645) -->
    <!-- ------------------------------------------------------------- -->
    <path class="wire-shadow" stroke-width="8" d="M 1290 432 C 1290 520, 1267 560, 1267 645" />
    <path class="wire-core" stroke="#1e293b" stroke-width="5.5" d="M 1290 432 C 1290 520, 1267 560, 1267 645" />
    <path class="wire-highlight" stroke-width="1.6" d="M 1290 432 C 1290 520, 1267 560, 1267 645" />
    <rect x="1284" y="426" width="12" height="12" rx="2" fill="#0f172a" />
    <rect x="1261" y="639" width="12" height="12" rx="2" fill="#0f172a" />

    <!-- ------------------------------------------------------------- -->
    <!-- Wire 5: GPS TX -> Nano D2 (Green) -->
    <!-- Leaves Nano D2 (x=538, y=656), arches cleanly over top of Nano to GPS TX (x=1155, y=432) -->
    <!-- ------------------------------------------------------------- -->
    <path class="wire-shadow" stroke-width="8" d="M 538 656 C 440 656, 440 390, 610 380 C 780 370, 980 380, 1155 432" />
    <path class="wire-core" stroke="#16a34a" stroke-width="5.5" d="M 538 656 C 440 656, 440 390, 610 380 C 780 370, 980 380, 1155 432" />
    <path class="wire-highlight" stroke-width="1.6" d="M 538 656 C 440 656, 440 390, 610 380 C 780 370, 980 380, 1155 432" />
    <rect x="532" y="650" width="12" height="12" rx="2" fill="#0f172a" />
    <rect x="1149" y="426" width="12" height="12" rx="2" fill="#0f172a" />

    <!-- ------------------------------------------------------------- -->
    <!-- Wire 6: GPS RX -> Nano D3 (Yellow) -->
    <!-- Leaves Nano D3 (x=538, y=692), arches beside green wire over top to GPS RX (x=1200, y=432) -->
    <!-- ------------------------------------------------------------- -->
    <path class="wire-shadow" stroke-width="8" d="M 538 692 C 460 692, 460 410, 630 400 C 800 390, 1010 400, 1200 432" />
    <path class="wire-core" stroke="#eab308" stroke-width="5.5" d="M 538 692 C 460 692, 460 410, 630 400 C 800 390, 1010 400, 1200 432" />
    <path class="wire-highlight" stroke-width="1.6" d="M 538 692 C 460 692, 460 410, 630 400 C 800 390, 1010 400, 1200 432" />
    <rect x="532" y="686" width="12" height="12" rx="2" fill="#0f172a" />
    <rect x="1194" y="426" width="12" height="12" rx="2" fill="#0f172a" />

    <!-- ------------------------------------------------------------- -->
    <!-- Wire 7: Buzzer VCC (Red) from Buzzer Pin 2 (x=1570, y=412) to BB Top Red Rail (x=1512, y=669) -->
    <!-- ------------------------------------------------------------- -->
    <path class="wire-shadow" stroke-width="8" d="M 1570 412 C 1570 500, 1512 550, 1512 669" />
    <path class="wire-core" stroke="#dc2626" stroke-width="5.5" d="M 1570 412 C 1570 500, 1512 550, 1512 669" />
    <path class="wire-highlight" stroke-width="1.6" d="M 1570 412 C 1570 500, 1512 550, 1512 669" />
    <rect x="1564" y="406" width="12" height="12" rx="2" fill="#0f172a" />
    <rect x="1506" y="663" width="12" height="12" rx="2" fill="#0f172a" />

    <!-- ------------------------------------------------------------- -->
    <!-- Wire 8: Buzzer GND (Black) from Buzzer Pin 3 (x=1620, y=412) to BB Top Blue Rail (x=1561, y=645) -->
    <!-- ------------------------------------------------------------- -->
    <path class="wire-shadow" stroke-width="8" d="M 1620 412 C 1620 500, 1561 550, 1561 645" />
    <path class="wire-core" stroke="#1e293b" stroke-width="5.5" d="M 1620 412 C 1620 500, 1561 550, 1561 645" />
    <path class="wire-highlight" stroke-width="1.6" d="M 1620 412 C 1620 500, 1561 550, 1561 645" />
    <rect x="1614" y="406" width="12" height="12" rx="2" fill="#0f172a" />
    <rect x="1555" y="639" width="12" height="12" rx="2" fill="#0f172a" />

    <!-- ------------------------------------------------------------- -->
    <!-- Wire 9: Buzzer I/O -> Nano D8 (Orange) -->
    <!-- Leaves Nano D8 (x=538, y=871), sweeps under Nano and through corridor below GPS to Buzzer Pin 1 (x=1520, y=412) -->
    <!-- ------------------------------------------------------------- -->
    <path class="wire-shadow" stroke-width="8" d="M 538 871 C 420 871, 420 1060, 580 1060 C 780 1060, 840 850, 840 550 C 840 510, 1320 510, 1520 412" />
    <path class="wire-core" stroke="#ea580c" stroke-width="5.5" d="M 538 871 C 420 871, 420 1060, 580 1060 C 780 1060, 840 850, 840 550 C 840 510, 1320 510, 1520 412" />
    <path class="wire-highlight" stroke-width="1.6" d="M 538 871 C 420 871, 420 1060, 580 1060 C 780 1060, 840 850, 840 550 C 840 510, 1320 510, 1520 412" />
    <rect x="532" y="865" width="12" height="12" rx="2" fill="#0f172a" />
    <rect x="1514" y="406" width="12" height="12" rx="2" fill="#0f172a" />

    <!-- ------------------------------------------------------------- -->
    <!-- Wire 10: Nano D9 -> Resistor on BB (Blue) -->
    <!-- Leaves Nano D9 (x=538, y=907), curves smoothly into BB Col 24 Row D (x=1541, y=817) -->
    <!-- ------------------------------------------------------------- -->
    <path class="wire-shadow" stroke-width="8" d="M 538 907 C 440 907, 440 1030, 600 1030 C 840 1030, 880 930, 1130 930 C 1380 930, 1480 850, 1541 817" />
    <path class="wire-core" stroke="#2563eb" stroke-width="5.5" d="M 538 907 C 440 907, 440 1030, 600 1030 C 840 1030, 880 930, 1130 930 C 1380 930, 1480 850, 1541 817" />
    <path class="wire-highlight" stroke-width="1.6" d="M 538 907 C 440 907, 440 1030, 600 1030 C 840 1030, 880 930, 1130 930 C 1380 930, 1480 850, 1541 817" />
    <rect x="532" y="901" width="12" height="12" rx="2" fill="#0f172a" />
    <rect x="1535" y="811" width="12" height="12" rx="2" fill="#0f172a" />
  </g>

  <!-- ================================================================= -->
  <!-- 9. PERIMETER CALLOUT LABELS & LEADER LINES (Exact Reference Style) -->
  <!-- ================================================================= -->
  <g id="callouts">
    <!-- Arduino Nano (CH340) on left margin with generous clearance -->
    <line class="leader-line" x1="520" y1="580" x2="380" y2="580" />
    <circle class="anchor-dot" cx="520" cy="580" r="4.5" />
    <text x="365" y="587" class="label-title" text-anchor="end">Arduino Nano (CH340)</text>

    <!-- USB Cable (To Host PC) on bottom-left -->
    <line class="leader-line" x1="450" y1="1310" x2="450" y2="1390" />
    <line class="leader-line" x1="450" y1="1390" x2="370" y2="1390" />
    <circle class="anchor-dot" cx="450" cy="1310" r="4.5" />
    <text x="355" y="1397" class="label-title" text-anchor="end">USB Cable (To Host PC)</text>

    <!-- NEO-6M GPS Module -->
    <line class="leader-line" x1="1220" y1="140" x2="1220" y2="60" />
    <line class="leader-line" x1="1220" y1="60" x2="1280" y2="60" />
    <circle class="anchor-dot" cx="1220" cy="140" r="4.5" />
    <text x="1295" y="67" class="label-title">NEO-6M GPS Module</text>

    <!-- 5V Active Buzzer -->
    <line class="leader-line" x1="1570" y1="170" x2="1570" y2="85" />
    <line class="leader-line" x1="1570" y1="85" x2="1630" y2="85" />
    <circle class="anchor-dot" cx="1570" cy="170" r="4.5" />
    <text x="1645" y="92" class="label-title">5V Active Buzzer</text>

    <!-- SoftwareSerial: D2 (RX) - D3 (TX) in clear white space above wires -->
    <line class="leader-line" x1="820" y1="375" x2="820" y2="290" />
    <line class="leader-line" x1="820" y1="290" x2="740" y2="290" />
    <circle class="anchor-dot" cx="820" cy="375" r="4.5" />
    <text x="725" y="297" class="label-accent" text-anchor="end">SoftwareSerial: D2 (RX) - D3 (TX)</text>

    <!-- Mini Breadboard (400 Points) -->
    <line class="leader-line" x1="1270" y1="1137" x2="1270" y2="1240" />
    <line class="leader-line" x1="1270" y1="1240" x2="1200" y2="1240" />
    <circle class="anchor-dot" cx="1270" cy="1137" r="4.5" />
    <text x="1185" y="1247" class="label-title" text-anchor="end">Mini Breadboard (400 Points)</text>

    <!-- Red LED (placed in clear white margin to the right of breadboard) -->
    <line class="leader-line" x1="1645" y1="730" x2="1800" y2="730" />
    <circle class="anchor-dot" cx="1645" cy="730" r="4.5" />
    <text x="1815" y="737" class="label-title">Red LED</text>

    <!-- 220Ω Resistor (placed in clear white margin to the right of breadboard) -->
    <line class="leader-line" x1="1595" y1="817" x2="1800" y2="817" />
    <circle class="anchor-dot" cx="1595" cy="817" r="4.5" />
    <text x="1815" y="824" class="label-title">220Ω Resistor</text>

    <!-- TP-Link Tapo C100 -->
    <line class="leader-line" x1="2220" y1="280" x2="2220" y2="170" />
    <line class="leader-line" x1="2220" y1="170" x2="2280" y2="170" />
    <circle class="anchor-dot" cx="2220" cy="280" r="4.5" />
    <text x="2295" y="177" class="label-title">TP-Link Tapo C100</text>

    <!-- 8GB MicroSD Card -->
    <line class="leader-line" x1="2375" y1="440" x2="2460" y2="440" />
    <circle class="anchor-dot" cx="2375" cy="440" r="4.5" />
    <text x="2475" y="447" class="label-title">8GB MicroSD Card</text>

    <!-- 9V DC Power Adapter -->
    <line class="leader-line" x1="2225" y1="1260" x2="2225" y2="1340" />
    <line class="leader-line" x1="2225" y1="1340" x2="2285" y2="1340" />
    <circle class="anchor-dot" cx="2225" cy="1260" r="4.5" />
    <text x="2300" y="1347" class="label-title">9V DC Power Adapter</text>
  </g>
</svg>

</body>
</html>
"""

with open("circuit_diagram_render.html", "w", encoding="utf-8") as f:
    f.write(html_content)

chrome_path = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
out_img = os.path.abspath("circuit_diagram.png")
in_html = "file:///" + os.path.abspath("circuit_diagram_render.html").replace("\\", "/")

cmd = [
    chrome_path,
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    f"--screenshot={out_img}",
    "--window-size=2800,1600",
    in_html
]

print("Rendering high-res screenshot with Chrome...")
res = subprocess.run(cmd, capture_output=True, text=True)
print("Chrome exit code:", res.returncode)

if os.path.exists(out_img):
    print("Main image saved:", out_img)
    docs_path = os.path.abspath("docs/circuit_diagram.png")
    os.makedirs(os.path.dirname(docs_path), exist_ok=True)
    shutil.copyfile(out_img, docs_path)
    
    brain_path = r"C:\Users\User\.gemini\antigravity-ide\brain\b81c40a4-adec-4fcb-adc0-475fccfcf2aa\circuit_diagram.png"
    shutil.copyfile(out_img, brain_path)
    print("Synced across docs and brain directories.")
