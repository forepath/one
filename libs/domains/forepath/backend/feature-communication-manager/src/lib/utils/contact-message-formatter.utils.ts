export interface ContactMessageInput {
  name: string;
  email: string;
  message: string;
  phone?: string;
  company?: string;
}

export function formatContactRequestMessage(input: ContactMessageInput): string {
  const lines = ['Contact request from website', '', `Name: ${input.name.trim()}`, `Email: ${input.email.trim()}`];

  if (input.phone?.trim()) {
    lines.push(`Phone: ${input.phone.trim()}`);
  }

  if (input.company?.trim()) {
    lines.push(`Company: ${input.company.trim()}`);
  }

  lines.push('', 'Message:', input.message.trim());

  return lines.join('\n');
}
