const { spawnSync } = require('node:child_process');

if (process.platform !== 'linux' || process.arch !== 'x64') {
  console.error('Build the Ubuntu amd64 package from Linux x64, including Ubuntu in WSL.');
  process.exit(1);
}

const cli = require.resolve('@electron-forge/cli/dist/electron-forge.js');
const result = spawnSync(process.execPath, [cli, 'make', '--arch=x64', '--targets=@electron-forge/maker-deb'], {
  stdio: 'inherit',
});
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
