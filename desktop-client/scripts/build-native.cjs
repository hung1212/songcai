const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
if (process.platform === 'darwin') {
  const root = path.resolve(__dirname, '..');
  fs.mkdirSync(path.join(root, 'native/bin'), { recursive: true });
  execFileSync('/usr/bin/xcrun', ['swiftc', '-O', '-target', `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macos12.0`,
    '-module-cache-path', path.join(root, 'node_modules/.swift-module-cache'),
    path.join(root, 'native/wechat-reader.swift'), '-o', path.join(root, 'native/bin/wechat-reader')], { stdio: 'inherit' });
  console.log('本机架构的微信读取与本地 OCR 辅助程序已构建');
}
