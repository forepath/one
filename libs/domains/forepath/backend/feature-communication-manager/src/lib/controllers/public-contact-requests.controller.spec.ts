import { PublicContactRequestsController } from './public-contact-requests.controller';
import { ContactRequestService } from '../services/contact-request.service';

describe('PublicContactRequestsController', () => {
  let controller: PublicContactRequestsController;
  let contactRequestService: jest.Mocked<Pick<ContactRequestService, 'submitContactRequest'>>;

  beforeEach(() => {
    contactRequestService = {
      submitContactRequest: jest.fn().mockResolvedValue({ accepted: true, referenceId: '42' }),
    };

    controller = new PublicContactRequestsController(contactRequestService as unknown as ContactRequestService);
  });

  it('delegates submission to ContactRequestService', async () => {
    const dto = {
      name: 'Alice',
      email: 'alice@example.com',
      message: 'Hello',
      turnstileToken: 'token',
    };

    await expect(controller.submit(dto)).resolves.toEqual({ accepted: true, referenceId: '42' });
    expect(contactRequestService.submitContactRequest).toHaveBeenCalledWith(dto);
  });
});
