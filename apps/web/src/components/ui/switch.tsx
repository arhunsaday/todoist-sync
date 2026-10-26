import * as SwitchPrimitive from '@radix-ui/react-switch'
import type { ComponentProps } from 'react'
export function Switch(props: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root className="switch" {...props}>
      <SwitchPrimitive.Thumb className="switch-thumb" />
    </SwitchPrimitive.Root>
  )
}
