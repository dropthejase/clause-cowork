export {};

declare global {
  interface Window {
    electron?: {
      browseFolder: () => Promise<string | null>;
    };
  }
}
