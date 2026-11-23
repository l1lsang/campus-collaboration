import { Slot } from 'radix-ui'
import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

const buttonVariants = cva('button', {
  variants: {
    variant: {
      primary: 'button-primary',
      outline: 'button-outline',
      ghost: 'button-ghost',
      danger: 'button-danger',
    },
  },
  defaultVariants: { variant: 'primary' },
})

export function Button({
  className,
  variant,
  asChild = false,
  type,
  ...props
}: ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Component = asChild ? Slot.Root : 'button'
  return (
    <Component
      className={cn(buttonVariants({ variant }), className)}
      {...(!asChild && { type: type ?? 'button' })}
      {...props}
    />
  )
}
