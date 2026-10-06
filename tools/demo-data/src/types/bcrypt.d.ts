// The workspace ships `bcrypt` without `@types/bcrypt`; only the API used by the seeders is declared.
declare module 'bcrypt' {
  export function hash(data: string, saltOrRounds: number): Promise<string>;
  export function compare(data: string, encrypted: string): Promise<boolean>;
}
