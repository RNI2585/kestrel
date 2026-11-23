import type { CapacitorConfig } from '@capacitor/cli'

// The Android shell loads the same static build that is hosted on the web, so
// `npm run build` must run before `cap sync`. No server URL is set: the app is
// fully offline.
const config: CapacitorConfig = {
  appId: 'com.kestrel.terminal',
  appName: 'Kestrel',
  webDir: 'dist',
  android: {
    backgroundColor: '#141415',
  },
}

export default config
