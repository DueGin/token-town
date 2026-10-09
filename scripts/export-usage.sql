-- Token 商店小镇：从 Sub2API 导出最近 8 周的模型用量（与小镇服务端直连时的口径一致）
--
-- 只读聚合，只输出“模型 × 周”的合计与去重用户数，不导出任何用户标识、密钥或请求内容。
-- 请在只读事务中执行（需要 psql 12+ 才支持 --csv）：
--
--   PGOPTIONS='-c default_transaction_read_only=on' \
--     psql "$SUB2API_DSN" --csv -f scripts/export-usage.sql > usage.csv
--
-- 建议使用只读账号（建法见 README 的“接入 Sub2API”）；不要把 DSN 写进仓库或 shell 历史。
--
-- 口径：
--   * 模型名用 Sub2API 官方统计口径 COALESCE(NULLIF(TRIM(requested_model), ''), model)；
--     老版本没有 requested_model 列时，把 model_name 一行改成 model。
--   * 只统计成功请求（actual_cost > 0），与 Sub2API 官方统计一致；想包含失败请求就删掉那一行。
--   * 周按 Asia/Shanghai 的周一切分；换时区就把三处 'Asia/Shanghai' 一起改掉。
--   * created_at 若是不带时区的 timestamp（按 UTC 存储），把 created_at 换成 (created_at AT TIME ZONE 'UTC')。
--
-- 输出列 model, week, tokens, visitors 可以直接在控制后台“数据源 → 上传文件”里使用；
-- 厂商按模型名自动识别，无法识别的归入“其他厂商”，也可以自行补一列 lab。

WITH usage AS (
  SELECT
    COALESCE(NULLIF(TRIM(requested_model), ''), model) AS model_name,
    created_at,
    user_id,
    COALESCE(input_tokens, 0)
      + COALESCE(output_tokens, 0)
      + COALESCE(cache_creation_tokens, 0)
      + COALESCE(cache_read_tokens, 0) AS tokens
  FROM usage_logs
  WHERE created_at >= (date_trunc('week', now() AT TIME ZONE 'Asia/Shanghai') - INTERVAL '7 weeks') AT TIME ZONE 'Asia/Shanghai'
    AND actual_cost > 0
)
SELECT
  model_name AS model,
  to_char(date_trunc('week', created_at AT TIME ZONE 'Asia/Shanghai'), 'YYYY-MM-DD') AS week,
  SUM(tokens) AS tokens,
  COUNT(DISTINCT user_id) AS visitors
FROM usage
WHERE NULLIF(TRIM(model_name), '') IS NOT NULL
GROUP BY 1, 2
HAVING SUM(tokens) > 0
ORDER BY week, tokens DESC;
