import { Span } from '@sentry/node'
import { FunctionStateServerStateResponse } from '@v3rt3p/types/function-state-server'

export type State = FunctionStateServerStateResponse

export interface StateServer {
  getIndependentState(parentSpan: Span): Promise<State>

  getName(): string;

  getState(sessionId: string, metadata: object, parentSpan: Span): Promise<State>;

  initialize(): Promise<void>;
}
