/** Session module barrel: the aggregate (single writer) and the persistence contract. */
export { Sessions } from "@agent-core/session/sessions"
export {
  createSessionPersistence,
  FileSessionPersistence,
  MemorySessionPersistence,
  type SessionPersistence,
  type SessionPersistenceConfig,
  type SessionPersistenceType,
} from "@agent-core/session/persistence"
