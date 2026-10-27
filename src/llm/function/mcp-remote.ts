import { Client } from '@modelcontextprotocol/sdk/client'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp'
import { Span, startSpan } from '@sentry/node'
import z from 'zod'
import { JSONSchema } from 'zod/v4/core'

import { getLogger } from '../../logger'
import { Functions, FunctionServer } from './types'

export class RemoteMCPServer implements FunctionServer {
  private readonly logger = getLogger<RemoteMCPServer>()
  private readonly mcp: Client

  constructor (private readonly url: string, private readonly name: string) {
    this.mcp = new Client({ name: '@v3rt3p/processor', version: '1.0.0' })
  }

  async callFunction (_sessionId: string, _metadata: object,
    functionName: string, arguments_: unknown, parentSpan: Span): Promise<string> {
    return startSpan({
      attributes: {
        arguments: JSON.stringify(arguments_, undefined, 2)
      },
      name: `Calling MCP function ${functionName} on ${this.getName()}`,
      op: 'call-mcp-function',
      parentSpan
    }, async span => {
      this.logger.info(`Calling ${functionName}`)
      const response = await this.mcp.callTool({
        arguments: arguments_ as unknown as { [k: string]: unknown },
        name: functionName.slice(this.name.length + 1)
      })
      const responseItems = response.content as unknown as {
        text: ''
        type: 'text' | string,
      }[]
      const result = String(responseItems[0]?.text ?? 'N/A')
      span.setAttribute('result', result)
      return result
    })
  }

  async getFunctions (): Promise<Functions> {
    return {}
  }

  async getIndependentFunctions (parentSpan: Span): Promise<Functions> {
    return startSpan({
      name: `Requesting MCP functions from ${this.getName()}`,
      op: 'get-mcp-functions-server',
      parentSpan
    }, async () => {
      const tools = await this.mcp.listTools()
      const functions: Functions = {}
      for (const tool of tools.tools) {
        functions[`${this.name}_${tool.name}`] = {
          argumentsSchema: z.fromJSONSchema(tool.inputSchema as JSONSchema._JSONSchema),
          description: tool.description ?? '???',
          hasResponse: true
        }
      }
      return functions
    })
  }

  getName (): string {
    return `mcp{${this.name}#${this.url}`
  }

  async initialize (): Promise<void> {
    this.mcp.connect(new StreamableHTTPClientTransport(new URL(this.url)))
  }
}
