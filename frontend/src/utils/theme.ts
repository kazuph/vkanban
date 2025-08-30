import { ThemeMode } from 'shared/types';

export const isSystemDark = (): boolean => {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
};

const DARK_THEMES: ThemeMode[] = [
  ThemeMode.DARK,
  ThemeMode.PURPLE,
  ThemeMode.GREEN,
  ThemeMode.BLUE,
  ThemeMode.ORANGE,
  ThemeMode.RED,
  ThemeMode.SOLARIZED_DARK,
  ThemeMode.GRUVBOX_DARK,
  ThemeMode.NORD,
  ThemeMode.ONE_DARK,
  ThemeMode.DRACULA,
];

const LIGHT_THEMES: ThemeMode[] = [ThemeMode.LIGHT, ThemeMode.SOLARIZED_LIGHT, ThemeMode.GRUVBOX_LIGHT];

export const isDarkTheme = (theme: ThemeMode): boolean => {
  if (theme === ThemeMode.SYSTEM) return isSystemDark();
  if (DARK_THEMES.includes(theme)) return true;
  if (LIGHT_THEMES.includes(theme)) return false;
  // Fallback: treat unknown custom themes as dark to be safe for contrast
  return true;
};

