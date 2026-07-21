/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface KofiWidget {
  init(text: string, color: string, id: string): void
  draw(): void
}

interface Window {
  kofiwidget2: KofiWidget
}
