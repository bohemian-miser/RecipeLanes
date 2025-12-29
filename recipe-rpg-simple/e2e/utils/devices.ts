import { devices } from '@playwright/test';

export const deviceConfigs = [
  // { name: 'phone', viewport: devices['iPhone 12'].viewport!, isMobile: true },
  { name: 'desktop', viewport: { width: 1280, height: 720 }, isMobile: false },
];
