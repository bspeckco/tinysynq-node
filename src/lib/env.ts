import 'dotenv/config'

type TinySynqEnv = typeof process.env & {
  TINYSYNQ_WS_HOST: number;
  TINYSYNQ_WS_PORT: number;
  TINYSYNQ_HTTP_HOST: number;
  TINYSYNQ_HTTP_PORT: number;
  TINYSYNQ_LOG_LEVEL: number;
  TINYSYNQ_LOG_FORMAT: "json" | "pretty" | "hidden";
};

export const env = process.env as TinySynqEnv;