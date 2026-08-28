import { createSlice, PayloadAction } from '@reduxjs/toolkit';
type Panel = 'chat'|'participants'|'whiteboard'|'files'|null;
interface UIState { activePanel: Panel; layout: 'grid'|'spotlight'|'sidebar'; spotlightUid: string|null; isSettingsOpen: boolean; theme: string; sidebarCollapsed: boolean; }
const uiSlice = createSlice({ name: 'ui', initialState: { activePanel: null, layout: 'grid', spotlightUid: null, isSettingsOpen: false, theme: 'system', sidebarCollapsed: false } as UIState, reducers: {
  setActivePanel: (s, a: PayloadAction<Panel>) => { s.activePanel = s.activePanel === a.payload ? null : a.payload; },
  setLayout: (s, a: PayloadAction<'grid'|'spotlight'|'sidebar'>) => { s.layout = a.payload; },
  setSpotlight: (s, a: PayloadAction<string|null>) => { s.spotlightUid = a.payload; if (a.payload) s.layout = 'spotlight'; },
  setSettingsOpen: (s, a: PayloadAction<boolean>) => { s.isSettingsOpen = a.payload; },
  setTheme: (s, a: PayloadAction<string>) => { s.theme = a.payload; },
  toggleSidebar: (s) => { s.sidebarCollapsed = !s.sidebarCollapsed; },
}});
export const { setActivePanel, setLayout, setSpotlight, setSettingsOpen, setTheme, toggleSidebar } = uiSlice.actions;
export default uiSlice.reducer;
