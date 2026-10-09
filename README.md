# Token 商店小镇

把每家 AI 厂商一周的 token 用量，画成一座体素小镇：一家厂商一块地皮、一间店，门口排队的人越多，这周用得越多。

一个 Node.js 服务同时提供三样东西：小镇（`/`）、控制后台（`/admin`）和接口（`/api`）。在控制后台里可以：

- 选择数据源：**Sub2API 数据库**（只读、实时）、**上传的 CSV / JSON 文件**，或开箱自带的**虚构示例数据**；
- 控制哪些厂商的店铺在小镇里展示。

访客页面每 30 秒轮询一次，数据没变时服务端只返回 304；用量变化时就地更新排队人数和挂牌，不重建场景。

> 灵感来自 Ryan Sael 的作品 Token Town。本项目的建模、配色、文案与代码均为原创实现，不包含原作品的素材、Logo 或宣传语。
>
> 厂商 Logo 取自 [@lobehub/icons](https://github.com/lobehub/lobe-icons)（MIT 许可），小米 Logo 取自 [Simple Icons](https://simpleicons.org)（CC0），仅用于标识对应厂商，商标归各自所有者；表外厂商和“其他厂商”使用文字缩写徽标。

## 怎么读这座小镇

| 画面元素 | 含义 |
| --- | --- |
| 一块地皮 | 一家 AI 厂商一间店，四周由人行道和公路环绕；超过 20 家时，用量较少的厂商合并为“其他厂商” |
| 店铺顺序 | 按厂商表的固定顺序，逐行从左到右排列，不按用量排名 |
| 门店外观 | 外墙、屋顶、雨棚和屋顶装饰按厂商特色设计，背墙统一是原创街头涂鸦；xAI 店屋顶的火箭每隔二三十秒点火升空，飞出画面后再减速落回发射台（开启“减少动态效果”时不发射） |
| 招牌与挂牌 | 门头招牌和门右侧墙上的挂牌展示厂商 Logo 与名称，门统一开在店面右侧 |
| 排队人数 | 本周 token 用量，按平方根缩放，最多 24 人 |
| 进店节奏 | 每家店一次只进一位顾客，提着购物袋出来后下一位才进；行人从画面外沿人行道走来，过马路等红绿灯。工具栏的“进出速度”可选 1×（原始节奏）/ 2× / 3× / 5×，默认 3×，只加快排队前移、进门、店内停留和出门，路上的行人和车流保持原速；设置保存在当前浏览器 |
| 行人 | 靠右分内外两条小道行走，同向前面有人时保持间距跟着走、能换道时超过去；路口拐进同一段路时离得近的先走；红灯时可以改走同样近的绿灯横道。排队往前挪保持一个排队间距，队伍排满（目标人数再多两位）后，后到的人当作路过 |
| 车流 | 轿车、两厢小车、SUV、出租车、皮卡、面包车、公交车和厢式货车混行，按各自车长跟车；绿灯剩余时间不够开出整个路口、或路口对面排着队放不下时就在停车线前等，大车不会压在路口和人行横道上 |
| 天色 | 小镇时间：默认跟随系统时区的当前时间，可切换时区或手动拖到任意时刻 |

左下角数据卡给出本周 token、较上周变化、近几周柱状图、主推模型的上下文、模态和价格、访客和门店特色；右侧工具栏里的“本周数据”是与三维场景等价的表格视图，WebGL 不可用时也能完整阅读数据。

每家店的主推模型按以下顺序决定：

1. 在数据卡上点主推模型名，从下拉里选一款本周在售的模型；选“默认”恢复。这个设置只保存在当前浏览器，不会写进数据文件，也不会随链接分享给别人。
2. 数据文件里 `featured` 列标为“是”的模型；同一家标了多款时，取本周用量最高的那款。
3. 以上都没有时，取本周用量最高的模型。

指定的模型某一周没有用量时，这一周按默认显示，数据卡上会给出提示和“改回默认”。主推设置只影响数据卡和数据表，不会重建三维场景。

工具栏第一个按钮是小镇时钟：“跟随实时”按所选时区（默认跟随系统）每 15 秒更新天色；“手动调节”可拖动滑块或点选清晨、正午、黄昏、深夜。界面在日照过半时用浅色，否则用深色；设置保存在本机浏览器。

操作：`←` / `→` 切换上一家 / 下一家，`Home` / `End` 跳到首尾；点击店铺走过去；拖动旋转、滚轮缩放、右键拖动平移。

手机等窄屏上，工具栏横排在数据卡上方；数据卡右上角可以收起柱状图和模型资料，矮屏默认收起，给场景留出空间。

## 本地运行

需要 Node.js 22+ 与 pnpm 10。

```bash
pnpm install --frozen-lockfile
cp .env.example .env     # 填写 TOWN_SECRET 与 ADMIN_PASSWORD
pnpm dev                 # 小镇 http://localhost:3200，后台 http://localhost:3200/admin
```

`pnpm dev` 同时启动 Vite（3200 端口）和服务端（3201 端口，`/api` 由 Vite 代理过去）。

检查、构建与启动：

```bash
pnpm run typecheck && pnpm run test && pnpm run build
pnpm start               # 用 dist/ 与 dist-server/ 启动，默认 http://0.0.0.0:3200
```

接入真实 PostgreSQL 的集成测试默认跳过；需要时用一个可以建表、建角色的空库运行：

```bash
docker run -d --name token-town-it-pg -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=sub2api -p 127.0.0.1:55491:5432 postgres:18-alpine
TEST_DATABASE_URL=postgres://postgres:pw@127.0.0.1:55491/sub2api pnpm exec vitest run server/sources/sub2api.integration.test.ts
```

## 部署

### 环境变量

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `TOWN_SECRET` | 是 | 至少 32 个字符，用来签发后台会话、加密保存在配置里的数据库密码。生成：`openssl rand -base64 36`。**更换后已登录的会话失效，已保存的数据库密码也需要在后台重新填写** |
| `ADMIN_PASSWORD` | 否 | 控制后台密码。不设置时后台不可用，小镇照常运行 |
| `PORT` / `HOST` | 否 | 默认 `3200` / `0.0.0.0` |
| `DATA_DIR` | 否 | 配置与上传数据的目录，默认 `./data`（镜像里是 `/app/data`，需要持久化） |
| `COOKIE_SECURE` | 否 | 通过 HTTPS 访问时设为 `true`，会话 Cookie 只走 HTTPS |
| `TRUST_PROXY` | 否 | 在反向代理后面时设为 `true`：登录限流按 `X-Forwarded-For` 区分来源，同源校验认 `X-Forwarded-Host` |
| `SUB2API_DATABASE_HOST` / `_PORT` / `_DBNAME` / `_USER` / `_PASSWORD` / `_SSLMODE` | 否 | 只在**第一次启动、还没有配置文件**时用来预填 Sub2API 数据源，方便和 Sub2API 一起用 Compose 部署；之后以后台的配置为准 |

`.env.example` 列出了这些变量；`.env` 和 `data/` 不要提交到仓库。

### Docker / Compose

```bash
cp compose.example.yml compose.yml   # 按需修改 Sub2API 的网络名
cp .env.example .env                 # 填写密钥和密码
docker compose up -d --build
```

镜像以非 root 用户运行，`/app/data` 是持久卷（配置文件权限 600）。示例 Compose 把端口只绑在本机，由 NGINX 等反向代理对外提供 HTTPS；同时打开了 `COOKIE_SECURE` 和 `TRUST_PROXY`。拉不到 `node:22-alpine` 时，可以用 `--build-arg NODE_IMAGE=node:22-slim` 换成别的 Node 22 镜像。

## 控制后台

打开 `/admin`，输入 `ADMIN_PASSWORD` 登录（同一来源 5 分钟内失败 5 次会暂时锁定；会话 12 小时）。

- **概览**：当前数据源、最近一次读取的时间与结果、最新一周和行数，可以立即刷新。读取失败时会说明原因。
- **店铺展示**：逐家开关，或一键“全部展示”“只展示有数据的”。隐藏的厂商在服务端就被剔除：不在小镇里开店、不计入总量，也不出现在公开接口里。
- **数据源**：三选一，保存后立即生效，访客页面 30 秒内更新。
  - **Sub2API 数据库**：填写主机、端口、库名、用户名、密码和 SSL 模式，可以先“测试连接”（用表单里的参数试读一次，显示最新一周用量最高的模型），再保存。密码用 AES-256-GCM 加密后保存在服务端，接口不会返回它；留空表示保留原密码，也可以清除。
  - **上传文件**：拖入或选择 CSV / JSON，格式见下文。上传的数据保存在服务端，对所有访客生效。
  - **示例数据**：虚构的演示数据，小镇会标注“示例数据 · 虚构”。

### 接入 Sub2API

小镇只读三张表：`usage_logs`、`accounts` 和 `groups`。建议用 Sub2API 数据库的管理员账号建一个只读账号（后台的数据源页里也有这段 SQL，可以一键复制）：

```sql
CREATE ROLE token_town LOGIN PASSWORD '请替换为强密码';
GRANT CONNECT ON DATABASE sub2api TO token_town;
GRANT USAGE ON SCHEMA public TO token_town;
GRANT SELECT ON usage_logs, accounts, groups TO token_town;
ALTER ROLE token_town SET default_transaction_read_only = on;
```

读取方式与口径：

- 连接参数带 `default_transaction_read_only=on` 和 15 秒的 `statement_timeout`，每次查询再包一层 `BEGIN READ ONLY`；连接池最多 2 个连接。
- 按“模型 × 周”聚合 token（`input_tokens + output_tokens + cache_creation_tokens + cache_read_tokens`）和去重用户数，周按所选时区（默认 `Asia/Shanghai`）的周一切分。
- 模型名默认用 Sub2API 官方统计口径 `COALESCE(NULLIF(TRIM(requested_model), ''), model)`，也可以改成上游实际调用的模型。
- 默认只统计成功请求（`actual_cost > 0`，与 Sub2API 官方统计一致）。
- 模型名认不出厂商时，按分组或账号的上游平台归类（`composite` 分组取账号平台），例如 kimi 平台归到 Kimi 的店。
- 查询前先探测表结构，缺少可选列（缓存 token、`requested_model`、`actual_cost` 等）时自动退化；不带时区的 `created_at` 按 UTC 理解。
- 每隔设定的间隔（默认 1 分钟）只重查本周，已经过去的周每小时、跨周或改配置时才重查一次完整窗口。
- 读取失败时继续展示上一次成功的数据，小镇右上角的“Sub2API · 实时”标记会变成警示图标，后台概览给出原因。错误只按“连不上 / 认证失败 / 库或表不存在 / 缺少列 / 权限不足 / 超时 / SSL”分类，不会带出连接串或 SQL。

已用 PostgreSQL 18 和 Sub2API v0.2.14 的表结构做过集成测试。本项目不修改、也不引用 Sub2API 源码。

### 数据文件格式

每行是一条“模型 × 周”的用量，限制为 5 MB、5 万行：

| 列 | 必填 | 说明 |
| --- | --- | --- |
| `model` | 是 | 模型名 |
| `tokens` | 是 | 总 token；也可以只给 `input_tokens` / `output_tokens` / `cache_creation_tokens` / `cache_read_tokens` 分项，会自动相加 |
| `week` 或 `date` | 是 | `YYYY-MM-DD`，自动归到所在周的周一 |
| `lab` | 否 | 厂商名；缺省时按模型名识别，识别不了的归入“其他厂商” |
| `visitors` | 否 | 去重用户数；同一用户使用多个模型会在厂商层面被重复计入 |
| `price_in` / `price_out` | 否 | 美元 / 百万 token |
| `context` | 否 | 上下文窗口，支持 `128K`、`1M` 这类写法 |
| `modalities` | 否 | `text\|image\|audio\|video\|file`，用竖线分隔 |
| `released` | 否 | 发布日期，用于“新上架”标记 |
| `featured` | 否 | 该厂商的默认主推模型；`是` / `true` / `1` / `yes` 视为主推，其余值（包括 `false`）视为未指定。访客在数据卡上的本机设置优先于它 |

JSON 可以是行数组，也可以是 `{ "rows": [...], "models": [...] }`，其中 `models` 只放模型资料（价格、上下文等）。后台的上传面板里可以下载一份 CSV 模板。有问题的行会被跳过，并在通知里指出第一处问题；一行都读不出来时上传失败，当前数据保持不变。

不想让小镇直连数据库时，也可以用 [`scripts/export-usage.sql`](scripts/export-usage.sql) 导出 CSV 再上传，口径与服务端一致：

```bash
PGOPTIONS='-c default_transaction_read_only=on' \
  psql "$SUB2API_DSN" --csv -f scripts/export-usage.sql > usage.csv
```

## 目录

```text
index.html / admin.html  小镇与控制后台两个入口
server/
  index.ts             服务端入口：读环境变量、托管页面、启动定时刷新
  app.ts               接口路由：公开数据集、后台登录、店铺展示、数据源
  dataset-service.ts   当前数据源、缓存与增量刷新、隐藏厂商过滤、ETag
  config-store.ts      data/config.json：配置结构校验与原子写入
  secrets.ts / auth.ts 密钥派生、AES-GCM、会话签名、登录限流
  sources/sub2api.ts   Sub2API 只读连接、探测表结构、按周聚合
src/
  App.tsx              小镇：组装界面、键盘导航，从服务端取数
  admin/               控制后台：登录、概览、店铺展示、数据源（shadcn/ui）
  components/          数据卡、数据表、时钟、说明弹窗等小镇组件，以及 ui/ 下的 shadcn/ui 组件
  lib/                 数据模型、导入解析、示例数据、厂商 Logo、时间计算、格式化、偏好与取数
  scene/               three.js 场景：地块与道路、店铺、行人与车流、火箭、昼夜光照与景深
scripts/export-usage.sql
Dockerfile / compose.example.yml / .env.example
```

## 已知局限

- 三维场景需要 WebGL；不可用时会显示说明，数据仍可在“本周数据”中阅读。
- 低性能设备上会自动降低像素比，帧率恢复后再逐步升回。
- 厂商访客数是各模型访客相加，同一用户使用多个模型会被重复计入。
- 服务端是单进程，配置保存在本地文件里；多副本部署需要共享 `DATA_DIR`，且各副本会各自查询 Sub2API。
- Sub2API 的 `usage_logs` 没有按模型的预聚合表，统计周数越多查询越重；数据量很大时建议把统计周数调小，或把刷新间隔调长。
