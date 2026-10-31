import { BadRequestException, PipeTransform } from '@nestjs/common';

const NAME = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/** Validates a resource / node name path parameter (RFC 1123 label). */
export class NodeNamePipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (typeof value !== 'string' || !NAME.test(value)) throw new BadRequestException('invalid name');

    return value;
  }
}
