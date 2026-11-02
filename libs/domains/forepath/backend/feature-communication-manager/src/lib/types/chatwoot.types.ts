export interface ChatwootContactInbox {
  source_id: string;
  inbox: {
    id: number;
    name?: string;
    channel_type?: string;
  };
}

export interface ChatwootContactListItem {
  id: number;
  name: string;
  email: string | null;
  phone_number: string | null;
  identifier: string | null;
  contact_inboxes: ChatwootContactInbox[];
}

export interface ChatwootContactsSearchResponse {
  meta: {
    count: number;
    current_page: number | string;
  };
  payload: ChatwootContactListItem[];
}

export interface ChatwootCreateContactPayload {
  inbox_id: number;
  name: string;
  email: string;
  phone_number?: string;
  custom_attributes?: Record<string, string>;
}

export interface ChatwootCreateContactResponse {
  payload?: { contact?: ChatwootContactListItem } | ChatwootContactListItem[];
}

export interface ChatwootCreateContactInboxPayload {
  inbox_id: number;
  source_id?: string;
}

export interface ChatwootCreateContactInboxResponse {
  source_id: string;
  inbox: ChatwootContactInbox['inbox'];
}

export interface ChatwootCreateConversationPayload {
  source_id: string;
  inbox_id: number;
  contact_id: number;
  status: 'open' | 'resolved' | 'pending';
  message?: {
    content: string;
    message_type?: 'incoming' | 'outgoing';
  };
}

export interface ChatwootCreateConversationResponse {
  id: number;
  account_id: number;
  inbox_id: number;
}

export interface ChatwootMessageAttachmentInput {
  buffer: Buffer;
  filename: string;
  contentType: string;
}

export interface ChatwootCreateMessagePayload {
  content: string;
  message_type?: 'incoming' | 'outgoing';
  private?: boolean;
  attachments?: ChatwootMessageAttachmentInput[];
}

export interface ChatwootCreateMessageResponse {
  id: number;
  content: string | null;
  conversation_id?: number;
}
