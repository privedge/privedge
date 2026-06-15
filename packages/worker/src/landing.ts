export const LANDING_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Privedge · Edge Privacy Proxy</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700;800&family=Geist+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --ink:      #0d1030;
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
      align-items: center;
      justify-content: center;
      -webkit-font-smoothing: antialiased;
      position: relative;
    }
    body::before {
      content: '';
      position: fixed;
      inset: 0;
      background-image: radial-gradient(circle, rgba(13,16,48,0.05) 1px, transparent 1px);
      background-size: 28px 28px;
      pointer-events: none;
    }
    .page {
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      gap: 28px;
    }
    .brand-row {
      display: flex;
      align-items: center;
      gap: 18px;
    }
    .brand-mark { width: 56px; height: 74px; flex-shrink: 0; }
    .brand-name {
      font-size: 80px;
      font-weight: 800;
      letter-spacing: -0.045em;
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
    }
    .dot {
      width: 7px; height: 7px;
      border-radius: 50%;
      background: var(--edge);
      flex-shrink: 0;
      animation: pulse 1.6s ease-in-out infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50%       { opacity: .35; transform: scale(.75); }
    }
    .link {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-family: var(--mono);
      font-size: 13px;
      font-weight: 500;
      letter-spacing: 0.03em;
      color: var(--ink-faint);
      text-decoration: none;
      transition: color .15s;
    }
    .link:hover { color: var(--edge-ink); }
    .link svg { width: 13px; height: 13px; flex-shrink: 0; }
  </style>
</head>
<body>
  <div class="page">

    <div class="brand-row">
      <svg class="brand-mark" viewBox="0 0 695.78 922.68" xmlns="http://www.w3.org/2000/svg">
        <g transform="translate(245.004,318.558)">
          <path d="m -245.004,41.201 207.5,-119.782 0.138,321.109 0.137,2.307 -0.106,239.427 -207.5,119.86 -0.169,-562.92" fill="#181e2f"/>
          <path d="m -36.527,-318.558 c 35.489,21.188 109.929,64.266 223.128,129.163 113.351,64.953 200.731,115.319 262.343,151.144 L 450.776,202.459 170.194,364.479 -36.357,244.284 244.225,82.31 -244.027,-198.776 -36.527,-318.558" fill="#10b981"/>
        </g>
      </svg>
      <span class="brand-name">Privedge</span>
    </div>

    <div class="status"><span class="dot"></span>Edge functions ready</div>

    <a class="link" href="https://privedge.io" target="_blank" rel="noopener noreferrer">
      privedge.io
      <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M6 3H3a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-3M9 2h5m0 0v5m0-5L7 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </a>

  </div>
</body>
</html>`
