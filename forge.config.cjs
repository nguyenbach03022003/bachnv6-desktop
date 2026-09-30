/** @type {import('@electron-forge/shared-types').ForgeConfig} */
module.exports = {
  // Windows uses node-pty's N-API prebuild. Linux builds compile their native
  // module for Electron using the target machine's toolchain.
  rebuildConfig: process.platform === 'win32' ? { ignoreModules: ['node-pty'] } : {},
  packagerConfig: {
    // node-pty also launches helper executables, so unpack its whole runtime
    // directory rather than only its .node files.
    asar: { unpack: '**/node_modules/node-pty/**' },
    executableName: 'Bachnv6Desktop',
    extraResource: ['THIRD_PARTY_NOTICES.md', 'assets'],
    // The Vite plugin normally copies only .vite. Keep node-pty's JS loader
    // and native binary. Windows can omit source and other OS prebuilds.
    ignore: (file) => {
      if (!file) return false;
      if (file.startsWith('/.vite') || file === '/node_modules' || file === '/node_modules/node-pty') return false;
      // Linux rebuilds node-pty after copying the app; its N-API headers must
      // remain available in that staging tree.
      if (process.platform === 'linux' && file.startsWith('/node_modules/node-addon-api')) return false;
      if (!file.startsWith('/node_modules/node-pty/')) return true;
      if (process.platform !== 'win32') return false;
      const nativePath = file.slice('/node_modules/node-pty/'.length);
      return !(
        nativePath === 'lib' || nativePath.startsWith('lib/') ||
        nativePath === 'prebuilds' || nativePath === `prebuilds/win32-${process.arch}` ||
        (nativePath.startsWith(`prebuilds/win32-${process.arch}/`) && !nativePath.endsWith('.pdb')) ||
        nativePath === 'package.json' || nativePath === 'LICENSE'
      );
    },
  },
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'Bachnv6Desktop',
        authors: 'Bachnv6',
        description: 'A personal desktop dashboard for Windows and Linux',
      },
    },
    {
      name: '@electron-forge/maker-deb',
      config: {
        options: {
          maintainer: 'Bachnv6',
          description: 'A personal desktop dashboard',
          bin: 'Bachnv6Desktop',
          categories: ['Utility', 'Development'],
          depends: [
            'libc6 (>= 2.34)',
            'libstdc++6 (>= 6)',
            'libasound2t64 | libasound2',
            'libx11-xcb1',
            'libsecret-1-0',
          ],
          recommends: ['gnome-keyring'],
        },
      },
    },
    {
      name: '@electron-forge/maker-rpm',
      config: {
        options: {
          description: 'A personal desktop dashboard',
        },
      },
    },
  ],
  plugins: [
    { name: '@electron-forge/plugin-auto-unpack-natives', config: {} },
    {
      name: '@electron-forge/plugin-vite',
      config: {
        build: [
          { entry: 'src/main.ts', config: 'vite.main.config.mjs' },
          { entry: 'src/preload.ts', config: 'vite.preload.config.mjs' },
        ],
        renderer: [
          { name: 'main_window', config: 'vite.renderer.config.mjs' },
        ],
      },
    },
  ],
};
