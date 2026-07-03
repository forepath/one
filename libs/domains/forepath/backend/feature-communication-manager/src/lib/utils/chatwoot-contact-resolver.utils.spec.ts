import { ChatwootContactListItem } from '../types/chatwoot.types';
import { resolveContactSourceId, resolveCreatedContact } from './chatwoot-contact-resolver.utils';

describe('resolveContactSourceId', () => {
  const contact: ChatwootContactListItem = {
    id: 1,
    name: 'Alice',
    email: 'alice@example.com',
    phone_number: null,
    identifier: null,
    contact_inboxes: [
      {
        source_id: 'src-42',
        inbox: { id: 7, name: 'API', channel_type: 'Channel::Api' },
      },
    ],
  };

  it('returns source_id for matching inbox', () => {
    expect(resolveContactSourceId(contact, 7)).toBe('src-42');
  });

  it('returns null when inbox does not match', () => {
    expect(resolveContactSourceId(contact, 99)).toBeNull();
  });
});

describe('resolveCreatedContact', () => {
  it('reads nested contact payload', () => {
    const contact: ChatwootContactListItem = {
      id: 2,
      name: 'Bob',
      email: 'bob@example.com',
      phone_number: null,
      identifier: null,
      contact_inboxes: [],
    };

    expect(resolveCreatedContact({ payload: { contact } })).toEqual(contact);
  });

  it('reads array payload fallback', () => {
    const contact: ChatwootContactListItem = {
      id: 3,
      name: 'Carol',
      email: 'carol@example.com',
      phone_number: null,
      identifier: null,
      contact_inboxes: [],
    };

    expect(resolveCreatedContact({ payload: [contact] })).toEqual(contact);
  });
});
