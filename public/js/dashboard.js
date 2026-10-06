/**
 * dashboard.js — Live dashboard Socket.IO client
 * Updates zone urgency indicators and density bars without page refresh.
 */
(function () {
  'use strict';

  // Socket.IO is loaded via CDN in the layout
  /* global io */
  const socket = io();

  const urgencyColors = {
    Normal:   '#16a34a',
    Elevated: '#f59e0b',
    Critical: '#d93025',
  };

  socket.on('connect', () => {
    const dot = document.getElementById('seex-live-dot');
    if (dot) dot.style.background = '#16a34a';
  });

  socket.on('disconnect', () => {
    const dot = document.getElementById('seex-live-dot');
    if (dot) dot.style.background = '#d93025';
  });

  socket.on('signage_update', (updates) => {
    for (const u of updates) {
      // Update urgency badge
      const badge = document.querySelector(`[data-zone-urgency="${u.zoneId}"]`);
      if (badge) {
        badge.textContent = u.urgency;
        badge.className   = `seex-badge seex-badge--${u.urgency.toLowerCase()}`;
      }

      // Keep the facility overview in sync with the live route and hazard state.
      const mapZone = document.querySelector(`[data-zone-map="${u.zoneId}"]`);
      if (mapZone) {
        const state = u.isHazard ? 'critical' : (u.isExit ? 'exit' : String(u.urgency || 'Normal').toLowerCase());
        mapZone.classList.remove('ops-zone--normal', 'ops-zone--elevated', 'ops-zone--critical', 'ops-zone--exit');
        mapZone.classList.add(`ops-zone--${state}`);
        const route = document.querySelector(`[data-zone-map-route="${u.zoneId}"]`);
        if (route) {
          route.textContent = u.isHazard ? 'Hazard in zone'
            : (u.isExit ? 'Safe exit'
              : (u.recommendedDirectionName ? `Route → ${u.recommendedDirectionName}` : 'No route assigned'));
        }
      }

      // Update direction
      const dir = document.querySelector(`[data-zone-direction="${u.zoneId}"]`);
      if (dir) {
        dir.textContent = u.isHazard
          ? 'Hazard in zone'
          : (u.recommendedDirectionName || (u.isExit ? '✓ This is an exit' : 'No route'));
      }

      // Update the latest reading and make its input source visible.
      const count = document.querySelector(`[data-zone-count="${u.zoneId}"]`);
      if (count && Number.isFinite(Number(u.personCount))) count.textContent = u.personCount;
      const source = document.querySelector(`[data-zone-source="${u.zoneId}"]`);
      if (source && u.readingSource) {
        source.textContent = u.readingSource;
        source.className = u.readingSource === 'No reading'
          ? 'seex-badge'
          : `seex-badge seex-badge--${u.readingSource.toLowerCase()}`;
      }

      // Update density bar from the count/capacity ratio.
      const bar = document.querySelector(`[data-zone-bar="${u.zoneId}"]`);
      if (bar && Number.isFinite(Number(u.personCount))) {
        const capacity = Number(bar.dataset.zoneCapacity);
        const pct = capacity > 0 ? Math.min(100, (Number(u.personCount) / capacity) * 100) : 0;
        bar.style.width     = pct + '%';
        bar.style.background = urgencyColors[u.urgency] || urgencyColors.Normal;
      }
    }
  });
})();
