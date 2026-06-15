export const LANDING_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Privedge · Privacy-first AI Proxy</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700;800&family=Geist+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --ink:      #0d1030;
      --ink-dim:  #545876;
      --ink-faint:#6b7088;
      --edge:     #10b981;
      --edge-ink: #05795a;
      --sans: "Geist", ui-sans-serif, sans-serif;
      --mono: "Geist Mono", ui-monospace, monospace;
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #fff;
      color: var(--ink);
      font-family: var(--sans);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      -webkit-font-smoothing: antialiased;
      padding: 64px 24px;
      position: relative;
      overflow-x: hidden;
    }
    body::before {
      content: '';
      position: fixed;
      inset: 0;
      background-image: radial-gradient(circle, rgba(13,16,48,0.05) 1px, transparent 1px);
      background-size: 28px 28px;
      pointer-events: none;
      z-index: 0;
    }
    .page {
      position: relative;
      z-index: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      max-width: 600px;
      width: 100%;
    }
    .shield {
      width: 110px;
      height: auto;
      margin-bottom: 40px;
      filter: drop-shadow(0 8px 32px rgba(16,185,129,0.18));
    }
    .brand-row {
      display: flex;
      align-items: center;
      gap: 14px;
      margin-bottom: 20px;
    }
    .brand-mark { width: 36px; height: 48px; flex-shrink: 0; }
    .brand-name {
      font-size: 52px;
      font-weight: 800;
      letter-spacing: -0.04em;
      color: var(--ink);
      line-height: 1;
    }
    .status {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 16px;
      background: rgba(16,185,129,0.07);
      border: 1px solid rgba(16,185,129,0.22);
      border-radius: 99px;
      font-family: var(--mono);
      font-size: 11.5px;
      font-weight: 500;
      letter-spacing: 0.07em;
      text-transform: uppercase;
      color: var(--edge-ink);
      margin-bottom: 36px;
    }
    .dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--edge);
      flex-shrink: 0;
      animation: pulse 1.6s ease-in-out infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50%       { opacity: .35; transform: scale(.75); }
    }
    .eyebrow {
      font-family: var(--mono);
      font-size: 11.5px;
      font-weight: 500;
      letter-spacing: 0.09em;
      text-transform: uppercase;
      color: var(--edge-ink);
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 14px;
    }
    .eyebrow-dot {
      width: 6px; height: 6px;
      border-radius: 50%;
      background: var(--edge);
      flex-shrink: 0;
    }
    h1 {
      font-size: clamp(40px, 9vw, 68px);
      font-weight: 800;
      letter-spacing: -0.045em;
      line-height: 1.08;
      color: var(--ink);
      margin-bottom: 20px;
    }
    h1 .accent { color: var(--edge); }
    .sub {
      font-size: 18px;
      line-height: 1.55;
      color: var(--ink-dim);
      letter-spacing: -0.012em;
      margin-bottom: 36px;
    }
    .sub strong { color: var(--ink); font-weight: 500; }
    .badges {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 7px;
      flex-wrap: wrap;
      margin-bottom: 52px;
    }
    .badge {
      font-family: var(--mono);
      font-size: 10.5px;
      font-weight: 500;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      padding: 5px 12px;
      border-radius: 6px;
      border: 1px solid rgba(16,185,129,0.28);
      color: var(--edge-ink);
      background: rgba(16,185,129,0.06);
    }
    .badge-neutral {
      border-color: rgba(13,16,48,0.13);
      color: var(--ink-faint);
      background: transparent;
    }
    .domain {
      font-family: var(--mono);
      font-size: 13px;
      font-weight: 500;
      letter-spacing: 0.04em;
      color: var(--ink-faint);
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .domain::before {
      content: '';
      width: 5px; height: 5px;
      border-radius: 50%;
      background: var(--edge);
      flex-shrink: 0;
    }
  </style>
</head>
<body>
  <div class="page">

    <!-- Shield -->
    <svg class="shield" viewBox="809 262 82 126" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="rim" x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0"    stop-color="#ffffff"/>
          <stop offset="0.22" stop-color="#a7f3d0"/>
          <stop offset="0.55" stop-color="#34d399"/>
          <stop offset="1"    stop-color="#047857"/>
        </linearGradient>
        <linearGradient id="face" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#34d399" stop-opacity="0.42"/>
          <stop offset="1" stop-color="#0c7a5b" stop-opacity="0.4"/>
        </linearGradient>
        <radialGradient id="kh" cx="50%" cy="50%" r="50%">
          <stop offset="0%"   stop-color="#ecfdf5" stop-opacity="0.95"/>
          <stop offset="45%"  stop-color="#34d399" stop-opacity="0.35"/>
          <stop offset="100%" stop-color="#10b981" stop-opacity="0"/>
        </radialGradient>
        <clipPath id="fc">
          <path d="M 850,276 L 880,287 L 879,317 C 877,340 864,360 850,373 C 836,360 823,340 821,317 L 820,287 Z"/>
        </clipPath>
        <filter id="md" x="-300%" y="-300%" width="700%" height="700%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="10" result="b"/>
          <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <filter id="sm" x="-200%" y="-200%" width="500%" height="500%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="b"/>
          <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <!-- shadow -->
      <path d="M 850,268 L 888,282 L 887,318 C 885,344 870,366 850,382 C 830,366 815,344 813,318 L 812,282 Z"
            fill="#064e3b" fill-opacity="0.18" filter="url(#md)" transform="translate(0,5)"/>
      <!-- outer rim -->
      <path d="M 850,268 L 888,282 L 887,318 C 885,344 870,366 850,382 C 830,366 815,344 813,318 L 812,282 Z"
            fill="url(#rim)" stroke="#065f46" stroke-width="1" stroke-opacity="0.45" stroke-linejoin="round"/>
      <!-- translucent face -->
      <path d="M 850,276 L 880,287 L 879,317 C 877,340 864,360 850,373 C 836,360 823,340 821,317 L 820,287 Z"
            fill="url(#face)"/>
      <!-- PCB traces -->
      <g clip-path="url(#fc)" stroke="#ecfdf5" stroke-width="1" fill="none" stroke-opacity="0.85" stroke-linecap="round">
        <path d="M 822,300 H 836"/><path d="M 821,312 H 836"/><path d="M 822,336 H 836"/><path d="M 824,348 H 834"/>
        <path d="M 864,300 H 878"/><path d="M 864,312 H 879"/><path d="M 864,336 H 878"/><path d="M 866,348 H 876"/>
        <path d="M 842,286 V 304"/><path d="M 850,282 V 302"/><path d="M 858,286 V 304"/>
        <path d="M 842,334 V 352"/><path d="M 858,334 V 352"/>
        <path d="M 824,292 H 836 L 840,296"/><path d="M 876,292 H 864 L 860,296"/>
      </g>
      <g clip-path="url(#fc)" fill="#ffffff">
        <circle cx="822" cy="300" r="1.5"/><circle cx="821" cy="312" r="1.5"/>
        <circle cx="822" cy="336" r="1.5"/><circle cx="824" cy="348" r="1.5"/>
        <circle cx="878" cy="300" r="1.5"/><circle cx="879" cy="312" r="1.5"/>
        <circle cx="878" cy="336" r="1.5"/><circle cx="876" cy="348" r="1.5"/>
        <circle cx="842" cy="286" r="1.5"/><circle cx="850" cy="282" r="1.5"/>
        <circle cx="858" cy="286" r="1.5"/><circle cx="842" cy="352" r="1.5"/>
        <circle cx="858" cy="352" r="1.5"/>
      </g>
      <!-- inner bevel -->
      <path d="M 850,276 L 880,287 L 879,317 C 877,340 864,360 850,373 C 836,360 823,340 821,317 L 820,287 Z"
            fill="none" stroke="#6ee7b7" stroke-width="1" stroke-opacity="0.45" stroke-linejoin="round"/>
      <!-- specular highlight -->
      <path d="M 816,281 L 850,271 L 884,281"
            fill="none" stroke="#ffffff" stroke-width="1.6" stroke-opacity="0.5" stroke-linecap="round" stroke-linejoin="round"/>
      <!-- keyhole luminoso -->
      <g transform="translate(850,316) scale(0.8) translate(-850,-316)">
        <circle cx="850" cy="318" r="30" fill="url(#kh)"/>
        <circle cx="850" cy="314" r="11" fill="#d1fae5" filter="url(#md)"/>
        <path d="M 845,318 L 855,318 L 857.5,336 L 842.5,336 Z" fill="#d1fae5" filter="url(#md)"/>
        <circle cx="850" cy="314" r="8.5" fill="#ecfdf5" filter="url(#sm)"/>
        <path d="M 846,318 L 854,318 L 856.3,335 L 843.7,335 Z" fill="#ecfdf5" filter="url(#sm)"/>
        <circle cx="850" cy="314" r="6.5" fill="#ffffff"/>
        <path d="M 847,318 L 853,318 L 855,334 L 845,334 Z" fill="#ffffff"/>
      </g>
    </svg>

    <!-- Brand -->
    <div class="brand-row">
      <svg class="brand-mark" viewBox="0 0 695.78 922.68" xmlns="http://www.w3.org/2000/svg">
        <g transform="translate(245.004,318.558)">
          <path d="m -245.004,41.201 207.5,-119.782 0.138,321.109 0.137,2.307 -0.106,239.427 -207.5,119.86 -0.169,-562.92" fill="#181e2f"/>
          <path d="m -36.527,-318.558 c 35.489,21.188 109.929,64.266 223.128,129.163 113.351,64.953 200.731,115.319 262.343,151.144 L 450.776,202.459 170.194,364.479 -36.357,244.284 244.225,82.31 -244.027,-198.776 -36.527,-318.558" fill="#10b981"/>
        </g>
      </svg>
      <span class="brand-name">Privedge</span>
    </div>

    <!-- Status -->
    <div class="status"><span class="dot"></span>Edge functions ready</div>

    <!-- Eyebrow -->
    <div class="eyebrow"><span class="eyebrow-dot"></span>AI Inference Proxy</div>

    <!-- Headline -->
    <h1>Privacy on<br/>the <span class="accent">edge.</span></h1>

    <!-- Subtitle -->
    <p class="sub">Compliance by architecture.<br/><strong>Not by promise.</strong></p>

    <!-- Compliance badges -->
    <div class="badges">
      <span class="badge">HIPAA</span>
      <span class="badge">GDPR</span>
      <span class="badge">PCI DSS</span>
      <span class="badge badge-neutral">200+ edge nodes</span>
      <span class="badge badge-neutral">MIT</span>
    </div>

    <!-- Domain -->
    <div class="domain">edge.privedge.io</div>

  </div>
</body>
</html>`
