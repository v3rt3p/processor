import { Span, startSpan } from '@sentry/node'
import { ProcessorDirectiveFunctions } from '@v3rt3p/types/processor'
import z from 'zod'

import { Functions, FunctionServer } from './types'

export interface DirectiveResult {
  arguments: unknown
  name: string
}

export class DirectiveFunctionServer implements FunctionServer {
  constructor (private readonly directiveFunctions: ProcessorDirectiveFunctions) {}

  async callDirectiveFunction (sessionId: string, _metadata: object, functionName: string,
    arguments_: unknown, parentSpan: Span): Promise<DirectiveResult | null> {
    return startSpan({
      attributes: {
        parameters: JSON.stringify(arguments_, undefined, 2)
      },
      name: `Calling directive function ${sessionId}`,
      parentSpan
    }, async () => {
      const directiveFunction = this.directiveFunctions[functionName]
      if (!directiveFunction) {
        return null
      }
      return {
        arguments: arguments_,
        name: functionName
      }
    })
  }

  callFunction (): Promise<string> {
    throw new Error('no async calls supported')
  }

  async getFunctions (): Promise<Functions> {
    return Object.fromEntries(Object.entries(this.directiveFunctions)
      .map(([name, function_]) => [name, {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        argumentsSchema: z.fromJSONSchema(function_.arguments as any),
        description: function_.description,
        hasResponse: false
      }]))
  }

  getName (): string {
    return 'directive'
  }

  async initialize (): Promise<void> {}
}
