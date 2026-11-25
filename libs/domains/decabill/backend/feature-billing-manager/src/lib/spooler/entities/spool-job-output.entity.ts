import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * Output file of a finished spool job (download target). Kept apart from the job row so listings never load file
 * bytes; removed with the job after the retention period.
 */
@Entity('billing_spool_job_outputs')
export class SpoolJobOutputEntity {
  @PrimaryColumn('uuid', { name: 'job_id' })
  jobId!: string;

  @Column({ type: 'bytea', name: 'content' })
  content!: Buffer;
}
