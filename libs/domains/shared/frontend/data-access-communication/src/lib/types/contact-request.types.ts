/** Request body for POST /public/contact-requests (OpenAPI CreateContactRequest). */
export interface SubmitContactRequestPayload {
  name: string;
  email: string;
  message: string;
  turnstileToken: string;
  phone?: string;
  company?: string;
}

/** Response body for POST /public/contact-requests (OpenAPI ContactRequestResponse). */
export interface ContactRequestResponse {
  accepted: true;
  referenceId: string;
}

export interface ContactRequestFormValue {
  name: string;
  email: string;
  message: string;
  phone: string;
  company: string;
}
