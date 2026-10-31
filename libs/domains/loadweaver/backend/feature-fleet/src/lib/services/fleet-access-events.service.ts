import { Injectable } from '@nestjs/common';
import { Subject, type Observable } from 'rxjs';

/**
 * In-process signal that access to a cluster may have changed (grant put / removed, connection changed / removed,
 * read-only grace started / ended). Long-lived relays (sockets) re-check their callers right away instead of
 * waiting for the periodic re-check. Per replica: other replicas catch up with their periodic re-check.
 */
@Injectable()
export class FleetAccessEvents {
  private readonly subject = new Subject<string>();

  get changed(): Observable<string> {
    return this.subject.asObservable();
  }

  accessChanged(clusterId: string): void {
    this.subject.next(clusterId);
  }
}
