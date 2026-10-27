import { Span, startSpan } from '@sentry/node'
import { functions } from '@v3rt3p/types/function-state-server'
import z from 'zod'

import { Functions, FunctionServer } from './types'

export class RemoteFunctionServer implements FunctionServer {
  constructor (private readonly url: string) {}
  async callFunction (sessionId: string, metadata: object, name: string,
    arguments_: unknown, parentSpan: Span): Promise<string> {
    return startSpan({
      attributes: {
        parameters: JSON.stringify(arguments_, undefined, 2)
      },
      name: `Calling function ${name} on ${this.getName()}`,
      op: 'call-function',
      parentSpan
    }, async () => {
      await fetch(this.url, {
        body: JSON.stringify({
          arguments: arguments_,
          metadata,
          name,
          sessionId
        }),
        headers: {
          'content-type': 'application/json'
        },
        method: 'POST'
      })
      return ''
    })
  }

  async getFunctions (sessionId: string, metadata: object, parentSpan: Span): Promise<Functions> {
    return startSpan({
      name: `Requesting functions from ${this.getName()}`,
      op: 'get-functions-server',
      parentSpan
    }, async () => {
      const response = await fetch(this.url, {
        body: JSON.stringify({
          metadata,
          sessionId
        }),
        headers: {
          'content-type': 'application/json',
        },
        method: 'PUT'
      })
      return Object.fromEntries(Object.entries(
        functions.parse(await response.json()))
        .map(([name, entry]) => ([name, ({
          argumentsSchema: z.fromJSONSchema(entry.arguments),
          description: entry.description,
          hasResponse: entry.hasResponse
        })])))
    })
  }

  async getIndependentFunctions (parentSpan: Span): Promise<Functions> {
    return startSpan({
      name: `Requesting independent functions from ${this.getName()}`,
      op: 'get-independent-functions-server',
      parentSpan
    }, async () => {
      const response = await fetch(this.url)
      return Object.fromEntries(Object.entries(
        functions.parse(await response.json()))
        .map(([name, entry]) => ([name, ({
          argumentsSchema: z.fromJSONSchema(entry.arguments),
          description: entry.description,
          hasResponse: entry.hasResponse
        })])))
    })
  }

  getName (): string {
    return `remote{${this.url}}`
  }

  async initialize (): Promise<void> {}
}
