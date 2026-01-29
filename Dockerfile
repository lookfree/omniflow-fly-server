FROM oven/bun:1-alpine

WORKDIR /app

# 复制 package.json 和锁文件
COPY package.json bun.lock* ./

# 安装依赖（包括 devDependencies 用于 TypeScript）
RUN bun install

# 复制源代码（包括 static/injection/visual-edit-script.js）
COPY . .

# 复制并构建 vite-plugin-jsx-tagger
COPY packages/vite-plugin-jsx-tagger /app/packages/vite-plugin-jsx-tagger
WORKDIR /app/packages/vite-plugin-jsx-tagger
RUN bun install && bun run build
WORKDIR /app

# 创建数据目录
RUN mkdir -p /data/sites

# 暴露端口：主服务 + Vite Dev Server 端口范围
EXPOSE 3000
EXPOSE 5200-5219

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["bun", "src/index.ts"]
