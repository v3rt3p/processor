import Handlebars from 'handlebars'
import z from 'zod'

import { Diff } from '../../differ'
import { FunctionInfo } from '../function/types'
import { State } from '../state/types'
import { PromptGenerator } from './types'

export class HandlebarsPromptGenerator implements PromptGenerator {
  private readonly functionsTemplate: HandlebarsTemplateDelegate
  private readonly stateTemplate: HandlebarsTemplateDelegate
  private readonly template: HandlebarsTemplateDelegate

  constructor (rawTemplate: string, rawStateTemplate: string, rawFunctionsTemplate: string) {
    this.template = Handlebars.compile(rawTemplate, {
      noEscape: true
    })
    this.stateTemplate = Handlebars.compile(rawStateTemplate, {
      noEscape: true
    })
    this.functionsTemplate = Handlebars.compile(rawFunctionsTemplate, {
      noEscape: true,
    })
  }

  generate (): string {
    return this.template({})
  }

  generateFunctions (functionsDiff: Diff<FunctionInfo>): string {
    return this.functionsTemplate({
      ...functionsDiff
    }, {
      allowProtoMethodsByDefault: true,
      allowProtoPropertiesByDefault: true,
      helpers: {
        isEmpty: (data: unknown) => Array.isArray(data)
          ? data.length === 0
          : (typeof data === 'object' ? Object.keys(data as object).length === 0 : false),
        schemaToJson: (data: z.ZodSchema) => JSON.stringify({
          ...data.toJSONSchema(),
          $schema: undefined
        })
      }
    })
  }

  generateState (stateDiff: Diff<State[string]>): string {
    return this.stateTemplate({
      ...stateDiff
    }, {
      allowProtoMethodsByDefault: true,
      allowProtoPropertiesByDefault: true,
      helpers: {
        isEmpty: (data: unknown) => Array.isArray(data)
          ? data.length === 0
          : (typeof data === 'object' ? Object.keys(data as object).length === 0 : false)
      }
    })
  }
}
