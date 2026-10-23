export {
  type ColumnRoles,
  type DetectOptions,
  detectRoles,
  halfMinorUnit,
  type IdentityCheck,
  identityHolds,
  proposedRoles,
  type RoleIdentity,
  type TableRoles,
} from "./detect.ts";
export { RoleError, type RoleErrorCode } from "./errors.ts";
export { headerTokens } from "./header.ts";
export { columnCandidates, type Evidence, PROPOSE_AT, type RoleCandidate, type RoleColumn, WEIGHTS } from "./score.ts";
export { loadRoles, type StoredRole, saveRoles } from "./store.ts";
export { maskSample, type RoleTieBreak, TIE_MARGIN, type TieBreakQuestion } from "./tiebreak.ts";
export { isRole, parseRole, ROLES, type Role } from "./vocabulary.ts";
