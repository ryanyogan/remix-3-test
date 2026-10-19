import { Database, getTablePrimaryKey, type DatabaseOptions } from 'remix/data-table'
import type {
  DataManipulationOperation,
  DataManipulationRequest,
  DataManipulationResult,
  DatabaseDriver,
  SqlStatement,
  TableRef,
  TransactionToken,
} from 'remix/data-table'

import { compileSqliteOperation } from './sqlite-compiler.ts'

// The slice of the Workers D1 binding this driver uses, so it typechecks without Workers types.
export interface D1Like {
  prepare(sql: string): D1StatementLike
  batch(statements: D1StatementLike[]): Promise<unknown[]>
  exec(sql: string): Promise<unknown>
}

export interface D1StatementLike {
  bind(...values: unknown[]): D1StatementLike
  all(): Promise<{ results: Record<string, unknown>[]; meta: D1Meta }>
  run(): Promise<{ meta: D1Meta }>
}

interface D1Meta {
  changes?: number
  last_row_id?: number
}

const d1Capabilities = Object.freeze({
  returning: true,
  // D1 rejects BEGIN/SAVEPOINT; transactions are emulated with an atomic batch() instead.
  savepoints: false,
  upsert: true,
  transactionalDdl: false,
  migrationLock: false,
})

// D1 does not allow interactive transactions. Inside `db.transaction()`, writes are queued and
// committed together with one atomic `batch()`, and a thrown callback discards them. Reads run
// immediately and see the database as it was before the transaction, and writes that need a
// result back (`returning`) are rejected, since nothing has been written yet.
export class D1DatabaseDriver implements DatabaseDriver<'sqlite'> {
  get dialect(): 'sqlite' {
    return 'sqlite'
  }

  get capabilities() {
    return d1Capabilities
  }

  #d1: D1Like
  #transactions = new Map<string, D1StatementLike[]>()
  #transactionCounter = 0

  constructor(d1: D1Like) {
    this.#d1 = d1
  }

  compileSql(operation: DataManipulationOperation): SqlStatement[] {
    let compiled = compileSqliteOperation(operation)
    return [{ text: compiled.text, values: compiled.values }]
  }

  async execute(request: DataManipulationRequest): Promise<DataManipulationResult> {
    let { operation } = request

    if (operation.kind === 'insertMany' && operation.values.length === 0) {
      return { affectedRows: 0, insertId: undefined, rows: operation.returning ? [] : undefined }
    }

    let statement = this.compileSql(operation)[0]
    let prepared = this.#d1.prepare(statement.text).bind(...normalizeValues(statement.values))

    if (request.transaction && isWrite(operation)) {
      if ('returning' in operation && operation.returning !== undefined) {
        throw new Error('D1 transactions cannot return rows from writes; they commit as a batch')
      }
      this.#queue(request.transaction).push(prepared)
      return { affectedRows: undefined, insertId: undefined }
    }

    if (readsRows(operation)) {
      let { results } = await prepared.all()
      let rows = results.map((row) => ({ ...row }))
      if (operation.kind === 'count' || operation.kind === 'exists') rows = normalizeCounts(rows)

      return {
        rows,
        affectedRows: isWrite(operation) ? rows.length : undefined,
        insertId: isInsert(operation) ? insertIdFromRows(operation, rows) : undefined,
      }
    }

    let { meta } = await prepared.run()
    return {
      affectedRows: meta.changes ?? 0,
      insertId: isInsert(operation) && singlePrimaryKey(operation) ? meta.last_row_id : undefined,
    }
  }

  async executeScript(sql: string, transaction?: TransactionToken): Promise<void> {
    if (transaction) {
      throw new Error('D1 cannot run scripts inside a transaction')
    }
    await this.#d1.exec(sql)
  }

  async hasTable(table: TableRef): Promise<boolean> {
    let { results } = await this.#d1
      .prepare("select 1 from sqlite_master where type = 'table' and name = ? limit 1")
      .bind(table.name)
      .all()
    return results.length > 0
  }

  async hasColumn(table: TableRef, column: string): Promise<boolean> {
    let { results } = await this.#d1
      .prepare('pragma table_info(' + quoteIdentifier(table.name) + ')')
      .all()
    return results.some((row) => row.name === column)
  }

  async beginTransaction(): Promise<TransactionToken> {
    this.#transactionCounter += 1
    let token = { id: 'tx_' + String(this.#transactionCounter) }
    this.#transactions.set(token.id, [])
    return token
  }

  async commitTransaction(token: TransactionToken): Promise<void> {
    let statements = this.#queue(token)
    this.#transactions.delete(token.id)
    if (statements.length > 0) await this.#d1.batch(statements)
  }

  async rollbackTransaction(token: TransactionToken): Promise<void> {
    this.#queue(token)
    this.#transactions.delete(token.id)
  }

  async createSavepoint(): Promise<void> {
    throw new Error('D1 does not support savepoints')
  }

  async rollbackToSavepoint(): Promise<void> {
    throw new Error('D1 does not support savepoints')
  }

  async releaseSavepoint(): Promise<void> {
    throw new Error('D1 does not support savepoints')
  }

  async wipe(): Promise<void> {
    throw new Error('Wipe a D1 database with `cf d1` commands, not from the Worker')
  }

  close(): void {}

  #queue(token: TransactionToken): D1StatementLike[] {
    let statements = this.#transactions.get(token.id)
    if (!statements) throw new Error('Unknown transaction token: ' + token.id)
    return statements
  }
}

/** A {@link Database} backed by a Cloudflare D1 binding. */
export function createD1Database(d1: D1Like, options: DatabaseOptions = {}): Database<'sqlite'> {
  return new Database(new D1DatabaseDriver(d1), options)
}

type Operation = DataManipulationRequest['operation']

function isWrite(operation: Operation): boolean {
  return (
    operation.kind === 'insert' ||
    operation.kind === 'insertMany' ||
    operation.kind === 'update' ||
    operation.kind === 'delete' ||
    operation.kind === 'upsert' ||
    (operation.kind === 'raw' && !looksLikeRead(operation.sql.text))
  )
}

function isInsert(
  operation: Operation,
): operation is Extract<Operation, { kind: 'insert' | 'insertMany' | 'upsert' }> {
  return operation.kind === 'insert' || operation.kind === 'insertMany' || operation.kind === 'upsert'
}

function readsRows(operation: Operation): boolean {
  if (operation.kind === 'select' || operation.kind === 'count' || operation.kind === 'exists') {
    return true
  }
  if (operation.kind === 'raw') return looksLikeRead(operation.sql.text)
  return operation.returning !== undefined
}

// Raw statements carry no kind, so read their verb (and any RETURNING clause).
function looksLikeRead(sql: string): boolean {
  return /^\s*(select|with|pragma|values|explain)\b/i.test(sql) || /\breturning\b/i.test(sql)
}

function singlePrimaryKey(operation: Extract<Operation, { kind: 'insert' | 'insertMany' | 'upsert' }>) {
  return getPrimaryKey(operation).length === 1
}

function insertIdFromRows(
  operation: Extract<Operation, { kind: 'insert' | 'insertMany' | 'upsert' }>,
  rows: Record<string, unknown>[],
): unknown {
  let primaryKey = getPrimaryKey(operation)
  if (primaryKey.length !== 1) return undefined
  return rows[rows.length - 1]?.[primaryKey[0]]
}

function getPrimaryKey(operation: Extract<Operation, { kind: 'insert' | 'insertMany' | 'upsert' }>) {
  return getTablePrimaryKey(operation.table)
}

// D1 binds null, numbers, strings, and ArrayBuffers; normalize the rest.
function normalizeValues(values: unknown[]): unknown[] {
  return values.map((value) => {
    if (value === undefined) return null
    if (typeof value === 'boolean') return value ? 1 : 0
    if (typeof value === 'bigint') return Number(value)
    if (value instanceof Date) return value.getTime()
    return value
  })
}

function normalizeCounts(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((row) => {
    let count = row.count
    if (typeof count === 'string' && !Number.isNaN(Number(count))) return { ...row, count: Number(count) }
    if (typeof count === 'bigint') return { ...row, count: Number(count) }
    return row
  })
}

function quoteIdentifier(value: string): string {
  return '"' + value.replace(/"/g, '""') + '"'
}
