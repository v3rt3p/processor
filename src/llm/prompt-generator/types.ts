import { Functions } from '../function/types'
import { State } from '../state/types'

export interface PromptGenerator {
  generate(functions: Functions): string;
  generateState(state: State): string;
}
