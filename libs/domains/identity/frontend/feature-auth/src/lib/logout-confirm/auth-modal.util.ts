import { ElementRef } from '@angular/core';

type BootstrapModal = { show: () => void; hide: () => void };

function getBootstrapModal(el: HTMLElement): BootstrapModal | null {
  return (
    (
      globalThis as { bootstrap?: { Modal?: { getOrCreateInstance: (el: HTMLElement) => BootstrapModal } } }
    ).bootstrap?.Modal?.getOrCreateInstance(el) ?? null
  );
}

export function showAuthModal(modalElement: ElementRef<HTMLDivElement>): void {
  getBootstrapModal(modalElement.nativeElement)?.show();
}

export function hideAuthModal(modalElement: ElementRef<HTMLDivElement>): void {
  getBootstrapModal(modalElement.nativeElement)?.hide();
}
