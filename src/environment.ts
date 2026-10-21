import { config } from 'dotenv'
import { z } from 'zod'

config({
  path: '.env.local'
})

config()

const environmentType = z.object({
  CACHE_SIZE: z.string().default('1000').transform(value => Number.parseInt(value)),

  OPENAI_API_KEY: z.string().default(''),
  OPENAI_BASE_URL: z.url().default('https://llm.bksp.in'),
  OPENAI_MODEL: z.string().default('qwen2.5-coder-7b-instruct'),

  NLP_SERVICE_TIMEOUT_MS: z.string().default('500').transform(value => Number.parseInt(value)),
  NLP_SERVICE_URL: z.string().default(''),

  PORT: z.string().default('8080').transform(value => Number.parseInt(value)),
  PROCESSOR_FUNCTION_SERVER_URLS: z.string().default('').transform(urls => urls.split(',').filter(Boolean)),
  PROCESSOR_MCP_SERVER_URLS: z.string().default('').transform(urls => urls.split(',').filter(Boolean)),
  PROCESSOR_STATE_SERVER_URLS: z.string().default('').transform(urls => urls.split(',').filter(Boolean)),
  PROMPT_TEMPLATE_PATH: z.string().default('prompt.handlebars'),

  SENTRY_DSN: z.url().default('https://test@o0.ingest.sentry.io/0'),

  STATE_PROMPT_TEMPLATE_PATH: z.string().default('prompt-state.handlebars')
})

export type Environment = z.infer<typeof environmentType>

export function getEnvironment (): Environment {
  return environmentType.parse(process.env)
}
