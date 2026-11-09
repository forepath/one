import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { InitiativeRunEntity } from './initiative-run.entity';

export type InitiativeRunTurnRole = 'user' | 'agent' | 'system';

/** Conversation of a step run (hidden sessions keep no chat history of their own). */
@Entity('initiative_run_turns')
@Index('UQ_initiative_run_turns_run_seq', ['runId', 'seq'], { unique: true })
export class InitiativeRunTurnEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'run_id' })
  runId!: string;

  @ManyToOne(() => InitiativeRunEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'run_id' })
  run?: InitiativeRunEntity;

  @Column({ type: 'int', name: 'seq' })
  seq!: number;

  @Column({ type: 'varchar', length: 8, name: 'role' })
  role!: InitiativeRunTurnRole;

  @Column({ type: 'text', name: 'content' })
  content!: string;

  @Column({ type: 'uuid', name: 'actor_user_id', nullable: true })
  actorUserId?: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
