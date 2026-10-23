import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

export const PROJECT_ROLES = ['viewer', 'developer', 'operator', 'admin'] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

/**
 * Project roles (3.17): admin, operator (plan + apply, approve), developer (plan; apply after an approval), viewer.
 * Changes are immediate (not plan / apply) and audited.
 */
@Entity('lw_project_members')
export class ProjectMemberEntity {
  @PrimaryColumn({ type: 'varchar', length: 63, name: 'project' })
  project!: string;

  @PrimaryColumn({ type: 'varchar', length: 255, name: 'user_id' })
  userId!: string;

  @Column({ type: 'varchar', length: 16, name: 'role' })
  role!: ProjectRole;

  @Column({ type: 'varchar', length: 255, name: 'created_by', nullable: true })
  createdBy!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

/**
 * `developers`: developer plans need an approval; `risky`: also every plan with pins or internet exposure;
 * `everyone`: every plan (four-eyes).
 */
export const APPROVAL_MODES = ['developers', 'risky', 'everyone'] as const;
export type ApprovalMode = (typeof APPROVAL_MODES)[number];

/** Per-project access settings, managed by project admins directly (3.17). */
@Entity('lw_project_settings')
export class ProjectSettingsEntity {
  @PrimaryColumn({ type: 'varchar', length: 63, name: 'project' })
  project!: string;

  @Column({ type: 'varchar', length: 16, name: 'approval_mode', default: 'developers' })
  approvalMode!: ApprovalMode;

  /** Developers may open terminals in the project's replicas (3.19). */
  @Column({ type: 'boolean', name: 'developer_exec', default: false })
  developerExec!: boolean;

  /** Terminal sessions in the project's replicas are recorded (input / output, 3.19); off: metadata only. */
  @Column({ type: 'boolean', name: 'record_terminals', default: false })
  recordTerminals!: boolean;

  /** Who created the project: may assign any project role, like cluster admins. */
  @Column({ type: 'varchar', length: 255, name: 'created_by', nullable: true })
  createdBy!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

/** An approval of exactly one plan for one project (3.17); a re-generated plan is a new plan. */
@Entity('lw_plan_approvals')
export class PlanApprovalEntity {
  @PrimaryColumn({ type: 'uuid', name: 'plan_id' })
  planId!: string;

  @PrimaryColumn({ type: 'varchar', length: 63, name: 'project' })
  project!: string;

  @PrimaryColumn({ type: 'varchar', length: 255, name: 'user_id' })
  userId!: string;

  /** How the approver qualified: a project membership (re-checked at apply) or a cluster-admin session. */
  @Column({ type: 'varchar', length: 16, name: 'via', default: 'member' })
  via!: 'member' | 'cluster-admin';

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

/**
 * The accepting side of a cross-project policy (3.17, like VPC peering): project `peer` accepts the policy of
 * `project` with exactly this spec; a changed policy needs a new acceptance.
 */
@Entity('lw_policy_acceptances')
export class PolicyAcceptanceEntity {
  @PrimaryColumn({ type: 'varchar', length: 63, name: 'project' })
  project!: string;

  @PrimaryColumn({ type: 'varchar', length: 63, name: 'policy' })
  policy!: string;

  @PrimaryColumn({ type: 'varchar', length: 63, name: 'peer' })
  peer!: string;

  @Column({ type: 'varchar', length: 64, name: 'spec_hash' })
  specHash!: string;

  @Column({ type: 'varchar', length: 255, name: 'accepted_by' })
  acceptedBy!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
