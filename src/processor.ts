import { continueTrace, Span, startInactiveSpan, startSpan } from '@sentry/node'
import { JSONParser } from '@streamparser/json'
import { Directive } from '@v3rt3p/types/directives'
import { processorClientWebSocketMessage, ProcessorServerWebSocketMessage } from '@v3rt3p/types/processor'
import { Sema } from 'async-sema'
import { LRUCache } from 'lru-cache'
import { randomUUID } from 'node:crypto'
import { OpenAI } from 'openai'
import { WebSocket } from 'ws'
import z from 'zod'

import { DirectiveFunctionServer } from './llm/function/directive'
import { FunctionCall, FunctionInfo, Functions, FunctionServer } from './llm/function/types'
import { PromptGenerator } from './llm/prompt-generator/types'
import { State, StateServer } from './llm/state/types'
import {
  LLMMessage
} from './llm/types'
import { getLogger } from './logger'
import { NlpServiceClient } from './nlp/client'
import { SessionStorage } from './session-storage/types'

const logger = getLogger()

type ExtendedFunctionInfo = FunctionInfo & {
  server: FunctionServer
}

type ExtendedFunctions = Record<string, ExtendedFunctionInfo>

interface ProcessorParameters {
  cacheSize: number;
  functionServers: FunctionServer[];
  model: string;
  nlpService: NlpServiceClient;
  openAI: OpenAI;
  promptGenerator: PromptGenerator;
  sessionStorage: SessionStorage<LLMMessage[]>;
  stateServers: StateServer[];
}

const functionCallType = z.object({
  args: z.unknown().optional(),
  name: z.string(),
  schedule: z.string().optional()
})

interface StructuredResponse {
  canCache: boolean
  functionCalls: FunctionCall[]
  requireMoreInput: boolean
  text: string
}

const llmResponseType = z.object({
  can_cache: z.boolean().optional(),
  continue_dialog: z.boolean().optional(),
  function_calls: z.array(functionCallType).optional(),
  text: z.string().optional()
})

const scheduleTimeRegexes: { coefficient: number; regex: RegExp, }[] = [
  {
    coefficient: 1, regex: /^(?<value>[.\d]+)ms$/
  },
  {
    coefficient: 1000, regex: /^(?<value>[.\d]+)s$/
  },
  {
    coefficient: 60 * 1000, regex: /^(?<value>[.\d]+)m$/
  },
  {
    coefficient: 60 * 60 * 1000, regex: /^(?<value>[.\d]+)h$/
  },
  {
    coefficient: 24 * 60 * 60 * 1000, regex: /^(?<value>[.\d]+)d$/
  },
]

interface SentryContext {
  baggage: string | undefined,
  sentryTrace: string | undefined
}

export class Processor {
  private readonly cache: LRUCache<string, string>
  private readonly logger = getLogger<Processor>()

  constructor (private readonly parameters: ProcessorParameters) {
    this.cache = new LRUCache({
      max: parameters.cacheSize
    })
  }

  async openSession (webSocket: WebSocket, sentryContext: SentryContext): Promise<Promise<void>> {
    const span = continueTrace(sentryContext, () => {
      return startInactiveSpan({
        name: 'Processor processing',
        op: 'processor'
      })
    })

    const lock = new Sema(1)
    const messages: LLMMessage[] = []
    const sessionId = randomUUID()
    let isFirstRequest = true
    let functions: ExtendedFunctions

    async function send (message: ProcessorServerWebSocketMessage): Promise<void> {
      return new Promise<void>((resolve, reject) => webSocket.send(JSON.stringify(message), (error) => {
        if (error) {
          reject(error)
        } else {
          resolve()
        }
      }))
    }

    webSocket.addEventListener('error', error => {
      this.logger.info(`WebSocket session error: ${error.error}`)
    })
    webSocket.addEventListener('close', error => {
      this.logger.info(`WebSocket session error: ${error.code}`)
      span.end()
    })
    webSocket.addEventListener('message', async message => {
      await lock.acquire()
      try {
        const decodedData = processorClientWebSocketMessage.parse(JSON.parse(message.data.toString()))

        switch (decodedData.type) {
          case 'prepare': {
            this.logger.info(`Session ${sessionId} prepare`)
            await startSpan({
              name: 'Processor preparing',
              op: 'prepare',
              parentSpan: span
            }, async prepareSpan => {
              functions = await this.getFunctions(prepareSpan)
              messages.push({
                content: this.parameters.promptGenerator.generate(functions),
                role: 'system'
              })

              const state = await this.getIndependentState(sessionId, prepareSpan)
              messages.push({
                content: this.parameters.promptGenerator.generateState(state),
                role: 'system'
              })
            })
            break
          }
          case 'process': {
            const request = decodedData.data

            this.logger.info(`Session ${sessionId} process: ${JSON.stringify(request)}`)
            await startSpan({
              name: 'Processor processing request',
              op: 'process',
              parentSpan: span
            }, async processSpan => {
              const state = await this.getState(sessionId, decodedData.data.metadata, processSpan)
              messages.push({
                content: this.parameters.promptGenerator.generateState(state),
                role: 'system'
              })

              const text = request.text.trim()

              if (!request.isExternalEvent) {
                const nlpResult = await this.parameters.nlpService.parse(text, functions, request.metadata, sessionId)
                if (nlpResult?.kind === 'response') {
                  isFirstRequest = false
                  await send({
                    data: {
                      directives: [],
                      finished: true,
                      shouldListen: false,
                      text: nlpResult.text
                    },
                    type: 'partialResponse'
                  })
                  webSocket.close()
                  return
                }
                if (nlpResult?.kind === 'function_calls' && nlpResult.functionCalls.length > 0) {
                  const [directives, noResponsePromises, responsePromises] = await this.callFunctions(
                    sessionId,
                    request.metadata,
                    functions,
                    nlpResult.functionCalls,
                    processSpan
                  )
                  await Promise.all(noResponsePromises).catch(error => this.logger.warn('Failed to call NLP functions: ', error))
                  const resultText = (await Promise.all(responsePromises))
                    .map(([function_, value]) => `${function_}: ${value}`)
                    .join('\\n')
                  await send({
                    data: {
                      directives,
                      ...(responsePromises.length === 0
                        ? { finished: true, shouldListen: false }
                        : { finished: false }),
                      text: resultText
                    },
                    type: 'partialResponse'
                  })
                  if (responsePromises.length === 0) webSocket.close()
                  return
                }
              }

              if (request.isExternalEvent) {
                messages.push({
                  content: `External event happened: '${text}'`,
                  role: 'system'
                })
              } else {
                messages.push({
                  content: text,
                  role: 'user'
                })
              }

              while (true) {
                if (!await startSpan({
                  name: 'Single agent operation',
                  op: 'single-agent-operation',
                  parentSpan: processSpan
                }, async singleOperationSpan => {
                  this.logger.info(`Processing ${messages.length} messages`)

                  const directives: Directive[] = []
                  const hasResponsePromises: Promise<[string, string]>[] = []
                  const noResponsePromises: Promise<void>[] = []

                  let responseContent: string = ''
                  let structuredResponse: StructuredResponse

                  const cachedResponse = this.cache.get(text)

                  if (isFirstRequest && cachedResponse) {
                    responseContent = cachedResponse
                    this.logger.info(`Received answer from cache: ${responseContent}`)

                    structuredResponse = parseLLMResponse(JSON.parse(responseContent))

                    const [newDirectives, functionsPromises, functionsWithResponsePromises] =
                      await this.callFunctions(sessionId, request.metadata, functions,
                        structuredResponse.functionCalls, singleOperationSpan)

                    directives.push(...newDirectives)
                    hasResponsePromises.push(...functionsWithResponsePromises)
                    noResponsePromises.push(...functionsPromises)
                  } else {
                    this.logger.info('Querying LLM')
                    const callFunctionsPromises: Promise<[Directive[], Promise<void>,
                      Promise<[string, string]>]>[] = []

                    const jsonParser = new JSONParser()
                    jsonParser.onValue = async (value) => {
                      if (value.stack.length === 2 && value.stack[0]?.key === undefined &&
                        value.stack[1]?.key === 'function_calls' && typeof value.key === 'number') {
                        this.logger.info(`Found function call: ${JSON.stringify(value.value)}`)
                        try {
                          const parsed = parseFunctionCall(value.value)
                          if (!parsed) {
                            throw new Error('empty')
                          }
                          const [newDirectives, functionsPromises, functionsWithResponsePromises] =
                          await this.callFunctions(sessionId, request.metadata, functions,
                            [parsed], singleOperationSpan)

                          directives.push(...newDirectives)
                          hasResponsePromises.push(...functionsWithResponsePromises)
                          noResponsePromises.push(...functionsPromises)
                        } catch (error) {
                          this.logger.warn('Failed to parse function call: ', error)
                        }
                      }
                    }

                    let firstWasPrint = false

                    const beforeTime = new Date()
                    const llmCompletionsFullSpan = startInactiveSpan({
                      name: 'LLM full processing',
                      op: 'llm-full',
                      parentSpan: singleOperationSpan
                    })
                    const llmTTFTSpan = startInactiveSpan({
                      name: 'LLM TTFT',
                      op: 'llm-ttft',
                      parentSpan: llmCompletionsFullSpan
                    })

                    const response = await this.parameters.openAI.chat.completions.create({
                      messages,
                      model: this.parameters.model,
                      stream: true
                    })

                    for await (const chunk of response) {
                      if (!firstWasPrint) {
                        logger.info(`TTFT: ${Date.now() - beforeTime.getTime()}ms`)
                        llmTTFTSpan.end()
                        firstWasPrint = true
                      }
                      const part = chunk.choices[0]?.delta?.content
                      if (!part) {
                        continue
                      }
                      responseContent += part
                      jsonParser.write(part)
                    }
                    logger.info(`Full query time: ${Date.now() - beforeTime.getTime()}ms`)
                    llmCompletionsFullSpan.end()

                    const result = await Promise.all(callFunctionsPromises)

                    for (const part of result) {
                      directives.push(...part[0])
                      part[1].catch(error => this.logger.error('Failed to call functions: ', error))
                    }

                    this.logger.info(`Received answer from LLM: '${responseContent}'`)

                    structuredResponse = parseLLMResponse(JSON.parse(responseContent))
                  }

                  Promise.all(noResponsePromises).catch(error => this.logger.warn(`Failed to call no-response functions: ${error}`))

                  messages.push({
                    content: responseContent,
                    role: 'assistant'
                  })

                  if (!structuredResponse.requireMoreInput && structuredResponse.canCache &&
                    isFirstRequest && hasResponsePromises.length === 0) {
                    this.cache.set(text, responseContent)
                    this.logger.info(`Saved answer to cache: '${text}' -> ${responseContent}`)
                  }

                  isFirstRequest = false

                  await send({
                    data: {
                      directives,
                      finished: hasResponsePromises.length === 0,
                      shouldListen: structuredResponse.requireMoreInput,
                      text: structuredResponse.text
                    },
                    type: 'partialResponse'
                  })

                  if (hasResponsePromises.length === 0) {
                    if (!structuredResponse.requireMoreInput) {
                      webSocket.close()
                    }
                    return false
                  }

                  const result = await Promise.all(hasResponsePromises)
                  let toolCallResult = ''
                  for (const [function_, value] of result) {
                    toolCallResult += `${function_}: ${value}\n`
                  }

                  messages.push({
                    content: toolCallResult,
                    role: 'system'
                  })

                  return true
                })) {
                  break
                }
              }
            })
          }
        }
      } catch (error) {
        logger.error('Failed on WebSocket message handling: ', error)
      } finally {
        lock.release()
      }
    })
  }

  private async callFunctions (sessionId: string, metadata: object, functions: ExtendedFunctions,
    functionCalls: FunctionCall[], parentSpan: Span): Promise<[Directive[], Promise<void>[],
      Promise<[string, string]>[]]> {
    const directives: Directive[] = []

    const noResponsePromises: Promise<void>[] = []
    const hasResponsePromises: Promise<[string, string]>[] = []

    for (const call of functionCalls) {
      const function_ = functions[call.name]
      if (!function_) {
        this.logger.warn(`Tried to call non-existent function '${call.name}'`)
        continue
      }

      if (function_.server instanceof DirectiveFunctionServer) {
        const directive = await function_.server.callDirectiveFunction(sessionId, metadata,
          call.name, call.arguments, parentSpan)
        if (!directive) {
          continue
        }
        directives.push(directive)
        continue
      }

      if (function_.hasResponse && call.schedule) {
        this.logger.warn(`Tried to call function with resposing using schedule: '${call.schedule}'`)
        continue
      }

      if (function_.hasResponse) {
        hasResponsePromises.push((async () => {
          try {
            const arguments_ = function_.argumentsSchema.safeParse(call.arguments)
            if (!arguments_.success) {
              this.logger.warn(`Failed to parse arguments: '${call.name}' '${JSON.stringify(call.arguments)}' '${JSON.stringify(arguments_.error.issues)}'`)
              return [call.name, `Arguments parse error: ${JSON.stringify(arguments_.error.issues)}`]
            }
            return [call.name, await function_.server.callFunction(sessionId, metadata, call.name,
              arguments_.data, parentSpan)]
          } catch (error) {
            this.logger.warn(`Failed to call function '${call.name}' with parameters ${JSON.stringify(call.arguments)}: `, error)
            return [call.name, `Error: ${error}`]
          }
        })())
      } else {
        noResponsePromises.push((async () => {
          try {
            const arguments_ = function_.argumentsSchema.safeParse(call.arguments)
            if (!arguments_.success) {
              this.logger.warn(`Failed to parse arguments: '${call.name}' '${JSON.stringify(call.arguments)}' '${JSON.stringify(arguments_.error.issues)}'`)
              return
            }
            if (call.schedule) {
              this.logger.info(`Calling ${call.name} with ${JSON.stringify(arguments_.data)} after ${call.schedule} milliseconds`)
              await new Promise(resolve => setTimeout(resolve, call.schedule))
            }
            await function_.server.callFunction(sessionId, metadata, call.name, arguments_.data ?? {}, parentSpan)
          } catch (error) {
            this.logger.warn(`Failed to call function '${call.name}' with parameters ${JSON.stringify(call.arguments)}: `, error)
          }
        })())
      }
    }

    return [directives, noResponsePromises, hasResponsePromises]
  }

  private async getFunctions (parentSpan: Span): Promise<ExtendedFunctions> {
    return startSpan({
      name: 'Requesting functions',
      op: 'get-functions',
      parentSpan
    }, async span => {
      const promises: Promise<[FunctionServer, Functions, undefined | unknown]>[] = []
      for (const server of this.parameters.functionServers) {
        promises.push((async () => {
          try {
            const functions = await server.getFunctions(span)
            return [server, functions, undefined]
          } catch (error) {
            return [server, {}, error]
          }
        })())
      }
      const resultFunctions: ExtendedFunctions = {}
      const results = await Promise.all(promises)
      for (const [server, state, error] of results) {
        if (error) {
          this.logger.warn(`Function server ${server.getName()} returned error while fetching functions: `, error)
          continue
        }
        for (const [key, functionInfo] of Object.entries(state)) {
          if (resultFunctions[key]) {
            this.logger.warn(`Function server ${server.getName()} returned duplicate function entry '${key}'`)
            continue
          }
          resultFunctions[key] = {
            ...functionInfo,
            server
          }
        }
      }
      return resultFunctions
    })
  }

  private async getIndependentState (sessionId: string, parentSpan: Span): Promise<State> {
    return startSpan({
      name: 'Requesting independent state',
      op: 'get-independent-state',
      parentSpan
    }, async (span) => {
      const promises: Promise<[StateServer, State, undefined | unknown]>[] = []
      for (const server of this.parameters.stateServers) {
        promises.push((async () => {
          try {
            const state = await server.getIndependentState(sessionId, span)
            return [server, state, undefined]
          } catch (error) {
            return [server, {}, error]
          }
        })())
      }
      const resultState: State = {}
      const results = await Promise.all(promises)
      for (const [server, state, error] of results) {
        if (error) {
          this.logger.warn(`State server ${server.getName()} returned error: `, error)
          continue
        }
        for (const [key, stateEntry] of Object.entries(state)) {
          if (resultState[key]) {
            this.logger.warn(`State server ${server.getName()} returned duplicate state entry '${key}'`)
            continue
          }
          resultState[key] = stateEntry
        }
      }
      return resultState
    })
  }

  private async getState (sessionId: string, metadata: object, parentSpan: Span): Promise<State> {
    return startSpan({
      name: 'Requesting state',
      op: 'get-state',
      parentSpan
    }, async span => {
      const promises: Promise<[StateServer, State, undefined | unknown]>[] = []
      for (const server of this.parameters.stateServers) {
        promises.push((async () => {
          try {
            const state = await server.getState(sessionId, metadata, span)
            return [server, state, undefined]
          } catch (error) {
            return [server, {}, error]
          }
        })())
      }
      const resultState: State = {}
      const results = await Promise.all(promises)
      for (const [server, state, error] of results) {
        if (error) {
          this.logger.warn(`State server ${server.getName()} returned error: `, error)
          continue
        }
        for (const [key, stateEntry] of Object.entries(state)) {
          if (resultState[key]) {
            this.logger.warn(`State server ${server.getName()} returned duplicate state entry '${key}'`)
            continue
          }
          resultState[key] = stateEntry
        }
      }
      return resultState
    })
  }
}

function parseFunctionCall (rawCall: unknown): FunctionCall | null {
  const call = functionCallType.parse(rawCall)
  return {
    arguments: call.args ?? null,
    name: call.name,
    ...(call.schedule
      ? {
          schedule: parseSchedule(call.schedule)
        }
      : {})
  }
}

function parseLLMResponse (rawResponse: unknown): StructuredResponse {
  const response = llmResponseType.parse(rawResponse)
  return {
    canCache: response.can_cache ?? false,
    functionCalls: response.function_calls?.map(call => parseFunctionCall(call))?.filter(item => item !== null) ?? [],
    requireMoreInput: response.continue_dialog ?? false,
    text: response.text ?? ''
  }
}

function parseSchedule (schedule: string): number {
  const parts = schedule.split(' ').filter(Boolean)
  let result = 0
  for (const part of parts) {
    let matched = false
    for (const { coefficient, regex } of scheduleTimeRegexes) {
      const match = part.match(regex)
      if (!match) {
        continue
      }
      matched = true
      result += coefficient * Number.parseFloat(match.groups?.value ?? '0')
    }
    if (!matched) {
      logger.warn(`Failed to parse 'schedule' part from LLM: '${part}'`)
    }
  }
  return result
}
