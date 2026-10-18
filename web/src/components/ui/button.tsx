import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

/* Flat, square-cornered, one fill each. "outline" is a tone step (no 1px box); "design" and "code" carry the track inks. */
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-[3px] text-sm font-medium whitespace-nowrap transition-[background-color,color,transform] duration-150 outline-none select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:not-aria-[haspopup]:scale-[0.97] disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-[color-mix(in_oklch,var(--primary),var(--background)_18%)]",
        design: "bg-signal text-signal-foreground hover:bg-[color-mix(in_oklch,var(--signal),var(--foreground)_14%)]",
        code: "bg-code text-code-foreground hover:bg-[color-mix(in_oklch,var(--code),var(--foreground)_14%)]",
        outline: "bg-muted text-foreground hover:bg-[color-mix(in_oklch,var(--muted),var(--foreground)_9%)] aria-expanded:bg-[color-mix(in_oklch,var(--muted),var(--foreground)_9%)]",
        secondary: "bg-muted text-foreground hover:bg-[color-mix(in_oklch,var(--muted),var(--foreground)_9%)]",
        ghost: "text-muted-foreground hover:bg-muted hover:text-foreground aria-expanded:bg-muted",
        destructive: "bg-coral/12 text-coral hover:bg-coral/20",
        link: "text-foreground underline underline-offset-4 decoration-1 hover:decoration-2",
      },
      size: {
        default: "h-9 gap-2 px-3.5",
        xs: "h-7 gap-1 px-2 text-xs [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 px-3 text-[13px] [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-11 gap-2 px-5 text-[15px]",
        icon: "size-9",
        "icon-xs": "size-7 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-sm": "size-8",
        "icon-lg": "size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
