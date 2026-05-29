# 部署说明

这个项目包含 `/api/proxy` 图片代理接口，所以建议部署到支持 Node.js 服务的云平台，例如 Render、Railway、Fly.io 或自己的服务器。不要只部署 `dist` 静态文件，否则外链图片代理会失效。

## Render

1. 把本项目推送到 GitHub。
2. 在 Render 新建 `Web Service`，选择这个仓库。
3. Render 会读取 `render.yaml`，使用下面的命令：
   - Build Command: `npm ci --include=dev && npm run build`
   - Start Command: `npm start`
   - Environment: `NODE_ENV=production`
4. 部署完成后，打开 Render 提供的 `.onrender.com` 地址即可使用。

## Railway

1. 把本项目推送到 GitHub。
2. 在 Railway 选择 `Deploy from GitHub repo`。
3. 设置：
   - Build Command: `npm ci --include=dev && npm run build`
   - Start Command: `npm start`
   - Variable: `NODE_ENV=production`
4. Railway 会自动注入 `PORT`，服务端已经兼容。

## 本地验证

```bash
npm install
npm run build
npm start
```

然后打开 `http://localhost:3000/`。
