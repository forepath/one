/**
 * Whether the latest user interaction was the keyboard (Tab, arrows …) rather than a pointer. Text inputs match
 * `:focus-visible` on mouse focus too, so fields that show a keyboard focus ring (search field, typeahead) ask this
 * on `focus` instead. Listeners are installed once, in the capture phase, on first use.
 */
let lastWasKeyboard = false;
let installed = false;

function install(): void {
  if (installed || typeof document === 'undefined') return;

  installed = true;
  document.addEventListener(
    'keydown',
    (event) => {
      if (!event.metaKey && !event.altKey && !event.ctrlKey) lastWasKeyboard = true;
    },
    true,
  );
  document.addEventListener('pointerdown', () => (lastWasKeyboard = false), true);
}

export function fpcFocusFromKeyboard(): boolean {
  install();

  return lastWasKeyboard;
}

install();
