export interface ForepathSocialLink {
  readonly id: string;
  readonly label: string;
  readonly href: string;
  readonly iconClass: string;
}

export const FOREPATH_CONTACT = {
  email: 'hi@forepath.io',
  phoneDisplay: '+49 (0) 5221 1411690',
  phoneHref: 'tel:+4952211411690',
} as const;

export const FOREPATH_SOCIAL_LINKS: readonly ForepathSocialLink[] = [
  {
    id: 'facebook',
    label: 'Facebook',
    href: 'https://www.facebook.com/forepathde/',
    iconClass: 'bi-facebook',
  },
  {
    id: 'x',
    label: 'X',
    href: 'https://x.com/forepathde/',
    iconClass: 'bi-twitter-x',
  },
  {
    id: 'linkedin',
    label: 'LinkedIn',
    href: 'https://www.linkedin.com/company/forepathde/',
    iconClass: 'bi-linkedin',
  },
  {
    id: 'github',
    label: 'GitHub',
    href: 'https://github.com/forepath',
    iconClass: 'bi-github',
  },
  {
    id: 'discord',
    label: 'Discord',
    href: 'https://discord.gg/5wFMuVvQZM',
    iconClass: 'bi-discord',
  },
] as const;
