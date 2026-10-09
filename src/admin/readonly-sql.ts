/** 给小镇建一个只读账号：只能读 usage_logs、accounts、groups 三张表，默认只读事务。后台和 README 展示同一份。 */
export const READONLY_SQL = `CREATE ROLE token_town LOGIN PASSWORD '请替换为强密码';
GRANT CONNECT ON DATABASE sub2api TO token_town;
GRANT USAGE ON SCHEMA public TO token_town;
GRANT SELECT ON usage_logs, accounts, groups TO token_town;
ALTER ROLE token_town SET default_transaction_read_only = on;`
