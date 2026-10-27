import { Span } from '@sentry/node'
import z from 'zod'

export interface FunctionCall {
  arguments: unknown;
  name: string;
  schedule?: number;
}

export interface FunctionInfo<T = unknown> {
  argumentsSchema: z.ZodSchema<T>;
  description: string;
  hasResponse: boolean;
}

export type Functions = Record<string, FunctionInfo>

export interface FunctionServer {
  callFunction(sessionId: string, metadata: object, functionName: string,
    parameters: unknown, parentSpan: Span): Promise<string>;

  getFunctions(sessionId: string, metadata: object, parentSpan: Span): Promise<Functions>;

  getIndependentFunctions(parentSpan: Span): Promise<Functions>;

  getName(): string;

  initialize(): Promise<void>;
}
