// Local development identity only; distribution still needs Developer ID + notarization.
const path = require('node:path');
const { signAsync } = require('@electron/osx-sign');
async function main() {
  if (process.platform !== 'darwin') throw new Error('本地 Mac 签名须在 macOS 上执行');
  if (!process.argv.slice(2).length) throw new Error('请传入 release/ 下的 .app 路径');
  for (const filename of process.argv.slice(2)) {
    const app = path.resolve(filename);
    await signAsync({ app, platform: 'darwin', identity: '-', identityValidation: false,
      preAutoEntitlements: false, preEmbedProvisioningProfile: false,
      optionsForFile: () => ({
        timestamp: 'none', hardenedRuntime: true,
        entitlements: path.join(__dirname, '../build/entitlements.preview.plist'),
      }),
    });
    console.log(`本地签名结构验证通过（实际启动仍须检查）：${app}`);
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
