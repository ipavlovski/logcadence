import { useCategories } from '../../state/categories.ts'
import styles from './CategoryPicker.module.css'

interface Props {
  value: string | null
  onChange: (category: string | null) => void
  className?: string
}

/** The entry's category: one of the list, or none. */
export function CategoryPicker({ value, onChange, className }: Props) {
  const list = useCategories()
  // A category that isn't listed (yet) still shows as chosen.
  const names = value && !list.some((c) => c.name === value) ? [...list.map((c) => c.name), value] : list.map((c) => c.name)
  return (
    <select
      className={`${styles.picker} ${value ? '' : styles.none} ${className ?? ''}`}
      value={value ?? ''}
      title={value ? `Category: ${value}` : 'No category'}
      aria-label="Category"
      onChange={(e) => onChange(e.target.value || null)}
      onClick={(e) => e.stopPropagation()}
    >
      <option value="">no category</option>
      {names.map((n) => (
        <option key={n} value={n}>
          {n}
        </option>
      ))}
    </select>
  )
}
