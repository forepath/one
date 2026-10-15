import { PLATFORM_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SharedLogoGridComponent, SharedLogoGridLogo } from './logo-grid.component';

const logo = (id: string): SharedLogoGridLogo => ({ id, name: id, logoUrl: `assets/images/logos/${id}.svg` });

describe('SharedLogoGridComponent', () => {
  let fixture: ComponentFixture<SharedLogoGridComponent>;

  const visibleIds = (): string[] =>
    Array.from(fixture.nativeElement.querySelectorAll('img') as NodeListOf<HTMLImageElement>).map((img) => img.alt);

  const render = (slots: readonly (readonly SharedLogoGridLogo[])[]): void => {
    fixture = TestBed.createComponent(SharedLogoGridComponent);
    fixture.componentRef.setInput('slots', slots);
    fixture.componentRef.setInput('ariaLabel', 'Logos');
    fixture.componentRef.setInput('rotationIntervalMs', 4000);
    fixture.detectChanges();
  };

  beforeEach(() => {
    jest.useFakeTimers();
    TestBed.configureTestingModule({
      imports: [SharedLogoGridComponent],
      providers: [{ provide: PLATFORM_ID, useValue: 'browser' }],
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('starts on the first logo of every slot', () => {
    render([[logo('a'), logo('b')], [logo('c')], [logo('d'), logo('e'), logo('f')]]);

    expect(visibleIds()).toEqual(['a', 'c', 'd']);
  });

  it('swaps all columns together without ever showing a logo twice', () => {
    render([[logo('a'), logo('b')], [logo('c')], [logo('d'), logo('e'), logo('f')], [logo('g')]]);

    let previous = visibleIds();
    const shown = new Set(previous);

    for (let tick = 0; tick < 21; tick++) {
      jest.advanceTimersByTime(3999);
      fixture.detectChanges();
      expect(visibleIds()).toEqual(previous);

      jest.advanceTimersByTime(1);
      fixture.detectChanges();

      const ids = visibleIds();

      expect(new Set(ids).size).toBe(ids.length);
      ids.forEach((id, column) => expect(id).not.toBe(previous[column]));
      ids.forEach((id) => shown.add(id));
      previous = ids;
    }

    expect(shown.size).toBe(7);
  });

  it('pages through the pool, wrapping around at the end', () => {
    render([[logo('a'), logo('b')], [logo('c'), logo('d')], [logo('e')]]);

    expect(visibleIds()).toEqual(['a', 'c', 'e']);

    jest.advanceTimersByTime(4000);
    fixture.detectChanges();
    expect(visibleIds()).toEqual(['b', 'd', 'a']);

    jest.advanceTimersByTime(4000);
    fixture.detectChanges();
    expect(visibleIds()).toEqual(['c', 'e', 'b']);
  });

  it.each([
    [6, 4],
    [10, 4],
    [25, 5],
    [7, 3],
    [5, 4],
  ])('shows all %i logos across %i columns before re-introducing any of them', (total, columns) => {
    const ids = Array.from({ length: total }, (_, index) => `logo-${index}`);
    const slots = Array.from({ length: columns }, (_, column) =>
      ids.filter((_, index) => index % columns === column).map(logo),
    );

    render(slots);

    let shownThisRound = new Set<string>();

    for (let tick = 0; tick < 30; tick++) {
      const page = visibleIds();
      const unseen = ids.filter((id) => !shownThisRound.has(id));

      if (unseen.length <= columns) {
        // Last page of a round: every remaining logo is on it; the rest open the next round.
        expect(page).toEqual(expect.arrayContaining(unseen));
        shownThisRound = new Set(page.filter((id) => !unseen.includes(id)));
      } else {
        expect(page.every((id) => unseen.includes(id))).toBe(true);
        page.forEach((id) => shownThisRound.add(id));
      }

      jest.advanceTimersByTime(4000);
      fixture.detectChanges();
    }
  });

  it('does not rotate when every logo already has a column', () => {
    render([[logo('a')], [logo('b')]]);

    jest.advanceTimersByTime(20000);
    fixture.detectChanges();

    expect(visibleIds()).toEqual(['a', 'b']);
  });
});
