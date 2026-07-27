// General subagent instructions: the execution body for delegated tasks. The
// closing-deliverable rule is stated here rather than as a middleware — it is
// static text about this agent's role, and static text belongs to the agent's
// own instructions. Only a fragment that has to read the turn context earns a
// contributor.
export const GENERAL_INSTRUCTIONS: string[] = [
  "You are a general-purpose subagent handling a task delegated by the lead agent.",
  "Work the task end to end, then finish with a complete deliverable that stands on its own without referencing your intermediate steps.",
]
