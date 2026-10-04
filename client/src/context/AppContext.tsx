import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';

interface AppContextValue {
  appName: string;
  appSubtitle: string;
  allowedDomain: string;
  /** Full display string used in the browser title and primary branding. */
  displayName: string;
  /** Short brand string used in compact layouts. */
  brandName: string;
}

const AppContext = createContext<AppContextValue>({
  appName: 'TiL Quiz',
  appSubtitle: 'Đào tạo & Kiểm tra nội bộ',
  allowedDomain: '',
  displayName: 'TiL Quiz',
  brandName: 'TiL Quiz',
});

function buildDisplay(
  appName: string,
  appSubtitle: string,
  allowedDomain: string,
): AppContextValue {
  const trimmed = appName.trim();
  return {
    appName: trimmed,
    appSubtitle: appSubtitle.trim(),
    allowedDomain: allowedDomain.trim(),
    displayName: trimmed || 'TiL Quiz',
    brandName: trimmed || 'TiL Quiz',
  };
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [value, setValue] = useState<AppContextValue>(
    buildDisplay('TiL Quiz', 'Đào tạo & Kiểm tra nội bộ', ''),
  );

  useEffect(() => {
    fetch('/api/public')
      .then((r) => r.json())
      .then(
        ({
          appName,
          appSubtitle,
          allowedDomain,
        }: {
          appName: string;
          appSubtitle: string;
          allowedDomain?: string;
        }) => setValue(buildDisplay(appName, appSubtitle ?? '', allowedDomain ?? '')),
      )
      .catch(() => {});
  }, []);

  // Keep browser tab title in sync
  useEffect(() => {
    document.title = value.displayName;
  }, [value.displayName]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  return useContext(AppContext);
}
