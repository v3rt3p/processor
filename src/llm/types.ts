export interface LLMMessage {
  content: string
  name?: string
  role: 'assistant' | 'system' | 'tool' | 'user',
}
