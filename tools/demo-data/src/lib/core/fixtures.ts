/** Word pools used to compose plausible names, companies and addresses. */

export const FIRST_NAMES = [
  'Anna',
  'Ben',
  'Clara',
  'David',
  'Elena',
  'Felix',
  'Greta',
  'Hannes',
  'Ida',
  'Jonas',
  'Katharina',
  'Lukas',
  'Marie',
  'Niklas',
  'Olivia',
  'Paul',
  'Quentin',
  'Rosa',
  'Simon',
  'Theresa',
  'Ulrich',
  'Valentina',
  'Wolfgang',
  'Xenia',
  'Yusuf',
  'Zoe',
  'Amelie',
  'Emil',
  'Leonie',
  'Mats',
  'Sofia',
  'Tobias',
] as const;

export const LAST_NAMES = [
  'Bauer',
  'Becker',
  'Brandt',
  'Fischer',
  'Hartmann',
  'Hoffmann',
  'Jansen',
  'Keller',
  'Koch',
  'Krüger',
  'Lange',
  'Lehmann',
  'Meyer',
  'Neumann',
  'Peters',
  'Richter',
  'Schmidt',
  'Schneider',
  'Schulz',
  'Wagner',
  'Weber',
  'Wolf',
  'Ziegler',
  'Dubois',
  'Rossi',
  'Novak',
  'Jensen',
  'van Dijk',
] as const;

export const COMPANY_STEMS = [
  'Nordlicht',
  'Bergwerk',
  'Blauwal',
  'Kranich',
  'Lindenhof',
  'Polarstern',
  'Rheinblick',
  'Sonnenfeld',
  'Tannenhain',
  'Weitblick',
  'Ahornweg',
  'Elbufer',
  'Falkenstein',
  'Seeblick',
  'Morgenrot',
  'Steinbach',
] as const;

export const COMPANY_KINDS = [
  'Digital',
  'Software',
  'Consulting',
  'Logistik',
  'Medien',
  'Systems',
  'Labs',
  'Solutions',
  'Analytics',
  'Studio',
] as const;

export const COMPANY_LEGAL_FORMS = ['GmbH', 'GmbH & Co. KG', 'AG', 'UG (haftungsbeschränkt)', 'e.K.'] as const;

export const STREETS = [
  'Hauptstraße',
  'Bahnhofstraße',
  'Gartenweg',
  'Lindenallee',
  'Schillerstraße',
  'Goethestraße',
  'Am Markt',
  'Industriestraße',
  'Hafenstraße',
  'Mühlenweg',
  'Kirchplatz',
  'Rosenstraße',
] as const;

export interface CityFixture {
  city: string;
  postalCode: string;
  country: string;
  state?: string;
  vatPrefix: string;
  phonePrefix: string;
}

export const CITIES: readonly CityFixture[] = [
  { city: 'Berlin', postalCode: '10115', country: 'DE', state: 'Berlin', vatPrefix: 'DE', phonePrefix: '+49 30' },
  { city: 'Hamburg', postalCode: '20095', country: 'DE', state: 'Hamburg', vatPrefix: 'DE', phonePrefix: '+49 40' },
  { city: 'München', postalCode: '80331', country: 'DE', state: 'Bayern', vatPrefix: 'DE', phonePrefix: '+49 89' },
  { city: 'Köln', postalCode: '50667', country: 'DE', state: 'NRW', vatPrefix: 'DE', phonePrefix: '+49 221' },
  { city: 'Bielefeld', postalCode: '33602', country: 'DE', state: 'NRW', vatPrefix: 'DE', phonePrefix: '+49 521' },
  { city: 'Leipzig', postalCode: '04109', country: 'DE', state: 'Sachsen', vatPrefix: 'DE', phonePrefix: '+49 341' },
  { city: 'Wien', postalCode: '1010', country: 'AT', vatPrefix: 'ATU', phonePrefix: '+43 1' },
  { city: 'Zürich', postalCode: '8001', country: 'CH', vatPrefix: 'CHE', phonePrefix: '+41 44' },
  { city: 'Amsterdam', postalCode: '1012 AB', country: 'NL', vatPrefix: 'NL', phonePrefix: '+31 20' },
  { city: 'Paris', postalCode: '75001', country: 'FR', vatPrefix: 'FR', phonePrefix: '+33 1' },
  { city: 'Wrocław', postalCode: '50-001', country: 'PL', vatPrefix: 'PL', phonePrefix: '+48 71' },
  { city: 'Austin', postalCode: '78701', country: 'US', state: 'TX', vatPrefix: '', phonePrefix: '+1 512' },
];

export const LOREM_SENTENCES = [
  'Please double-check the numbers before the next review.',
  'The customer asked for a short status update by Friday.',
  'We aligned on the approach in yesterday’s call.',
  'This depends on the infrastructure change being deployed first.',
  'Edge cases around time zones still need a test.',
  'Documentation should be updated together with the release notes.',
  'The current behaviour is confusing for first-time users.',
  'Performance looks fine with the sample data set.',
  'Let us keep the scope small and iterate afterwards.',
  'Rollback is possible by reverting the configuration flag.',
] as const;

export const SOFTWARE_TOPICS = [
  'login flow',
  'invoice export',
  'search results',
  'dashboard charts',
  'notification emails',
  'onboarding wizard',
  'API rate limiting',
  'file uploads',
  'user settings',
  'audit trail',
  'dark mode',
  'webhook retries',
  'payment checkout',
  'CSV import',
  'mobile navigation',
  'permissions model',
] as const;

export const TICKET_VERBS = [
  'Fix',
  'Improve',
  'Refactor',
  'Add tests for',
  'Document',
  'Redesign',
  'Speed up',
  'Localize',
  'Harden',
  'Investigate',
] as const;
