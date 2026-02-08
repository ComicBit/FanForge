import * as React from "react";
import * as LabelPrimitive from "@radix-ui/react-label";
import * as SelectPrimitive from "@radix-ui/react-select";
import * as SeparatorPrimitive from "@radix-ui/react-separator";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { cva, type VariantProps } from "class-variance-authority";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const Card = React.forwardRef<HTMLElement, React.HTMLAttributes<HTMLElement>>(({ className, ...props }, ref) => (
  <section
    ref={ref}
    className={cn(
      "rounded-[2rem] border-0 bg-[#ECF0F3] text-[#34334C]",
      "shadow-[1rem_1rem_2rem_rgba(54,85,153,0.15),-0.5rem_-0.5rem_2rem_rgba(255,255,255,0.7),inset_0.1rem_0.1rem_0.1rem_rgba(255,255,255,0.7),inset_-0.1rem_-0.1rem_0.1rem_rgba(54,85,153,0.15)]",
      className
    )}
    {...props}
  />
));
Card.displayName = "Card";

export const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("flex flex-col space-y-1.5 p-5 md:p-6", className)} {...props} />
));
CardHeader.displayName = "CardHeader";

export const CardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(({ className, ...props }, ref) => (
  <h3 ref={ref} className={cn("text-xl font-semibold leading-none tracking-tight", className)} {...props} />
));
CardTitle.displayName = "CardTitle";

export const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("p-5 pt-0 md:p-6 md:pt-0", className)} {...props} />
));
CardContent.displayName = "CardContent";

const buttonVariants = cva(
  "relative inline-flex items-center justify-center whitespace-nowrap rounded-2xl text-sm font-medium ring-offset-background transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 " +
    "before:pointer-events-none before:absolute before:inset-0 before:rounded-[inherit] before:content-[''] " +
    "bg-[#ececec] shadow-[-6px_-6px_12px_rgba(255,255,255,0.95),5px_6px_13px_rgba(0,0,0,0.14)] " +
    "active:shadow-[0_8px_14px_rgba(0,0,0,0.04)] active:before:shadow-[inset_0_-2px_5px_rgba(255,255,255,0.95),inset_0_2px_5px_rgba(0,0,0,0.16)] " +
    "[&_svg]:transition-transform [&_svg]:duration-150 active:[&_svg]:scale-95",
  {
    variants: {
      variant: {
        default: "text-slate-700",
        destructive: "text-rose-700",
        secondary: "text-slate-600"
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 px-3.5"
      }
    },
    defaultVariants: {
      variant: "default",
      size: "default"
    }
  }
);

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>;

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, ...props }, ref) => (
  <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
));
Button.displayName = "Button";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "flex h-11 w-full rounded-[1.4rem] border-0 bg-[#ECF0F3] px-4 py-2 text-sm text-[#4D4E68] ring-offset-background",
      "file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground",
      "shadow-[inset_0.5rem_0.5rem_1rem_rgba(54,85,153,0.15),inset_-0.25rem_-0.25rem_1rem_rgba(255,255,255,0.7),0.1rem_0.1rem_0.1rem_rgba(255,255,255,0.7),-0.1rem_-0.1rem_0.1rem_rgba(54,85,153,0.15)]",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6C7CC9]/45 focus-visible:ring-offset-2",
      "disabled:cursor-not-allowed disabled:opacity-50",
      className
    )}
    {...props}
  />
));
Input.displayName = "Input";

export const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => <LabelPrimitive.Root ref={ref} className={cn("text-sm font-medium leading-none", className)} {...props} />);
Label.displayName = "Label";

type SwitchProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> & {
  onCheckedChange?: (checked: boolean) => void;
};

export const Switch = React.forwardRef<HTMLInputElement, SwitchProps>(
  ({ className, onCheckedChange, onChange, disabled, ...props }, ref) => (
    <label className={cn("nmt-switch", disabled && "opacity-50", className)} aria-disabled={disabled ? "true" : undefined}>
      <input
        ref={ref}
        type="checkbox"
        className="nmt-switch-state"
        disabled={disabled}
        onChange={(event) => {
          onChange?.(event);
          onCheckedChange?.(event.currentTarget.checked);
        }}
        {...props}
      />
      <span className="nmt-indicator" aria-hidden="true" />
    </label>
  )
);
Switch.displayName = "Switch";

export const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ className, min, max, ...props }, ref) => {
  return (
    <SliderPrimitive.Root
      ref={ref}
      min={min}
      max={max}
      className={cn(
        "ft-skeuo-slider relative z-20 flex h-10 w-full touch-none select-none items-center overflow-hidden rounded-[2rem]",
        className
      )}
      {...props}
    >
      <SliderPrimitive.Track className="ft-skeuo-slider-track relative mx-auto h-10 w-[98%] overflow-hidden rounded-[2rem] bg-transparent">
        <SliderPrimitive.Range className="absolute h-full bg-transparent" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb className="ft-skeuo-slider-thumb relative block h-[1.85rem] w-[1.85rem] rounded-full ring-offset-background focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50" />
    </SliderPrimitive.Root>
  );
});
Slider.displayName = "Slider";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border-0 px-2.5 py-0.5 text-xs font-semibold transition-colors",
  {
    variants: {
      variant: {
        default: "bg-[#ECF0F3] text-[#34334C] shadow-[0.3rem_0.3rem_0.8rem_rgba(54,85,153,0.15),-0.2rem_-0.2rem_0.6rem_rgba(255,255,255,0.75)]",
        secondary: "bg-[#ECF0F3] text-[#4D4E68] shadow-[0.3rem_0.3rem_0.8rem_rgba(54,85,153,0.15),-0.2rem_-0.2rem_0.6rem_rgba(255,255,255,0.75)]",
        destructive: "bg-[#ECF0F3] text-rose-700 shadow-[0.3rem_0.3rem_0.8rem_rgba(54,85,153,0.15),-0.2rem_-0.2rem_0.6rem_rgba(255,255,255,0.75)]"
      }
    },
    defaultVariants: {
      variant: "default"
    }
  }
);

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export const Separator = React.forwardRef<
  React.ElementRef<typeof SeparatorPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root>
>(({ className, orientation = "horizontal", decorative = true, ...props }, ref) => (
  <SeparatorPrimitive.Root
    ref={ref}
    decorative={decorative}
    orientation={orientation}
    className={cn(
      "shrink-0 bg-border",
      orientation === "horizontal" ? "h-[1px] w-full" : "h-full w-[1px]",
      className
    )}
    {...props}
  />
));
Separator.displayName = "Separator";

export const Select = SelectPrimitive.Root;
export const SelectValue = SelectPrimitive.Value;

export const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      "flex h-11 w-full items-center justify-between rounded-[1.4rem] border-0 bg-[#ECF0F3] px-4 py-2 text-sm text-[#4D4E68]",
      "shadow-[inset_0.5rem_0.5rem_1rem_rgba(54,85,153,0.15),inset_-0.25rem_-0.25rem_1rem_rgba(255,255,255,0.7),0.1rem_0.1rem_0.1rem_rgba(255,255,255,0.7),-0.1rem_-0.1rem_0.1rem_rgba(54,85,153,0.15)]",
      "ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[#6C7CC9]/45 focus:ring-offset-2",
      "disabled:cursor-not-allowed disabled:opacity-50",
      "[&>span]:line-clamp-1",
      className
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="h-4 w-4 opacity-50" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
));
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName;

export const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = "popper", ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      className={cn(
        "relative z-50 max-h-96 min-w-[8rem] overflow-hidden rounded-[1.4rem] border-0 bg-[#ECF0F3] text-[#34334C]",
        "shadow-[1rem_1rem_2rem_rgba(54,85,153,0.15),-0.5rem_-0.5rem_2rem_rgba(255,255,255,0.7)]",
        "data-[state=open]:animate-in data-[state=closed]:animate-out",
        position === "popper" &&
          "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
        className
      )}
      position={position}
      {...props}
    >
      <SelectPrimitive.ScrollUpButton className="flex cursor-default items-center justify-center py-1">
        <ChevronUp className="h-4 w-4" />
      </SelectPrimitive.ScrollUpButton>
      <SelectPrimitive.Viewport
        className={cn(
          "p-1",
          position === "popper" &&
            "h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]"
        )}
      >
        {children}
      </SelectPrimitive.Viewport>
      <SelectPrimitive.ScrollDownButton className="flex cursor-default items-center justify-center py-1">
        <ChevronDown className="h-4 w-4" />
      </SelectPrimitive.ScrollDownButton>
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
));
SelectContent.displayName = SelectPrimitive.Content.displayName;

export const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none",
      "focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className
    )}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </SelectPrimitive.ItemIndicator>
    </span>

    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
));
SelectItem.displayName = SelectPrimitive.Item.displayName;
