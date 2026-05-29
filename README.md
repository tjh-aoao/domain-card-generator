# 域·卡牌生成器

一个用于制作、管理和导出《域》卡牌的本地 Web 生成器。

## 功能

- 卡牌编辑与实时预览
- Word / TXT 批量导入卡牌
- 本地牌库保存、克隆、导入和导出
- 单张 PNG 导出
- 批量 PNG 导出
- A4 整页排版导出，方便打印剪裁
- 图片代理接口 `/api/proxy`，用于提升外链图片导出兼容性

## 本地运行

```bash
npm install
npm run dev
```

然后打开 `http://localhost:3000/`。

## 生产构建

```bash
npm run build
npm start
```

## 部署

推荐部署到支持 Node.js 服务的平台，例如 Render 或 Railway。这个项目包含 `/api/proxy` 接口，不建议只部署为纯静态网站。

Render 可直接使用仓库中的 `render.yaml`。
