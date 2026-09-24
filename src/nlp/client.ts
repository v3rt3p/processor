import z from 'zod'

import { FunctionInfo, Functions } from '../llm/function/types'

const functionCatalogEntry = z.object({
  arguments: z.record(z.string(), z.object({
    constraints: z.object({
      argumentType: z.enum(['number', 'string']),
      max: z.number().optional(),
      min: z.number().optional(),
      type: z.string(),
      variants: z.array(z.object({
        description: z.string(),
        value: z.union([z.number(), z.string()])
      })).optional()
    }),
    description: z.string()
  })),
  description: z.string()
})

const parseResponse = z.object({
  confidence: z.number().min(0).max(1),
  functionCalls: z.array(z.object({
    arguments: z.unknown(),
    name: z.string(),
    schedule: z.number().nonnegative().optional()
  })),
  intent: z.string(),
  kind: z.enum(['response', 'function_calls', 'unknown']),
  text: z.string()
})

export type NlpResult = z.infer<typeof parseResponse>

export class NlpServiceClient {
  constructor (private readonly url: string, private readonly timeoutMs = 500) {}

  async parse (text: string, functions: Functions, metadata: object, sessionId: string): Promise<NlpResult | null> {
    if (!this.url) return null

    try {
      const response = await fetch(`${this.url.replace(/\/$/u, '')}/parse`, {
        body: JSON.stringify({
          functions: toCatalog(functions),
          metadata,
          sessionId,
          text
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
        signal: AbortSignal.timeout(this.timeoutMs)
      })
      if (!response.ok) return null
      return parseResponse.parse(await response.json())
    } catch {
      return null
    }
  }
}

function toCatalog (functions: Functions): Record<string, z.infer<typeof functionCatalogEntry>> {
  return Object.fromEntries(Object.entries(functions).map(([name, info]) => [name, toCatalogEntry(info)]))
}

function toCatalogEntry (info: FunctionInfo): z.infer<typeof functionCatalogEntry> {
  // Zod schemas are executable objects; expose the common state contract without
  // coupling the NLP service to processor internals.
  if (/\bstate\b/u.test(info.description) || /_state$/u.test(info.description)) {
    return {
      arguments: {
        state: {
          constraints: {
            argumentType: 'number',
            type: 'number-variants',
            variants: [
              { description: 'off', value: 0 },
              { description: 'on', value: 1 }
            ]
          },
          description: 'state'
        }
      },
      description: info.description
    }
  }
  return {
    arguments: {},
    description: info.description
  }
}
