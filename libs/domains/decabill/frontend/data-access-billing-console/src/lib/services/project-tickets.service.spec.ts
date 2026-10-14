import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ENVIRONMENT } from '@forepath/decabill/frontend/util-configuration';

import { ProjectTicketsService } from './project-tickets.service';

describe('ProjectTicketsService', () => {
  let service: ProjectTicketsService;
  let httpMock: HttpTestingController;
  const apiUrl = 'http://localhost:3200/api';

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        {
          provide: ENVIRONMENT,
          useValue: {
            billing: {
              urls: {
                restApi: apiUrl,
              },
            },
          },
        },
      ],
    });
    service = TestBed.inject(ProjectTicketsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('listAttachments should GET project ticket attachments', (done) => {
    const attachment = attachmentFixture();

    service.listAttachments('project-1', 'ticket-1').subscribe((rows) => {
      expect(rows).toEqual([attachment]);
      done();
    });
    const req = httpMock.expectOne(`${apiUrl}/projects/project-1/tickets/ticket-1/attachments`);

    expect(req.request.method).toBe('GET');
    req.flush([attachment]);
  });

  it('uploadAttachment should POST multipart form data', (done) => {
    const attachment = attachmentFixture();
    const file = new File(['hello'], 'brief.txt', { type: 'text/plain' });

    service.uploadAttachment('project-1', 'ticket-1', file).subscribe((row) => {
      expect(row).toEqual(attachment);
      done();
    });
    const req = httpMock.expectOne(`${apiUrl}/projects/project-1/tickets/ticket-1/attachments`);

    expect(req.request.method).toBe('POST');
    expect(req.request.body instanceof FormData).toBe(true);
    req.flush(attachment);
  });

  it('downloadAttachment should GET project ticket attachment as blob', (done) => {
    service.downloadAttachment('project-1', 'ticket-1', 'att-1').subscribe((blob) => {
      expect(blob.size).toBe(5);
      done();
    });
    const req = httpMock.expectOne(`${apiUrl}/projects/project-1/tickets/ticket-1/attachments/att-1/download`);

    expect(req.request.method).toBe('GET');
    expect(req.request.responseType).toBe('blob');
    req.flush(new Blob(['hello']));
  });

  it('deleteAttachment should DELETE project ticket attachment metadata', (done) => {
    service.deleteAttachment('project-1', 'ticket-1', 'att-1').subscribe(() => done());
    const req = httpMock.expectOne(`${apiUrl}/projects/project-1/tickets/ticket-1/attachments/att-1`);

    expect(req.request.method).toBe('DELETE');
    req.flush(null);
  });
});

function attachmentFixture() {
  return {
    id: 'att-1',
    ticketId: 'ticket-1',
    fileName: 'brief.txt',
    contentType: 'text/plain',
    byteSize: 5,
    downloadUrl: '/api/projects/project-1/tickets/ticket-1/attachments/att-1/download',
    createdByUserId: null,
    createdAt: '2026-01-01T00:00:00Z',
  };
}
