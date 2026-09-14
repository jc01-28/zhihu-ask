/**
 * Frontend-local PostCSS boundary.
 *
 * The repository root has a Next-oriented PostCSS config. Vite walks upward
 * when resolving CSS tooling, so keep this app's config local and empty: the
 * Tailwind v4 Vite plugin handles Tailwind transforms directly.
 */
export default {
  plugins: {},
};
