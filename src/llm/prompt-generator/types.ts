import { Diff } from '../../differ'
import { FunctionInfo } from '../function/types'
import { State } from '../state/types'

export interface PromptGenerator {
  generate(): string;
  generateFunctions(functionsDiff: Diff<FunctionInfo>): string;
  generateState(stateDiff: Diff<State[string]>): string;
}
