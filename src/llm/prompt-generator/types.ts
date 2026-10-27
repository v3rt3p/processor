import { Functions } from '../function/types'
import { State } from '../state/types'

export interface PromptGenerator {
  generate(): string;
  generateFunctions(functions: Functions): string;
  generateState(state: State): string;
}
