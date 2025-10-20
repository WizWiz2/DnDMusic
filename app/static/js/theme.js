export const THEMES = {
  fantasy: {
    gradient: ['#d1fae5', '#a7f3d0', '#6ee7b7'],
    card: 'rgba(255, 255, 255, 0.82)',
    border: 'rgba(16, 185, 129, 0.25)',
    accent: '#047857',
    accentContrast: '#ffffff',
  },
  cyberpunk: {
    gradient: ['#f5d0ff', '#e0aaff', '#5eead4'],
    card: 'rgba(255, 255, 255, 0.85)',
    border: 'rgba(168, 85, 247, 0.35)',
    accent: '#7c3aed',
    accentContrast: '#ffffff',
  },
  scifi: {
    gradient: ['#dbeafe', '#bfdbfe', '#c4b5fd'],
    card: 'rgba(255, 255, 255, 0.88)',
    border: 'rgba(59, 130, 246, 0.28)',
    accent: '#2563eb',
    accentContrast: '#ffffff',
  },
  modern: {
    gradient: ['#f5f5f5', '#e5e7eb', '#d1d5db'],
    card: 'rgba(255, 255, 255, 0.9)',
    border: 'rgba(55, 65, 81, 0.2)',
    accent: '#1f2937',
    accentContrast: '#ffffff',
  },
  horror: {
    gradient: ['#fee2e2', '#fecaca', '#9ca3af'],
    card: 'rgba(255, 255, 255, 0.82)',
    border: 'rgba(185, 28, 28, 0.3)',
    accent: '#991b1b',
    accentContrast: '#ffffff',
  },
  default: {
    gradient: ['#f3f4f6', '#e5e7eb', '#d1d5db'],
    card: 'rgba(255, 255, 255, 0.85)',
    border: 'rgba(148, 163, 184, 0.25)',
    accent: '#0f172a',
    accentContrast: '#ffffff',
  },
};

export function applyTheme(genre) {
  const theme = THEMES[genre] || THEMES.default;
  document.documentElement.style.setProperty('--bg-start', theme.gradient[0]);
  document.documentElement.style.setProperty('--bg-middle', theme.gradient[1]);
  document.documentElement.style.setProperty('--bg-end', theme.gradient[2]);
  document.documentElement.style.setProperty('--card-bg', theme.card);
  document.documentElement.style.setProperty('--card-border', theme.border);
  document.documentElement.style.setProperty('--accent', theme.accent);
  document.documentElement.style.setProperty('--accent-contrast', theme.accentContrast);
}
