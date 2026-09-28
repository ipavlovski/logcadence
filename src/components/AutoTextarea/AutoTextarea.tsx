import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, type TextareaHTMLAttributes } from 'react'

/** Textarea that grows with its content. */
export const AutoTextarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function AutoTextarea(props, fwd) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useImperativeHandle(fwd, () => ref.current!)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [props.value])
  return <textarea rows={1} {...props} ref={ref} />
})
