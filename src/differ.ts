export interface Diff<T> {
  added: Record<string, T>
  changed: Record<string, T>
  removed: string[]
}

export class Differ<T> {
  private readonly cache: Map<string, T> = new Map()

  constructor (private readonly valueGetter: (data: T) => string) {}

  addNewData (data: Record<string, T>): Diff<T> {
    const stateDiff: Diff<T> = {
      added: {},
      changed: {},
      removed: []
    }

    for (const key of this.cache.keys()) {
      if (!(key in data)) {
        stateDiff.removed.push(key)
      }
    }

    for (const [key, value] of Object.entries(data)) {
      const current = this.cache.get(key)

      if (current === undefined) {
        stateDiff.added[key] = value
        this.cache.set(key, value)
      } else {
        if (this.valueGetter(current) !== this.valueGetter(value)) {
          stateDiff.changed[key] = value
        }
      }
    }

    return stateDiff
  }

  getAll (): Record<string, T> {
    return Object.fromEntries(this.cache.entries())
  }
}

export function isDiffEmpty (diff: Diff<unknown>): boolean {
  return Object.keys(diff.added).length === 0 && Object.keys(diff.changed).length === 0 && diff.removed.length === 0
}

export function mergeDiffs<T> (a: Diff<T>, b: Diff<T>): Diff<T> {
  return {
    added: {
      ...a.added,
      ...b.added
    },
    changed: {
      ...a.changed,
      ...b.changed
    },
    removed: [...new Set([...a.removed, ...b.removed])]
  }
}
