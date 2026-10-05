# 部署到公网

摄像头访问需要 HTTPS（本地开发可用 localhost）。这是纯静态前端，
可部署至 Cloudflare Pages、Netlify、Vercel 或其他 HTTPS 静态托管服务。

## 构建

```sh
npm ci
npm run setup:models
npm test
npm run build
```

发布目录为 `dist`。其中包含本地模型、WASM、页面资源和第三方许可证；
请发布整个目录，避免手动遗漏模型或许可证。不要上传源码目录、`.env`、
`.wrangler` 或任何凭据。

## Cloudflare Pages

可在 Pages 控制台导入自己的 GitHub 仓库：

- 构建命令：`npm ci && npm run setup:models && npm run build`
- 输出目录：`dist`
- Node.js：22.12 或以上的受支持版本

也可以在本机登录自己的 Cloudflare 账号后部署构建产物：

```sh
npx wrangler@4.45.1 login
npx wrangler@4.45.1 pages deploy dist --project-name YOUR_PAGES_PROJECT --branch main
```

先在控制台创建你自己的 Pages 项目，将 `YOUR_PAGES_PROJECT` 替换为项目名。
自定义域名按 Pages 提示配置。GitHub 上的 CI 只执行测试和构建，不会自动
发布到维护者的演示站，也不需要 Cloudflare Token。

## 部署后检查

1. 首页可以通过 HTTPS 访问。
2. `/models/hand_landmarker.task`、`/models/wasm/vision_wasm_internal.wasm`
   和 no-SIMD 版本返回真实二进制内容，而不是 HTML 回退页面。
3. `/THIRD_PARTY_NOTICES.md` 和 `/licenses/` 内许可证随站点发布。
4. “爆发”、两种效果切换和声音按钮正常；摄像头需要使用者主动授权。
5. 如看到缓存旧版本，强制刷新后重试。
