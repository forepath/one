export { EmailService } from './lib/email.service';
export type { EmailAttachment, EmailOptions } from './lib/email.service';
export { EmailTemplateRendererService } from './lib/email-template-renderer.service';
export type { RenderedEmailBodies } from './lib/email-template-renderer.service';
export {
  emailTemplateFileName,
  loadEmailLayoutPartial,
  loadEmailTemplate,
  resetEmailTemplateCacheForTests,
} from './lib/email-template.loader';
export type { EmailTemplateVariant } from './lib/email-template.loader';
export { resolveEmailSubject } from './lib/email-subject.types';
export type { EmailSubjectBuilder, EmailSubjectRegistry } from './lib/email-subject.types';
