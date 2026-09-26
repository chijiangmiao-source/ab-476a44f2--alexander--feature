FROM node:20-alpine
WORKDIR /app
# 测试直接针对随页面发布的同一份辫群核心代码
COPY web/site/braid.js ./braid.js
COPY verify/test_braid.js verify/check_artifacts.js verify/smoke_health.js verify/run.sh ./
RUN chmod +x run.sh
CMD ["./run.sh"]
