/** Workspace module barrel: the contract and its local-filesystem implementation. */
export type {
  Workspace,
  WorkspaceChange,
  WorkspaceStat,
  WorkspaceWriteResult,
} from "@harness/workspace/types"
export { createWorkspace } from "@harness/workspace/local"
