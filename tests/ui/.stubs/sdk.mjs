const __cn = (...parts) => parts.filter(Boolean).join(' ')
const __atom = initial => {
  let value = initial
  return { get: () => value, set: v => { value = v }, subscribe: () => () => {} }
}
const __profileColor = () => '#888888'
const __profileColorSoft = () => 'rgba(136,136,136,0.2)'
const __useMutation = options => ({
  mutate: vars => {
    if (options && typeof options.mutationFn === 'function') {
      Promise.resolve(options.mutationFn(vars)).catch(() => {})
    }
  },
  isPending: false
})
const __usePluginI18n = () => ((path, ...args) => String(path))
const __useQueryClient = () => ({ invalidateQueries: () => {} })
const __useValue = a => (a && typeof a.get === 'function' ? a.get() : undefined)
const stubQueryData = {"kanban-gantt|boards":{"boards":[{"slug":"sumaris-app","label":"Sumaris App","total":12},{"slug":"obsfish","label":"ObsVentes","total":8}],"current":"sumaris-app"},"kanban-gantt|gantt":{"tasks":[{"id":"t_1","title":"Epic — first task","status":"running","assignee":"alice","started_at":1800000000,"created_at":1799000000,"archived":false},{"id":"t_2","title":"Child task (done)","status":"done","assignee":"bob","completed_at":1800100000,"created_at":1799000000,"archived":false},{"id":"t_3","title":"Blocked task","status":"blocked","created_at":1799000000,"archived":false}],"total":3}}
const __useQuery = options => {
  const key = options && Array.isArray(options.queryKey) ? options.queryKey.join('|') : ''
  let data
  if (key.includes('|boards')) data = stubQueryData['kanban-gantt|boards']
  else if (key.includes('|gantt')) data = stubQueryData['kanban-gantt|gantt']
  return { data, isLoading: false, isError: false, error: null, refetch: async () => {} }
}
const sdk = {
  "Badge": "Badge",
  "Button": "Button",
  "Codicon": "Codicon",
  "Contribute": "Contribute",
  "DropdownMenu": "DropdownMenu",
  "DropdownMenuContent": "DropdownMenuContent",
  "DropdownMenuItem": "DropdownMenuItem",
  "DropdownMenuSeparator": "DropdownMenuSeparator",
  "DropdownMenuTrigger": "DropdownMenuTrigger",
  "EmptyState": "EmptyState",
  "ErrorState": "ErrorState",
  "Loader": "Loader",
  "PALETTE_AREA": "palette",
  "ROUTES_AREA": "routes",
  "SIDEBAR_NAV_AREA": "sidebar.nav",
  "Streamdown": "Streamdown",
  "Switch": "Switch",
  "TITLEBAR_AREAS": {
    "left": "titleBar.left",
    "center": "titleBar.center",
    "right": "titleBar.right"
  },
  "WORKSPACE_PAGE_HEADER_AREA": "workspace.pageHeader",
  "queryClient": {},
  "ConfirmDialog": "ConfirmDialog",
  "Dialog": "Dialog",
  "DialogContent": "DialogContent",
  "DialogFooter": "DialogFooter",
  "DialogHeader": "DialogHeader",
  "DialogTitle": "DialogTitle",
  "Input": "Input",
  "Popover": "Popover",
  "PopoverContent": "PopoverContent",
  "PopoverTrigger": "PopoverTrigger",
  "DialogDescription": "DialogDescription"
}
sdk.host = { navigate: path => calls.navigate.push(path) }
sdk.atom = __atom
sdk.useValue = __useValue
sdk.useMutation = __useMutation
sdk.useQuery = __useQuery
export default sdk
export const cn = __cn
export const atom = __atom
export const profileColor = __profileColor
export const profileColorSoft = __profileColorSoft
export const useMutation = __useMutation
export const usePluginI18n = __usePluginI18n
export const useQuery = __useQuery
export const useQueryClient = __useQueryClient
export const useValue = __useValue
export const host = sdk.host
export const Badge = sdk.Badge
export const Button = sdk.Button
export const Codicon = sdk.Codicon
export const Contribute = sdk.Contribute
export const DropdownMenu = sdk.DropdownMenu
export const DropdownMenuContent = sdk.DropdownMenuContent
export const DropdownMenuItem = sdk.DropdownMenuItem
export const DropdownMenuSeparator = sdk.DropdownMenuSeparator
export const DropdownMenuTrigger = sdk.DropdownMenuTrigger
export const EmptyState = sdk.EmptyState
export const ErrorState = sdk.ErrorState
export const Loader = sdk.Loader
export const PALETTE_AREA = sdk.PALETTE_AREA
export const ROUTES_AREA = sdk.ROUTES_AREA
export const SIDEBAR_NAV_AREA = sdk.SIDEBAR_NAV_AREA
export const Streamdown = sdk.Streamdown
export const Switch = sdk.Switch
export const TITLEBAR_AREAS = sdk.TITLEBAR_AREAS
export const WORKSPACE_PAGE_HEADER_AREA = sdk.WORKSPACE_PAGE_HEADER_AREA
export const queryClient = sdk.queryClient
export const ConfirmDialog = sdk.ConfirmDialog
export const Dialog = sdk.Dialog
export const DialogContent = sdk.DialogContent
export const DialogFooter = sdk.DialogFooter
export const DialogHeader = sdk.DialogHeader
export const DialogTitle = sdk.DialogTitle
export const Input = sdk.Input
export const Popover = sdk.Popover
export const PopoverContent = sdk.PopoverContent
export const PopoverTrigger = sdk.PopoverTrigger
export const DialogDescription = sdk.DialogDescription
