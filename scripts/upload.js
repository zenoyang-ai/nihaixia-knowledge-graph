/**
 * miniprogram-ci 上传脚本
 * 用法: node upload.js <private-key-path>
 */
const ci = require('miniprogram-ci');
const path = require('path');

const PROJECT_PATH = path.resolve(__dirname, '..');
const APP_ID = 'wx11826bcc1883aa28';
const VERSION = '1.0.0';
const DESC = '倪海厦知识库智能问答小程序 — 首次发布';

async function main() {
  const keyPath = process.argv[2];
  if (!keyPath) {
    console.error('请提供上传密钥路径: node upload.js /path/to/private.key');
    process.exit(1);
  }

  console.log('正在创建项目...');
  const project = new ci.Project({
    appid: APP_ID,
    type: 'miniProgram',
    projectPath: PROJECT_PATH,
    privateKeyPath: keyPath,
    ignores: ['node_modules/**/*', 'cloudbase/**/*', 'docs/**/*', '*.md'],
  });

  console.log('正在上传代码...');
  try {
    const uploadResult = await ci.upload({
      project,
      version: VERSION,
      desc: DESC,
      setting: {
        es6: true,
        minify: true,
        autoPrefixWXSS: true,
      },
      onProgressUpdate: (info) => {
        if (info._msg) {
          console.log(`[${info._msg}] ${info._percentage || ''}%`);
        }
      },
    });

    console.log('\n✅ 上传成功！');
    console.log('版本:', VERSION);
    console.log('描述:', DESC);
    console.log('大小:', uploadResult.subPackageInfo || 'N/A');
    console.log('\n下一步：在微信公众平台提交审核');
  } catch (err) {
    console.error('\n❌ 上传失败:', err.message);
    if (err.message.includes('private key')) {
      console.error('请确认密钥文件路径正确，且密钥未过期。');
    }
    process.exit(1);
  }
}

main();
