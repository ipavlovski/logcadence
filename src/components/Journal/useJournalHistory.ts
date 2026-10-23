import { useCommand } from '../../state/commands.ts'
import { goDayHistory } from '../../state/panes.ts'

/** While the journal tab is mounted, the canvas's back/forward (alt+left/right) step through the days it showed. */
export function useJournalHistory() {
  useCommand('canvas.back', () => goDayHistory(-1))
  useCommand('canvas.forward', () => goDayHistory(1))
}
