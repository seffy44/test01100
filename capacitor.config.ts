
import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.system.sololeveling',
  appName: 'System 0.2',
  webDir: '.',
  bundledWebRuntime: false,
  // Exclude files that are not part of the web app itself
  // to keep the native package size small.
  sync: {
    exclude: [
      'capacitor.config.ts',
      'tsconfig.json',
      'package.json',
      'package-lock.json',
      'node_modules/',
      '.git/'
    ]
  }
};

export default config;
