/**
 * DTO for file system node (file or directory).
 */
export class FileNodeDto {
  name!: string;
  type!: 'file' | 'directory';
  path!: string;
  size?: number;
  modifiedAt?: Date;
}
