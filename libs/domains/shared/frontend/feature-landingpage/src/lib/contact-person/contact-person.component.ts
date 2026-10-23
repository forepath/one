import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type SharedContactPersonBrand = 'forepath' | 'agenstra' | 'decabill' | 'loadweaver';

interface SharedContactPerson {
  id: 'marcel' | 'maya';
  name: string;
  /** Lives in each app's assets. */
  photoUrl: string;
  role: string;
  photoAlt: string;
  /** AI-generated persona: the avatar carries the AI label and the quote says so. */
  virtual: boolean;
  /** Profile for visitors who prefer to reach out directly (icon-only link next to the name). */
  linkedIn?: { url: string; label: string };
  quote: Record<SharedContactPersonBrand, string>;
}

/**
 * The faces of the contact cards on all landing pages, shown side by side in this order. Their quotes
 * read as one story: the founder on working with AI, the virtual team member on what that means for
 * the person writing in.
 */
export const SHARED_CONTACT_PEOPLE: readonly SharedContactPerson[] = [
  {
    id: 'marcel',
    name: 'Marcel Menk',
    photoUrl: 'assets/images/team/marcel-menk.jpg',
    role: $localize`:@@sharedFeatureLandingpageContactPerson-role:Founder and CEO`,
    photoAlt: $localize`:@@sharedFeatureLandingpageContactPerson-photoAlt:Portrait of Marcel Menk`,
    virtual: false,
    linkedIn: {
      url: 'https://www.linkedin.com/in/marcel-menk/',
      label: $localize`:@@sharedFeatureLandingpageContactPerson-linkedInLabel:Marcel Menk on LinkedIn`,
    },
    quote: {
      forepath: $localize`:@@sharedFeatureLandingpageContactPerson-messageForepath:We work with AI every day, because it makes us faster and our results better.`,
      agenstra: $localize`:@@sharedFeatureLandingpageContactPerson-messageAgenstra:We build Agenstra with AI every day, because it makes the product better and lets us ship faster.`,
      decabill: $localize`:@@sharedFeatureLandingpageContactPerson-messageDecabill:We build Decabill with AI every day, because it makes the product better and lets us ship faster.`,
      loadweaver: $localize`:@@sharedFeatureLandingpageContactPerson-messageLoadweaver:We build Loadweaver with AI every day, because it makes the product better and lets us ship faster.`,
    },
  },
  {
    id: 'maya',
    name: 'Maya Keller',
    photoUrl: 'assets/images/team/maya-keller.png',
    role: $localize`:@@sharedFeatureLandingpageContactPerson-mayaRole:Virtual Customer Success`,
    photoAlt: $localize`:@@sharedFeatureLandingpageContactPerson-mayaPhotoAlt:AI-generated portrait of Maya Keller, our virtual team member`,
    virtual: true,
    quote: {
      forepath: $localize`:@@sharedFeatureLandingpageContactPerson-mayaMessageForepath:I am part of that, but your message still reaches real people on our team, and a person takes responsibility for every answer.`,
      agenstra: $localize`:@@sharedFeatureLandingpageContactPerson-mayaMessageAgenstra:I am part of that, but your message still reaches real people who know Agenstra, and a person takes responsibility for every answer.`,
      decabill: $localize`:@@sharedFeatureLandingpageContactPerson-mayaMessageDecabill:I am part of that, but your message still reaches real people who know Decabill, and a person takes responsibility for every answer.`,
      loadweaver: $localize`:@@sharedFeatureLandingpageContactPerson-mayaMessageLoadweaver:I am part of that, but your message still reaches real people who know Loadweaver, and a person takes responsibility for every answer.`,
    },
  },
];

/**
 * Faces for the closing call to action: two columns, each a mini quote card on the people behind
 * every answer, signed below. The signatures face each other in the middle (name and role, then the
 * photo on the left; photo, then name and role on the right). Sits between the CTA copy and its
 * buttons (on the brand-coloured CTA box or a dark hero); the cards are a translucent white layer, so
 * they take the tone of either surface.
 */
@Component({
  selector: 'shared-contact-person',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'shared-contact-person' },
  template: `
    @for (person of people; track person.id; let first = $first) {
      <div class="shared-contact-person__column" [class.shared-contact-person__column--start]="first">
        <blockquote class="shared-contact-person__card">
          <i class="bi bi-quote shared-contact-person__quote" aria-hidden="true"></i>
          <p class="shared-contact-person__message">{{ person.quote[brand()] }}</p>
        </blockquote>
        <figure class="shared-contact-person__author">
          <span class="shared-contact-person__avatar">
            <img
              [src]="person.photoUrl"
              width="800"
              height="800"
              class="shared-contact-person__photo"
              [alt]="person.photoAlt"
              loading="lazy"
            />
            @if (person.virtual) {
              <span class="shared-contact-person__ai-label" aria-hidden="true">{{ aiLabel }}</span>
            }
          </span>
          <figcaption class="shared-contact-person__caption">
            <span class="shared-contact-person__name">
              {{ person.name }}
              @if (person.linkedIn; as linkedIn) {
                <a
                  [href]="linkedIn.url"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="shared-contact-person__social"
                  [attr.aria-label]="linkedIn.label"
                  [attr.title]="linkedIn.label"
                  ><i class="bi bi-linkedin" aria-hidden="true"></i
                ></a>
              }
            </span>
            <span class="shared-contact-person__role">{{ person.role }}</span>
          </figcaption>
        </figure>
      </div>
    }
  `,
  styleUrl: './contact-person.component.scss',
})
export class SharedContactPersonComponent {
  /** Picks the quotes: the product sites name themselves. */
  readonly brand = input.required<SharedContactPersonBrand>();

  protected readonly people = SHARED_CONTACT_PEOPLE;
  /** Short mark on the avatar of a virtual persona (the photo's alt text spells it out). */
  protected readonly aiLabel = $localize`:@@sharedFeatureLandingpageContactPerson-aiLabel:AI`;
}
