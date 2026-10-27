import Handlebars from 'handlebars'

import { Functions } from '../function/types'
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
      noEscape: true
    })
  }

  generate (): string {
    return this.template({})
  }

  generateFunctions (functions: Functions): string {
    return this.functionsTemplate({
      functionsText: `${this.getFunctionsText(functions)}`
    })
  }

  generateState (state: State): string {
    return this.stateTemplate({
      stateText: this.getStateText(state)
    })
  }

  private getFunctionsText (functions: Functions): string {
    let text = ''
    for (const [name, functionInfo] of Object.entries(functions)) {
      text += `${name} (${functionInfo.description}): has response: ${functionInfo.hasResponse}, JSON schema: ${JSON.stringify(functionInfo.argumentsSchema.toJSONSchema())}\n`
    }
    return text
  }

  private getStateText (state: State): string {
    let text = ''
    for (const [name, entry] of Object.entries(state)) {
      text += `${name} (${entry.description}): ${entry.value}\n`
    }
    return text.trim()
  }
}
