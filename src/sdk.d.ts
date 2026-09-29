/**
 * Minimal ambient types for the subset of `@hermes/plugin-sdk` used by this
 * plugin. Replace with upstream types when Hermes ships them.
 */
declare module '@hermes/plugin-sdk' {
  export type Contribution = {
    id: string
    area: string
    order?: number
    title?: string
    when?: () => boolean
    enabled?: boolean
    render?: () => unknown
    data?: unknown
  }
  export interface PluginContext {
    readonly source: string
    register: (c: Contribution) => () => void
    registerMany: (cs: Contribution[]) => () => void
    rest: <T = unknown>(path: string, opts?: { method?: string; body?: unknown }) => Promise<T>
    socket: (path: string, onMessage: (data: unknown) => void) => () => void
    storage: {
      get: (key: string, fallback?: unknown) => any
      set: (key: string, value: unknown) => void
    }
  }
  export type HermesPlugin = {
    id: string
    name?: string
    defaultEnabled?: boolean
    register: (ctx: PluginContext) => void
  }
  export function atom<T>(initial: T): {
    get: () => T
    set: (v: T) => void
  }
  export function computed<T>(fn: () => T): { get: () => T }
  export function useValue<T>(a: { get: () => T }): T
  export function useQuery(opts: any): any
  export function useMutation(opts: any): any
  export function useQueryClient(): any
  export function usePluginI18n(id?: string): any
  export const host: {
    navigate: (path: string) => void
    [k: string]: any
  }
  export const queryClient: any
  export const ROUTES_AREA: string
  export const SIDEBAR_NAV_AREA: string
  export const PALETTE_AREA: string
  export const TITLEBAR_AREAS: { left: string; center: string; right: string }
  export const STATUSBAR_AREAS: { left: string; right: string }
  export const KEYBINDS_AREA: string
  // UI kit surface used by this plugin (loose — the real SDK exports components)
  export const Badge: any
  export const Button: any
  export const Codicon: any
  export const Dialog: any
  export const DialogContent: any
  export const DialogFooter: any
  export const DialogHeader: any
  export const DialogTitle: any
  export const Input: any
  export const Contribute: any
  export const DropdownMenu: any
  export const DropdownMenuContent: any
  export const DropdownMenuItem: any
  export const DropdownMenuSeparator: any
  export const DropdownMenuTrigger: any
  export const EmptyState: any
  export const ErrorState: any
  export const Loader: any
  export const Streamdown: any
  export const Switch: any
  export function cn(...parts: unknown[]): string
  export function profileColor(name: string): string
  export function profileColorSoft(name: string, pct?: number): string
  export function useGrabScroll(ref: any): any
}
