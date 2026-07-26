/**
 * The workspace contract: what a runtime's file tree offers its tools.
 *
 * Kept apart from the local implementation because the guarantees below are the
 * stable part. `local.ts` states how they are met on a real filesystem; another
 * backing — an in-memory tree, a sandboxed root — would meet the same contract
 * differently, and callers would not notice.
 */

/** What the workspace reports about a path. Absent means the path does not exist. */
export type WorkspaceStat = {
  readonly bytes: number
  readonly isFile: boolean
}

/** The outcome of a write: whether the file was new, and how big it now is. */
export type WorkspaceWriteResult = {
  readonly created: boolean
  readonly bytes: number
}

/**
 * A mutation's decision: the file's new text, plus whatever the caller wants
 * back. Returning is what commits — throwing from the change function leaves
 * the file untouched.
 */
export type WorkspaceChange<T> = {
  readonly text: string
  readonly result: T
}

export type Workspace = {
  /** The absolute directory that relative paths resolve against. */
  readonly root: string
  /** Resolves a caller-supplied path against the root. Absolute paths pass through. */
  resolve(input: string): string
  /** The path relative to the root — for output and display, never for access. */
  relative(target: string): string
  /** Size and kind of a path, or undefined if it does not exist. */
  stat(target: string): Promise<WorkspaceStat | undefined>
  /** Reads a file as UTF-8 text. */
  readText(target: string): Promise<string>
  /** The files in a directory as absolute paths; `recursive` walks subdirectories. */
  listFiles(directory: string, options?: { recursive?: boolean }): Promise<string[]>
  /** Replaces a file's contents, creating parent directories as needed. */
  write(target: string, content: string): Promise<WorkspaceWriteResult>
  /**
   * Reads a file, hands its text to `change`, and writes back what that returns
   * — with the whole cycle exclusive for this path. The current text is never
   * exposed outside the callback, so there is no window in which a caller could
   * act on a value another mutation has already replaced.
   */
  mutate<T>(target: string, change: (current: string) => WorkspaceChange<T> | Promise<WorkspaceChange<T>>): Promise<T>
}
