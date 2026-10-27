/** Minimal database contract used by the mining coordinator. */
export interface MiningResult<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta: { changes: number; last_row_id: number };
}
export interface MiningStatement {
  bind(...values: unknown[]): MiningStatement;
  first<T = Record<string, unknown>>(column?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<MiningResult<T>>;
  run(): Promise<MiningResult>;
}
export interface MiningDatabase {
  prepare(sql: string): MiningStatement;
  batch(statements: MiningStatement[]): Promise<MiningResult[]>;
}
