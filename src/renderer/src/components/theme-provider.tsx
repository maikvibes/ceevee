import { createContext, useContext, useEffect, useState } from "react"
import sageGreenCss from '../assets/sage_green.css?raw'
import warmCss from '../assets/warm.css?raw'

type Theme = "dark" | "light" | "system"
type ColorThemeId = "default" | "sage_green" | "warm" | "custom"

type ThemeProviderProps = {
  children: React.ReactNode
  defaultTheme?: Theme
  defaultColor?: ColorThemeId
  storageKey?: string
  colorStorageKey?: string
  customStyleKey?: string
}

type ThemeProviderState = {
  theme: Theme
  setTheme: (theme: Theme) => void
  colorTheme: ColorThemeId
  setColorTheme: (color: ColorThemeId) => void
  customStyle: string
  setCustomStyle: (style: string) => void
}

const initialState: ThemeProviderState = {
  theme: "system",
  setTheme: () => null,
  colorTheme: "default",
  setColorTheme: () => null,
  customStyle: "",
  setCustomStyle: () => null,
}

const ThemeProviderContext = createContext<ThemeProviderState>(initialState)

export function ThemeProvider({
  children,
  defaultTheme = "system",
  defaultColor = "default",
  storageKey = "vite-ui-theme",
  colorStorageKey = "vite-ui-color-theme",
  customStyleKey = "vite-ui-custom-style",
  ...props
}: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem(storageKey) as Theme) || defaultTheme
  )
  const [colorTheme, setColorTheme] = useState<ColorThemeId>(
    () => (localStorage.getItem(colorStorageKey) as ColorThemeId) || defaultColor
  )
  const [customStyle, setCustomStyle] = useState<string>(
    () => localStorage.getItem(customStyleKey) || ""
  )

  useEffect(() => {
    const root = window.document.documentElement

    // Remove old classes
    root.classList.remove("light", "dark")

    // Add dark/light class
    if (theme === "system") {
      const systemTheme = window.matchMedia("(prefers-color-scheme: dark)")
        .matches
        ? "dark"
        : "light"

      root.classList.add(systemTheme)
    } else {
      root.classList.add(theme)
    }
  }, [theme])

  // Handle dynamic style injection
  useEffect(() => {
    let cssString = ""
    if (colorTheme === "sage_green") cssString = sageGreenCss
    else if (colorTheme === "warm") cssString = warmCss
    else if (colorTheme === "custom") cssString = customStyle

    let styleEl = document.getElementById("tweakcn-theme")
    if (!styleEl) {
      styleEl = document.createElement("style")
      styleEl.id = "tweakcn-theme"
      document.head.appendChild(styleEl)
    }
    styleEl.textContent = cssString
  }, [colorTheme, customStyle])

  const value = {
    theme,
    setTheme: (theme: Theme) => {
      localStorage.setItem(storageKey, theme)
      setTheme(theme)
    },
    colorTheme,
    setColorTheme: (color: ColorThemeId) => {
      localStorage.setItem(colorStorageKey, color)
      setColorTheme(color)
    },
    customStyle,
    setCustomStyle: (style: string) => {
      localStorage.setItem(customStyleKey, style)
      setCustomStyle(style)
    }
  }

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  )
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext)

  if (context === undefined)
    throw new Error("useTheme must be used within a ThemeProvider")

  return context
}
